/** Account counters update through real model settlement/SSE while each open
 * Usage dialog retains its own conversation or unsent draft context. Only
 * authored loopback peers receive provider traffic. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import type { Agent, ModelProvider, ScheduledTask, Session } from '../contract/index.ts'
import type { UsageSnapshot } from '../contract/usage.ts'
import { newUser } from './social-helpers.ts'
import { revealSessionRow } from './session-rail-helpers.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { startProviderRoutinePeer, type ProviderRoutinePeer, type ProviderRoutinePreset } from './provider-routine-peer.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`)
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(`${API}${path}`, { data })
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

async function observeRealEvents(page: Page) {
  await page.addInitScript(() => {
    const observed: Array<{ type: string; sessionId?: string; taskId?: string }> = []
    ;(window as Window & { __accountUsageEvents?: typeof observed }).__accountUsageEvents = observed
    const Native = window.EventSource
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        this.addEventListener('message', event => {
          const value = JSON.parse(event.data)
          observed.push({ type: value.type, sessionId: value.session?.id, taskId: value.taskId })
        })
      }
    }
  })
}

async function sawEvent(page: Page, type: string, id?: string) {
  await expect.poll(() => page.evaluate(({ type, id }) => {
    const events = (window as Window & {
      __accountUsageEvents?: Array<{ type: string; sessionId?: string; taskId?: string }>
    }).__accountUsageEvents ?? []
    return events.some(event => event.type === type && (!id || event.sessionId === id || event.taskId === id))
  }, { type, id }), { message: `the real ambient stream delivers ${type}`, timeout: ms(15_000) }).toBe(true)
}

async function providerAndAgent(page: Page, peer: ProviderRoutinePeer, preset: ProviderRoutinePreset, stamp: string) {
  const family = preset === 'anthropic' ? 'claude' : preset === 'openai' ? 'gpt' : 'deepseek'
  const provider = await post<ModelProvider>(page, '/providers', {
    label: `${preset} account usage ${stamp}`, modelFamily: family, effortLevels: [], kind: 'endpoint',
    config: { baseURL: peer.baseURL, model: peer.modelId,
      protocol: preset === 'openai' ? 'openai-responses' : 'anthropic-messages' },
  })
  expect(provider.execution).toBe('configured')
  const prompt = await post<{ id: string }>(page, '/system-prompts', {
    label: `${preset} usage prompt ${stamp}`, targetFamily: family, body: 'Answer briefly without tools.',
  })
  const agent = await post<Agent>(page, '/agents', {
    label: `${preset} usage Agent ${stamp}`, providerId: provider.id, systemPromptId: prompt.id,
    tools: [], instructions: 'Answer the local fixture request briefly without tools.',
  })
  return { provider, agent }
}

async function createConversation(page: Page, provider: ModelProvider, agent: Agent, peer: ProviderRoutinePeer, title: string) {
  return post<Session>(page, '/sessions', {
    firstMessage: title, persistFirstMessage: true, agentId: agent.id,
    providerId: provider.id, modelId: peer.modelId,
  })
}

async function completeConversation(page: Page, session: Session, peer: ProviderRoutinePeer) {
  const response = await page.request.post(`${API}/sessions/${session.id}/messages`, {
    data: { text: `Complete the account usage fixture ${session.id}.` },
    headers: { 'Idempotency-Key': `account-usage-${randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const completed = await read<Session>(page, `/sessions/${session.id}`)
  expect(completed.messages?.filter(message => message.role === 'assistant')).toEqual([
    expect.objectContaining({ content: peer.reply }),
  ])
}

async function openHeldUsage(page: Page, peer: ProviderRoutinePeer, provider: ModelProvider) {
  await sawEvent(page, 'hello')
  const trigger = page.getByRole('button', { name: /^Usage — estimated context/ })
  await expect(trigger).toBeVisible()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Usage details', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-usage-view', 'summary')
  await expect(dialog.getByText('Local usage limits', { exact: true })).toBeVisible()
  await expect(dialog.getByText(`${peer.modelLabel} · ${provider.label}`, { exact: true })).toBeVisible()
  const providerRegion = dialog.getByRole('region', { name: 'Provider usage & quota', exact: true })
  await expect(providerRegion).toHaveAttribute('data-provider-usage', 'available')
  await expect(providerRegion.getByRole('button', { name: /balance/i })).toHaveCount(0)
  const handle = await dialog.elementHandle()
  expect(handle).not.toBeNull()
  const context = await dialog.getByRole('button', { name: /^Context breakdown/ }).textContent()
  const title = await trigger.getAttribute('title')
  return {
    page, dialog,
    async unchanged() {
      expect(await dialog.evaluate((element, original) => element === original, handle)).toBe(true)
      await expect(dialog).toHaveAttribute('data-usage-view', 'summary')
      await expect(dialog.getByRole('button', { name: /^Context breakdown/ })).toHaveText(context!)
      await expect(trigger).toHaveAttribute('title', title!)
      await expect(dialog.getByText(`${peer.modelLabel} · ${provider.label}`, { exact: true })).toBeVisible()
    },
  }
}

async function expectCounters(dialog: Locator, snapshot: UsageSnapshot) {
  expect(snapshot.limits).toHaveLength(2)
  for (const limit of snapshot.limits) {
    await expect(dialog.getByText(limit.label, { exact: true })).toBeVisible()
    await expect(dialog.getByTitle(`${limit.usedTokens.toLocaleString()} / ${limit.limitTokens.toLocaleString()} tokens`, { exact: true }))
      .toHaveCount(1, { timeout: ms(15_000) })
  }
}

/** Use the rail so the same document/cache survives leaving an inactive query. */
async function openConversationFromRail(page: Page, session: Session) {
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  await expect.poll(() => page.locator('aside').evaluate(aside => {
    const rail = aside.closest('.overflow-hidden')
    return !!rail && !rail.hasAttribute('inert') && rail.scrollLeft === 0
      && rail.getBoundingClientRect().width >= aside.getBoundingClientRect().width - 0.5
  }), { message: 'the rail finishes opening before conversation navigation' }).toBe(true)
  const expandSessions = page.getByRole('button', { name: 'Expand Sessions', exact: true })
  if (await expandSessions.isVisible()) await expandSessions.click()
  await (await revealSessionRow(page, session.title)).click()
  await expect(page).toHaveURL(`/s/${session.id}`)
}

