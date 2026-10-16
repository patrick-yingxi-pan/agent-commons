/** Complete user-authored setup, binding, and execution through each native
 * provider path. Only loopback peers receive model traffic; no paid calls. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import type { Agent, ModelProvider, ScheduledTask, Session, SystemPromptEntry } from '../contract/index.ts'
import { runSessionId } from '../contract/ids.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { newUser, openSection } from './social-helpers.ts'
import { ensureAuthRefactorPanelOpen } from './panel-preference-helpers.ts'
import { ms } from './budget.ts'
import { startProviderRoutinePeer, type ProviderRoutinePreset } from './provider-routine-peer.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

/** Observe the real UI write; this helper never provisions product state. */
async function submitted<T>(page: Page, method: string, path: string, action: () => Promise<void>): Promise<T> {
  const responsePromise = page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname === `/api/v1${path}`)
  await action()
  const response = await responsePromise
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`)
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<T>
}

async function readRoutine(page: Page, id: string): Promise<ScheduledTask> {
  const routine = (await read<ScheduledTask[]>(page, '/schedules')).find(row => row.id === id)
  expect(routine, 'the owner can read the UI-created Routine').toBeDefined()
  return routine!
}

async function boundedBreadcrumb(page: Page) {
  const breadcrumb = page.locator('[data-identity-breadcrumb]')
  await expect(breadcrumb).toBeVisible()
  await expect.poll(async () => {
    const box = await breadcrumb.boundingBox()
    const identity = await breadcrumb.locator('..').boundingBox()
    return !!box && !!identity && identity.width >= 120 && box.x >= identity.x - 0.5
      && box.x + box.width <= identity.x + identity.width + 0.5
  }, { message: 'the breadcrumb has a readable title column, clear of sibling actions' }).toBe(true)
}

async function workflow(browser: Browser, info: TestInfo, preset: ProviderRoutinePreset) {
  test.setTimeout(ms(120_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, {
    'x-user-id': `user-provider-routine-${preset}-${stamp}`,
    'x-tenant-id': `tenant-provider-routine-${preset}-${stamp}`,
  })
  let peer: Awaited<ReturnType<typeof startProviderRoutinePeer>> | undefined
  let foreign: Awaited<ReturnType<typeof newUser>> | undefined
  const { page } = owner
  const family = preset === 'anthropic' ? 'claude' : preset === 'openai' ? 'gpt' : 'deepseek'
  const protocol = preset === 'openai' ? 'openai-responses' : 'anthropic-messages'
  const providerLabel = `${family} Routine connection ${stamp}`
  const agentLabel = `${family} Routine Agent ${stamp}`
  const instruction = `Summarize the local readiness check ${stamp} in one short paragraph.`
  const systemText = `You are the ${family} readiness assistant for ${stamp}.`
  const agentText = `Keep the ${stamp} response concise; do not use tools.`
  try {
    peer = await startProviderRoutinePeer(preset, stamp)
    await page.goto('/models')
    await page.getByRole('button', { name: 'New provider', exact: true }).click()
    const providerDialog = page.getByRole('dialog', { name: 'New provider', exact: true })
    await providerDialog.getByLabel('Provider preset').selectOption(preset)
    await providerDialog.getByLabel('Name', { exact: true }).fill(providerLabel)
    await providerDialog.getByLabel('Endpoint URL').fill(peer.baseURL)
    await providerDialog.getByLabel('Model ID', { exact: true }).fill(peer.modelId)
    const provider = await submitted<ModelProvider>(page, 'POST', '/providers', () =>
      providerDialog.getByRole('button', { name: 'Create', exact: true }).click())
    await expect(providerDialog).toHaveCount(0)
    expect(provider).toMatchObject({ label: providerLabel, modelFamily: family, execution: 'configured',
      protocol, defaultModelId: peer.modelId })
    expect(provider.models).toEqual([expect.objectContaining({ id: peer.modelId, label: peer.modelLabel })])
    expect(peer.requests.filter(request => request.method === 'GET')).toEqual([
      { method: 'GET', path: preset === 'deepseek' ? '/anthropic/v1/models' : '/v1/models' },
    ])
    expect(peer.generationRequests()).toHaveLength(0)

    await page.goto('/agents/building-blocks')
    await page.getByRole('button', { name: 'New prompt', exact: true }).click()
    const promptDialog = page.getByRole('dialog', { name: 'New prompt', exact: true })
    await promptDialog.getByLabel('Name', { exact: true }).fill(`${family} readiness prompt ${stamp}`)
    await promptDialog.getByLabel('Model family').fill(family)
    await promptDialog.getByLabel('Prompt', { exact: true }).fill(systemText)
    const prompt = await submitted<SystemPromptEntry>(page, 'POST', '/system-prompts', () =>
      promptDialog.getByRole('button', { name: 'Create', exact: true }).click())
    await expect(promptDialog).toHaveCount(0)

    await page.goto('/agents')
    await page.getByRole('button', { name: 'New agent', exact: true }).click()
    const agentDialog = page.getByRole('dialog', { name: 'New agent', exact: true })
    await agentDialog.getByLabel('Name', { exact: true }).fill(agentLabel)
    await agentDialog.getByRole('combobox', { name: 'Provider', exact: true }).selectOption(provider.id)
    await agentDialog.getByRole('combobox', { name: /^System prompt/ }).selectOption(prompt.id)
    await agentDialog.getByRole('checkbox', { name: 'Tools', exact: true }).uncheck()
    await agentDialog.getByLabel('Instructions').fill(agentText)
    const agent = await submitted<Agent>(page, 'POST', '/agents', () =>
      agentDialog.getByRole('button', { name: 'Create', exact: true }).click())
    await expect(agentDialog).toHaveCount(0)
    expect(agent).toMatchObject({ providerId: provider.id, systemPromptId: prompt.id, tools: [], instructions: agentText })

    await page.goto('/scheduled')
    await page.getByRole('button', { name: 'New routine', exact: true }).click()
    const routine = await submitted<ScheduledTask>(page, 'POST', '/schedules', () =>
      page.getByRole('dialog', { name: 'New routine' }).getByRole('button', { name: /Blank recipe/ }).click())
    expect(routine.enabled, 'a new Routine is paused until explicitly enabled').toBe(false)
    expect(routine.runs).toHaveLength(0)
    await page.goto(`/scheduled/${routine.id}`)
    await page.getByTitle('Rename routine', { exact: true }).click()
    await page.getByRole('textbox', { name: 'Routine name', exact: true }).fill(`${family} readiness ${stamp}`)
    await submitted(page, 'PATCH', `/schedules/${routine.id}`, () => page.getByRole('button', { name: 'Save routine name', exact: true }).click())
    await openSection(page, 'Instruction')
    await page.getByRole('button', { name: 'Edit instruction', exact: true }).click()
    const instructionSection = page.locator('[data-resource-section="Instruction"]')
    await instructionSection.getByRole('textbox').fill(instruction)
    await submitted(page, 'PATCH', `/schedules/${routine.id}`, () => instructionSection.getByRole('button', { name: 'Save', exact: true }).click())
    await expect(instructionSection.getByRole('textbox')).toHaveCount(0)
    await expect(instructionSection.getByText(instruction, { exact: true })).toBeVisible()

    const beforeBinding = await readRoutine(page, routine.id)
    await openSection(page, 'Agent & model')
    await page.getByTitle('Change Agent, model & effort', { exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    await picker.getByLabel('Routine agent').selectOption(agent.id)
    await picker.getByRole('button').filter({ has: page.getByText(providerLabel, { exact: true }) }).click()
    await picker.getByRole('button').filter({ has: page.getByText(peer.modelLabel, { exact: true }) }).click()
    const staged = await readRoutine(page, routine.id)
    for (const key of ['agentId', 'providerId', 'modelId', 'effort', 'revision'] as const) {
      expect(staged[key], `staging does not write ${key} before Apply`).toBe(beforeBinding[key])
    }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(picker.getByLabel('Routine agent')).toHaveValue(agent.id)
      await picker.getByLabel('Routine agent').scrollIntoViewIfNeeded()
      await expect(picker.getByLabel('Routine agent')).toBeInViewport()
      await settledOpaquePaint(picker)
      await expect.poll(async () => {
        const box = await picker.boundingBox()
        return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7
          && box.y + box.height <= viewport.height - 7
      }).toBe(true)
      if (viewport.height === 390) {
        await page.screenshot({ path: info.outputPath(`binding-top-${viewport.width}x${viewport.height}.png`) })
      }
      await picker.getByRole('button', { name: 'Apply', exact: true }).scrollIntoViewIfNeeded()
      await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport()
      await assertWcag22Aa(page, `${family} Routine staged binding ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: info.outputPath(`binding-${viewport.width}x${viewport.height}.png`) })
    }
    await submitted(page, 'PATCH', `/schedules/${routine.id}`, () => picker.getByRole('button', { name: 'Apply', exact: true }).click())
    await expect(picker).toHaveCount(0)
    const bound = await readRoutine(page, routine.id)
    expect(bound).toMatchObject({ agentId: agent.id, providerId: provider.id, modelId: peer.modelId, prompt: instruction })
    await page.reload()
    await openSection(page, 'Agent & model')
    await expect(page.getByTitle('Change Agent, model & effort', { exact: true })).toContainText(agentLabel)
    await expect(page.getByTitle('Change Agent, model & effort', { exact: true })).toContainText(peer.modelLabel)
    expect(peer.generationRequests()).toHaveLength(0)

    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(async () => (await readRoutine(page, routine.id)).runs[0]?.status,
      { timeout: ms(20_000) }).toBe('ok')
    const completed = await readRoutine(page, routine.id)
    expect(completed.runs).toHaveLength(1)
    expect(completed.runs[0]).toMatchObject({ detail: peer.reply, attempts: 1,
      execution: { agentId: agent.id, providerId: provider.id, modelId: peer.modelId } })
    const requests = peer.generationRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe(preset === 'openai' ? '/v1/responses' : preset === 'deepseek' ? '/anthropic/v1/messages' : '/v1/messages')
    expect(requests[0].body).toMatchObject({ model: peer.modelId })
    const wire = JSON.stringify(requests[0].body)
    expect(wire).toContain(instruction)
    expect(wire).toContain(systemText)
    expect(wire).toContain(agentText)
    if (preset === 'openai') expect(requests[0].body).toMatchObject({ store: false, max_output_tokens: 8192 })
    else expect(requests[0].body).toMatchObject({ max_tokens: 8192 })

    await openSection(page, 'Recent runs')
    await page.getByTitle('Open this run’s session', { exact: true }).click()
    const sessionId = runSessionId(routine.id, completed.runs[0].id)
    await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`))
    const result = page.locator('[data-turn="m2"]')
    await expect(result).toContainText(peer.reply)
    await expect(result.locator('[data-turn-author]')).toHaveText(agentLabel)
    await expect(result.locator('[data-turn-model]')).toContainText(providerLabel)
    await expect(result.locator('[data-turn-model]')).toContainText(peer.modelId)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(page.locator('[data-identity-breadcrumb]')).toHaveAttribute('title', `Open the ${completed.name} routine`)
      await boundedBreadcrumb(page)
      await result.scrollIntoViewIfNeeded()
      await settledOpaquePaint(result)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(page, `${family} Routine result ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: info.outputPath(`result-${viewport.width}x${viewport.height}.png`) })
    }
    await page.reload()
    await expect(result).toContainText(peer.reply)
    const session = await read<Session>(page, `/sessions/${sessionId}`)
    expect(session.messages?.filter(message => message.role === 'assistant')).toEqual([
      expect.objectContaining({ content: peer.reply, agentId: agent.id, providerId: provider.id, modelId: peer.modelId }),
    ])
    expect((await readRoutine(page, routine.id)).runs).toHaveLength(1)
    expect(peer.generationRequests(), 'viewing/reloading the result does not execute again').toHaveLength(1)
    await page.locator('[data-identity-breadcrumb]').click()
    await expect(page).toHaveURL(new RegExp(`/scheduled/${routine.id}$`))
    await expect(page.getByRole('heading', { name: completed.name, exact: true })).toBeVisible()

    foreign = await newUser(browser, {
      'x-user-id': `user-foreign-routine-${preset}-${stamp}`,
      'x-tenant-id': `tenant-foreign-routine-${preset}-${stamp}`,
    })
    for (const path of [`/providers/${provider.id}`, `/agents/${agent.id}`, `/sessions/${sessionId}`]) {
      await read(page, path) // A real readable owner route, not a nonexistent-route 404.
      expect((await foreign.page.request.get(`/api/v1${path}`)).status(), path).toBe(404)
    }
    expect((await read<ScheduledTask[]>(foreign.page, '/schedules')).some(row => row.id === routine.id)).toBe(false)
    await foreign.page.goto(`/scheduled/${routine.id}`)
    await expect(foreign.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(foreign.page.getByRole('button', { name: 'Run now', exact: true })).toHaveCount(0)
    await expect(foreign.page.getByText(instruction, { exact: true })).toHaveCount(0)
  } finally {
    try {
      await foreign?.context.close()
    } finally {
      try { await owner.context.close() } finally { await peer?.close() }
    }
  }
}