async function workflow(browser: Browser, preset: ProviderRoutinePreset) {
  test.setTimeout(ms(120_000))
  const stamp = randomUUID().slice(0, 8)
  const tenantId = `tenant-account-usage-${preset}-${stamp}`
  const foreignTenantId = `tenant-account-usage-foreign-${preset}-${stamp}`
  // Keep a known authenticated principal; only the dev tenant is synthesized.
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': tenantId })
  const foreign = await newUser(browser, {
    'x-user-id': 'user-maya', 'x-tenant-id': foreignTenantId,
  })
  const peer = await startProviderRoutinePeer(preset, stamp)
  const { page } = owner
  const draft = await owner.context.newPage()
  let balanceReads = 0
  let materializations = 0
  const usageReads = new Map<string, number>()
  for (const view of [page, draft]) {
    await observeRealEvents(view)
    view.on('request', request => {
      const url = new URL(request.url())
      const path = url.pathname
      if (request.method() === 'GET' && path === `${API}/usage`) {
        const sessionId = url.searchParams.get('session') ?? ''
        usageReads.set(sessionId, (usageReads.get(sessionId) ?? 0) + 1)
      }
      if (/\/providers\/[^/]+\/usage\/balance$/.test(path)) balanceReads++
      if (request.method() === 'POST' && path === `${API}/sessions`) materializations++
    })
  }
  try {
    expect(await read(page, '/me')).toMatchObject({ user: { id: 'user-ada' }, tenant: { id: tenantId } })
    expect(await read(foreign.page, '/me')).toMatchObject({ user: { id: 'user-maya' }, tenant: { id: foreignTenantId } })
    const { provider, agent } = await providerAndAgent(page, peer, preset, stamp)
    const a = await createConversation(page, provider, agent, peer, `Unchanged context A ${stamp}`)
    const b = await createConversation(page, provider, agent, peer, `Background conversation B ${stamp}`)
    const c = await createConversation(page, provider, agent, peer, `Inactive conversation C ${stamp}`)
    const templates = await read<Array<{ seed: Omit<ScheduledTask, 'id'> }>>(page, '/schedule-templates')
    expect(templates.length).toBeGreaterThan(0)
    const routine = await post<ScheduledTask>(page, '/schedules', { seed: {
      ...templates[0]!.seed, name: `Account usage Routine ${stamp}`, enabled: false, runs: [], steps: [],
      prompt: 'Complete the local account usage check briefly.', agentId: agent.id,
      providerId: provider.id, modelId: peer.modelId, effort: 'Default', model: peer.modelLabel,
      delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' },
    } })
    expect(peer.generationRequests()).toHaveLength(0)
    const ownerSetupRequests = peer.requests.length

    const inactiveRead = page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET' && url.pathname === `${API}/usage`
        && url.searchParams.get('session') === c.id
    })
    await page.goto(`/s/${c.id}`)
    const inactiveResponse = await inactiveRead
    expect(inactiveResponse.ok()).toBe(true)
    const inactiveSnapshot = await inactiveResponse.json() as UsageSnapshot
    expect(inactiveSnapshot.model).toMatchObject({ providerId: provider.id, modelId: peer.modelId })
    await expect(page.getByRole('button', { name: /^Usage — estimated context/ })).toBeVisible()
    await openConversationFromRail(page, a)
    const aUsage = await openHeldUsage(page, peer, provider)
    await draft.goto(`/agents/${agent.id}`)
    await expect(draft.getByRole('heading', { name: agent.label, exact: true })).toBeVisible()
    await draft.getByRole('button', { name: 'New conversation', exact: true }).click()
    await expect(draft.locator('[data-conversation-pane="draft"]')).toBeVisible()
    const unsent = `Keep this unsent account usage draft ${stamp}`
    await draft.getByRole('textbox', { name: 'Message', exact: true }).fill(unsent)
    const draftUsage = await openHeldUsage(draft, peer, provider)
    const initial = await read<UsageSnapshot>(page, `/usage?session=${a.id}`)
    await expectCounters(aUsage.dialog, initial)
    await expectCounters(draftUsage.dialog, initial)
    const initialContext = initial.context
    expect(initial.model).toMatchObject({ providerId: provider.id, modelId: peer.modelId })
    expect(materializations, 'opening and inspecting the draft never creates a conversation').toBe(0)
    expect(peer.generationRequests(), 'opening Usage never sends a model request').toHaveLength(0)
    expect(peer.requests, 'Usage reads never contact the provider, including probes or catalog reads').toHaveLength(ownerSetupRequests)
    const inactiveReadBaseline = usageReads.get(c.id) ?? 0
    expect(inactiveReadBaseline, 'C had a real browser usage read before becoming inactive').toBeGreaterThan(0)

    await completeConversation(page, b, peer)
    const afterConversation = await read<UsageSnapshot>(page, `/usage?session=${a.id}`)
    expect(afterConversation.limits[0]!.usedTokens).toBeGreaterThan(initial.limits[0]!.usedTokens)
    expect(afterConversation.context).toEqual(initialContext)
    expect(afterConversation.model).toEqual(initial.model)
    for (const held of [aUsage, draftUsage]) {
      await sawEvent(held.page, 'session.updated', b.id)
      await expectCounters(held.dialog, afterConversation)
      await held.unchanged()
    }
    expect(peer.generationRequests()).toHaveLength(1)
    expect(peer.requests).toHaveLength(ownerSetupRequests + 1)
    expect(usageReads.get(c.id), 'another conversation settlement does not refetch inactive C').toBe(inactiveReadBaseline)

    await post(page, `/schedules/${routine.id}/run`, {})
    await expect.poll(async () => (await read<ScheduledTask[]>(page, '/schedules'))
      .find(task => task.id === routine.id)?.runs[0]?.status, { timeout: ms(20_000) }).toBe('ok')
    const afterRoutine = await read<UsageSnapshot>(page, `/usage?session=${a.id}`)
    expect(afterRoutine.limits[0]!.usedTokens).toBeGreaterThan(afterConversation.limits[0]!.usedTokens)
    for (const held of [aUsage, draftUsage]) {
      await sawEvent(held.page, 'run.finished', routine.id)
      await expectCounters(held.dialog, afterRoutine)
      await held.unchanged()
    }
    expect(peer.generationRequests()).toHaveLength(2)
    expect(peer.requests).toHaveLength(ownerSetupRequests + 2)
    expect(usageReads.get(c.id), 'Routine settlement does not refetch inactive C').toBe(inactiveReadBaseline)

    // Keep the exact dialogs open through the viewport walk. Resizing must
    // preserve refreshed account counters, local context and the unsent draft.
    for (const viewport of VIEWPORTS) {
      for (const { surface, held } of [
        { surface: 'conversation', held: aUsage }, { surface: 'draft', held: draftUsage },
      ]) {
        await held.page.setViewportSize(viewport)
        await settledNarrowRail(held.page)
        await held.unchanged()
        await expectCounters(held.dialog, afterRoutine)
        const lastWindow = held.dialog.getByText(afterRoutine.limits.at(-1)!.label, { exact: true })
        await lastWindow.scrollIntoViewIfNeeded()
        await expect(lastWindow).toBeInViewport()
        await settledOpaquePaint(held.dialog)
        await expect.poll(() => held.dialog.evaluate(element => {
          const box = element.getBoundingClientRect()
          return element.hasAttribute('data-popover') && box.left >= 7 && box.top >= 7
            && box.right <= window.innerWidth - 7 && box.bottom <= window.innerHeight - 7
            && element.scrollWidth <= element.clientWidth
            && document.documentElement.scrollWidth <= document.documentElement.clientWidth
        }), { message: `${preset} ${surface} Usage fits ${viewport.width}×${viewport.height} without horizontal scrolling` }).toBe(true)
        if (viewport.width === 320 || viewport.width === 1280) {
          await assertWcag22Aa(held.page, `${preset} held ${surface} account Usage ${viewport.width}×${viewport.height}`)
        }
        await held.page.screenshot({ path: `.data/account-usage-review/${preset}-${surface}-${viewport.width}x${viewport.height}.png` })
      }
    }
    await expect(draft.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(unsent)
    expect(peer.requests, 'responsive review and accessibility scans never contact the provider').toHaveLength(ownerSetupRequests + 2)

    const foreignBinding = await providerAndAgent(foreign.page, peer, preset, `foreign-${stamp}`)
    const foreignSession = await createConversation(foreign.page, foreignBinding.provider, foreignBinding.agent, peer, `Foreign usage ${stamp}`)
    const beforeForeignTurn = peer.requests.length
    const foreignBefore = await read<UsageSnapshot>(foreign.page, '/usage')
    await completeConversation(foreign.page, foreignSession, peer)
    const foreignAfter = await read<UsageSnapshot>(foreign.page, '/usage')
    expect(foreignAfter.limits[0]!.usedTokens).toBeGreaterThan(foreignBefore.limits[0]!.usedTokens)
    const ownerAfterForeign = await read<UsageSnapshot>(page, `/usage?session=${a.id}`)
    expect(ownerAfterForeign.limits).toEqual(afterRoutine.limits)
    expect(ownerAfterForeign.context).toEqual(initialContext)
    expect(ownerAfterForeign.model).toEqual(initial.model)
    for (const held of [aUsage, draftUsage]) {
      await expectCounters(held.dialog, ownerAfterForeign)
      await held.unchanged()
    }
    await expect(draft.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(unsent)
    expect(materializations).toBe(0)
    expect(balanceReads, 'neither summary inspection nor model settlement automatically checks balance').toBe(0)
    expect(peer.generationRequests(), 'only B, the explicit Routine, and the foreign turn generate').toHaveLength(3)
    expect(peer.requests).toHaveLength(beforeForeignTurn + 1)
    expect(peer.requests.some(request => /\/user\/balance$/.test(request.path))).toBe(false)

    // Re-enter C through the same SPA document. Its dormant snapshot must be
    // read anew on mount and contain the account spend observed in A/draft.
    expect(usageReads.get(c.id)).toBe(inactiveReadBaseline)
    await page.keyboard.press('Escape')
    await expect(aUsage.dialog).toHaveCount(0)
    const reopenedRead = page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET' && url.pathname === `${API}/usage`
        && url.searchParams.get('session') === c.id
    })
    await openConversationFromRail(page, c)
    const reopenedResponse = await reopenedRead
    expect(reopenedResponse.ok()).toBe(true)
    const reopenedSnapshot = await reopenedResponse.json() as UsageSnapshot
    expect(reopenedSnapshot.limits).toEqual(ownerAfterForeign.limits)
    expect(reopenedSnapshot.context).toEqual(inactiveSnapshot.context)
    expect(reopenedSnapshot.model).toEqual(inactiveSnapshot.model)
    expect(usageReads.get(c.id)).toBeGreaterThan(inactiveReadBaseline)
    const reopenedUsage = await openHeldUsage(page, peer, provider)
    await expectCounters(reopenedUsage.dialog, ownerAfterForeign)
    await draftUsage.unchanged()
    await expect(draft.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(unsent)
    expect(balanceReads).toBe(0)
    expect(peer.requests, 'reopening an invalidated inactive usage query never contacts the provider').toHaveLength(beforeForeignTurn + 1)
  } finally {
    await owner.context.close()
    await foreign.context.close()
    await peer.close()
  }
}

test('Claude account counters refresh in held conversation and draft Usage after remote turns and Routines', async ({ browser }) => {
  await workflow(browser, 'anthropic')
})

test('DeepSeek account counters refresh in held conversation and draft Usage after remote turns and Routines', async ({ browser }) => {
  await workflow(browser, 'deepseek')
})

test('OpenAI account counters refresh in held conversation and draft Usage after remote turns and Routines', async ({ browser }) => {
  await workflow(browser, 'openai')
})