test('Claude provider → Agent → Routine uses the UI-authored Messages binding', async ({ browser }, info) => {
  await workflow(browser, info, 'anthropic')
})

test('DeepSeek provider → Agent → Routine uses the UI-authored Messages binding', async ({ browser }, info) => {
  await workflow(browser, info, 'deepseek')
})

test('OpenAI provider → Agent → Routine uses the UI-authored Responses binding', async ({ browser }, info) => {
  await workflow(browser, info, 'openai')
})

test('Project conversation breadcrumbs preserve identity room beside header actions', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  try {
    // Pane closure alone does not clear the durable context focus used when
    // resizing into an overlay tier. This layout fixture needs that focus off.
    const closed = await page.request.patch('/api/v1/sessions/auth-refactor/preferences', { data: { panelFocus: null } })
    expect(closed.ok()).toBe(true)
    await page.goto('/s/auth-refactor')
    await expect(page.locator('[data-context-pane]')).toHaveCount(0)
    await expect(page.locator('[data-identity-breadcrumb]')).toContainText('In ')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      // The dock stays mounted while empty for exit animations; its contents,
      // not the shell's presence, determine whether it covers this header.
      await expect(page.locator('[data-overlay-dock] > *')).toHaveCount(0)
      await boundedBreadcrumb(page)
      await settledOpaquePaint(page.locator('[data-session-title-bar]'))
      await assertWcag22Aa(page, `Project conversation header ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: info.outputPath(`project-header-${viewport.width}x${viewport.height}.png`) })
    }
    const title = await page.locator('[data-identity-breadcrumb]').getAttribute('title')
    expect(title).toMatch(/^Open .+/)
    await page.locator('[data-identity-breadcrumb]').click()
    await expect(page).toHaveURL(/\/projects\/[^/]+$/)
    await expect(page.getByRole('heading', { name: title!.slice(5), exact: true })).toBeVisible()
  } finally {
    await ensureAuthRefactorPanelOpen(page)
  }
})
