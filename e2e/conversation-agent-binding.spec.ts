/** Ordinary conversation Agent selection is a durable driver binding, not a
 * provider/model override. Every model call goes to a test-owned loopback peer. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_PROVIDER_ID, type Agent, type ModelProvider, type Session, type SystemPromptEntry } from '../contract/index.ts'
import { newUser } from './social-helpers.ts'
import { splitPane } from './pane-actions.ts'
import { revealSessionRow } from './session-rail-helpers.ts'
import { settledNarrowRail } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { startProviderRoutinePeer, type ProviderRoutinePreset } from './provider-routine-peer.ts'

const API = '/api/v1'
const DEFAULT_AGENT_ID = 'agent-default'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function submitted<T>(page: Page, method: string, path: string, action: () => Promise<void>): Promise<T> {
  const pending = page.waitForResponse(response => response.request().method() === method &&
    new URL(response.url()).pathname === `${API}${path}`)
  await action()
  const response = await pending
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

async function workflow(browser: Browser, testInfo: TestInfo, preset: ProviderRoutinePreset, extraCoverage = false) {
  test.setTimeout(ms(150_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, {
    'x-user-id': `user-conversation-agent-${preset}-${stamp}`,
    'x-tenant-id': `tenant-conversation-agent-${preset}-${stamp}`,
  })
  const { page } = owner
  const peer = await startProviderRoutinePeer(preset, stamp)
  let foreign: Awaited<ReturnType<typeof newUser>> | undefined
  const family = preset === 'anthropic' ? 'claude' : preset === 'openai' ? 'gpt' : 'deepseek'
  const providerLabel = `${family} conversation provider ${stamp}`
  const agentLabel = `${family} conversation Agent ${stamp}`
  const systemText = `You are the ${family} conversation specialist ${stamp}.`
  const instruction = `Answer the ordinary conversation task briefly for ${stamp}.`
  const task = `Use the configured ${family} route for this ordinary turn ${stamp}.`
  try {
    await page.goto('/models')
    await page.getByRole('button', { name: 'New provider', exact: true }).click()
    const providerDialog = page.getByRole('dialog', { name: 'New provider', exact: true })
    await providerDialog.getByLabel('Provider preset').selectOption(preset)
    await providerDialog.getByLabel('Name', { exact: true }).fill(providerLabel)
    await providerDialog.getByLabel('Endpoint URL').fill(peer.baseURL)
    await providerDialog.getByLabel('Model ID', { exact: true }).fill(peer.modelId)
    const provider = await submitted<ModelProvider>(page, 'POST', '/providers', () =>
      providerDialog.getByRole('button', { name: 'Create', exact: true }).click())
    expect(provider).toMatchObject({ modelFamily: family, execution: 'configured', defaultModelId: peer.modelId, protocol:
      preset === 'openai' ? 'openai-responses' : 'anthropic-messages' })
    expect(peer.generationRequests()).toHaveLength(0)

    await page.goto('/agents/building-blocks')
    await page.getByRole('button', { name: 'New prompt', exact: true }).click()
    const promptDialog = page.getByRole('dialog', { name: 'New prompt', exact: true })
    await promptDialog.getByLabel('Name', { exact: true }).fill(`${family} conversation prompt ${stamp}`)
    await promptDialog.getByLabel('Model family').fill(family)
    await promptDialog.getByLabel('Prompt', { exact: true }).fill(systemText)
    const prompt = await submitted<SystemPromptEntry>(page, 'POST', '/system-prompts', () =>
      promptDialog.getByRole('button', { name: 'Create', exact: true }).click())

    await page.goto('/agents')
    await page.getByRole('button', { name: 'New agent', exact: true }).click()
    const agentDialog = page.getByRole('dialog', { name: 'New agent', exact: true })
    await agentDialog.getByLabel('Name', { exact: true }).fill(agentLabel)
    await agentDialog.getByRole('combobox', { name: 'Provider', exact: true }).selectOption(provider.id)
    await agentDialog.getByRole('combobox', { name: /^System prompt/ }).selectOption(prompt.id)
    await agentDialog.getByRole('checkbox', { name: 'Tools', exact: true }).uncheck()
    await agentDialog.getByLabel('Instructions').fill(instruction)
    const agent = await submitted<Agent>(page, 'POST', '/agents', () =>
      agentDialog.getByRole('button', { name: 'Create', exact: true }).click())
    expect(agent).toMatchObject({ label: agentLabel, providerId: provider.id, systemPromptId: prompt.id, instructions: instruction, tools: [] })

    // Select on a fresh draft, duplicate it into a second pane, and confirm the
    // second view observes the same pending binding before materialization.
    await page.getByRole('button', { name: 'New session', exact: true }).click()
    await expect(page.locator('[data-conversation-pane="draft"]')).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Model and effort', exact: true }).last()
    await trigger.click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    const agentSelect = picker.getByRole('combobox', { name: 'Conversation Agent', exact: true })
    await expect(agentSelect.locator('option').filter({ hasText: agentLabel })).toHaveCount(1)
    // Stage an explicit provider/model override first. Selecting this Agent
    // must return both coordinates to inheritance from the Agent definition.
    await picker.getByRole('button').filter({ has: page.getByText(providerLabel, { exact: true }) }).click()
    await picker.getByRole('button').filter({ has: page.getByText(peer.modelLabel, { exact: true }) }).click()
    await agentSelect.selectOption(agent.id)
    await expect(trigger).toContainText(agentLabel)
    await page.keyboard.press('Escape')
    // The Agent selector remains reachable at every supported viewport; assert
    // the actual popover geometry, not just the presence of its label.
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: 'Model and effort', exact: true })
      await expect(dialog.getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(agent.id)
      await expect.poll(async () => {
        const box = await dialog.boundingBox()
        return !!box && box.x >= 6 && box.y >= 6 && box.x + box.width <= viewport.width - 6 && box.y + box.height <= viewport.height - 6
      }, { message: `Agent picker fits ${viewport.width}×${viewport.height}` }).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`agent-picker-${viewport.width}x${viewport.height}.png`) })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await expect(page.locator('[data-rail-toolbar-group="view"]')).toBeVisible()
    await page.getByRole('textbox', { name: 'Message', exact: true }).click()
    await splitPane(page, 'right')
    const paneA = page.locator('[data-main-pane="a"]')
    const paneB = page.locator('[data-main-pane="b"]')
    await expect(paneA.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await paneA.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await expect(paneA.getByRole('dialog', { name: 'Model and effort', exact: true })
      .getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(agent.id)
    await page.keyboard.press('Escape')

    let creationBody: Record<string, unknown> | undefined
    await page.route(`**${API}/sessions`, async route => {
      if (route.request().method() === 'POST') creationBody = route.request().postDataJSON() as Record<string, unknown>
      await route.continue()
    })
    const composer = paneB.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill(task)
    await composer.press('Enter')
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toHaveCount(0, { timeout: ms(20_000) })
    await expect(paneB.getByText(peer.reply, { exact: true })).toBeVisible({ timeout: ms(30_000) })
    const sessionPath = new URL(page.url()).pathname
    expect(sessionPath).toMatch(/^\/s\//)
    const sessionId = decodeURIComponent(sessionPath.slice('/s/'.length))
    expect(creationBody?.agentId).toBe(agent.id)
    const readSession = async () => {
      const response = await page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
      expect(response.ok(), await response.text()).toBe(true)
      return response.json() as Promise<Session>
    }
    const session = await readSession()
    expect(session).toMatchObject({ agentId: agent.id })
    expect(creationBody).not.toHaveProperty('providerId')
    expect(creationBody).not.toHaveProperty('modelId')
    expect(session.messages?.filter(message => message.role === 'assistant')).toHaveLength(1)
    expect(session.messages?.at(-1)).toMatchObject({ role: 'assistant', content: peer.reply,
      agentId: agent.id, providerId: provider.id, modelId: peer.modelId })
    const modelRequest = peer.generationRequests()
    expect(modelRequest).toHaveLength(1)
    expect(modelRequest[0]?.path).toBe(preset === 'openai' ? '/v1/responses' : preset === 'deepseek' ? '/anthropic/v1/messages' : '/v1/messages')
    expect(JSON.stringify(modelRequest[0]?.body)).toContain(systemText)
    expect(JSON.stringify(modelRequest[0]?.body)).toContain(instruction)
    expect(JSON.stringify(modelRequest[0]?.body)).toContain(task)

    // A saved Agent switch is a revisioned metadata write and cannot rewrite
    // the already-authored turn or issue another model call.
    const patchBodies: Record<string, unknown>[] = []
    let releaseFirstPatch!: () => void
    let firstPatchReached!: () => void
    const firstPatchGate = new Promise<void>(resolve => { releaseFirstPatch = resolve })
    const firstPatch = new Promise<void>(resolve => { firstPatchReached = resolve })
    await page.route(`**${API}/sessions/${encodeURIComponent(sessionId)}`, async route => {
      if (route.request().method() === 'PATCH') {
        patchBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        if (patchBodies.length === 1) { firstPatchReached(); await firstPatchGate }
      }
      await route.continue()
    })
    const beforeAgentChange = await readSession()
    await paneB.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const savedPicker = paneB.getByRole('dialog', { name: 'Model and effort', exact: true })
    const savedAgent = savedPicker.getByRole('combobox', { name: 'Conversation Agent', exact: true })
    await savedAgent.selectOption(DEFAULT_AGENT_ID)
    await firstPatch
    try { await expect(savedAgent).toBeDisabled() } finally { releaseFirstPatch() }
    await expect.poll(async () => (await readSession()).agentId).toBe(DEFAULT_AGENT_ID)
    await expect.poll(() => patchBodies.length).toBe(1)
    expect(patchBodies[0]).toEqual({ agentId: DEFAULT_AGENT_ID, providerId: '', modelId: '', expectedRevision: beforeAgentChange.metadataRevision ?? 0 })
    await expect(paneB.locator('[data-turn-author]').filter({ hasText: agentLabel }).first()).toBeVisible()
    expect(peer.generationRequests()).toHaveLength(1)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: testInfo.outputPath('saved-agent-binding.png') })
    await page.reload()
    await expect.poll(async () => (await readSession()).agentId).toBe(DEFAULT_AGENT_ID)
    await expect(page.locator('[data-turn-author]').filter({ hasText: agentLabel }).first()).toBeVisible()
    expect(peer.generationRequests()).toHaveLength(1)
    const nextTask = `This later turn should use the default Agent ${stamp}.`
    const paneComposer = paneB.getByRole('textbox', { name: 'Message', exact: true })
    await paneComposer.fill(nextTask)
    await paneComposer.press('Enter')
    await expect(paneB.locator('[data-turn-author]').filter({ hasText: 'Default agent' }).last()).toBeVisible({ timeout: ms(20_000) })
    const changedSession = await readSession()
    const assistantTurns = changedSession.messages?.filter(message => message.role === 'assistant') ?? []
    expect(assistantTurns).toHaveLength(2)
    expect(assistantTurns[0]).toMatchObject({ agentId: agent.id, providerId: provider.id, modelId: peer.modelId })
    expect(assistantTurns[1]?.agentId).toBe(DEFAULT_AGENT_ID)
    expect(peer.generationRequests()).toHaveLength(1, 'the later default-Agent turn does not call the prior provider')

    if (extraCoverage) {
      const beforeRestore = await readSession()
      await paneB.getByRole('button', { name: 'Model and effort', exact: true }).click()
      const restorePicker = paneB.getByRole('dialog', { name: 'Model and effort', exact: true })
      await restorePicker.getByRole('combobox', { name: 'Conversation Agent', exact: true }).selectOption(agent.id)
      await expect.poll(async () => (await readSession()).agentId).toBe(agent.id)
      await expect.poll(() => patchBodies.length).toBe(2)
      expect(patchBodies[1]).toEqual({ agentId: agent.id, providerId: '', modelId: '', expectedRevision: beforeRestore.metadataRevision ?? 0 })
      await page.keyboard.press('Escape')

      // Shared readers may read the conversation but never receive a mutable
      // Agent-binding control or the private Agent from the owner's registry.
      const identityResponse = await page.request.get(`${API}/me`)
      const identity = await identityResponse.json() as { tenant: { id: string } }
      foreign = await newUser(browser, {
        'x-user-id': 'user-grace',
        'x-tenant-id': 'tenant-beta',
      })
      await paneB.getByRole('button', { name: 'Share this conversation', exact: true }).click()
      await page.getByLabel('Audience id').fill('tenant-beta')
      await page.getByLabel('Tier').selectOption({ label: 'View' })
      await submitted(page, 'POST', '/grants', () => page.getByRole('button', { name: 'Share', exact: true }).click())
      await foreign.page.goto(sessionPath)
      await expect(foreign.page.getByText(peer.reply, { exact: true })).toBeVisible()
      await expect(foreign.page.getByRole('button', { name: 'Share this conversation', exact: true })).toHaveCount(0)
      const foreignTrigger = foreign.page.getByRole('button', { name: 'Model and effort', exact: true })
      await expect(foreignTrigger).toBeVisible()
      await foreignTrigger.click()
      const foreignPicker = foreign.page.getByRole('dialog', { name: 'Model and effort', exact: true })
      const foreignAgent = foreignPicker.getByRole('combobox', { name: 'Conversation Agent', exact: true })
      await expect(foreignAgent).toBeDisabled()
      await expect(foreignAgent.locator(`option[value="${agent.id}"]`)).toHaveText('Unavailable Agent')
      await expect(foreignPicker.getByText(agentLabel, { exact: true })).toHaveCount(0)
      expect(identity.tenant.id).not.toBe('tenant-beta')

      // Deleting the bound Agent yields an explicit missing-binding state; the
      // menu offers the default Agent as a repair and the write restores it.
      const deleted = await page.request.delete(`${API}/agents/${encodeURIComponent(agent.id)}`, {
        data: { expectedRevision: agent.revision ?? 0 },
      })
      expect(deleted.ok(), await deleted.text()).toBe(true)
      await page.reload()
      await expect(paneB.getByText('This conversation’s Agent is unavailable. Choose another in Model and effort.', { exact: true })).toBeVisible()
      await expect(paneB.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
      await page.screenshot({ path: testInfo.outputPath('missing-agent-binding.png') })
      await paneB.getByRole('button', { name: 'Model and effort', exact: true }).click()
      const repair = paneB.getByRole('dialog', { name: 'Model and effort', exact: true })
      const repairAgent = repair.getByRole('combobox', { name: 'Conversation Agent', exact: true })
      await expect(repairAgent).toBeVisible()
      await expect(repairAgent.locator(`option[value="${DEFAULT_AGENT_ID}"]`)).toHaveText('Default agent')
      await repairAgent.selectOption(DEFAULT_AGENT_ID)
      await expect.poll(async () => (await readSession()).agentId).toBe(DEFAULT_AGENT_ID)
      await expect(paneB.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('repaired-agent-binding.png') })
    }
  } finally {
    await Promise.allSettled([owner.context.close(), foreign?.context.close()])
    await peer.close()
  }
}

test('Claude ordinary conversations bind, send and retain their Agent', async ({ browser }, testInfo) => workflow(browser, testInfo, 'anthropic', true))
test('DeepSeek ordinary conversations bind and use the Messages route', async ({ browser }, testInfo) => workflow(browser, testInfo, 'deepseek'))
test('OpenAI ordinary conversations bind and use the Responses route', async ({ browser }, testInfo) => workflow(browser, testInfo, 'openai'))

test('pending Agent changes hold Send and Retry only in their own conversation', async ({ browser }) => {
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, { 'x-user-id': `user-binding-hold-${stamp}`, 'x-tenant-id': `tenant-binding-hold-${stamp}` })
  const { page } = owner
  let releasePatch!: () => void
  const patchGate = new Promise<void>(resolve => { releasePatch = resolve })
  try {
    const agentResponse = await page.request.post(`${API}/agents`, { data: {
      label: `Pending selection ${stamp}`, providerId: DEFAULT_PROVIDER_ID, systemPromptId: 'sp-concise-reviewer', tools: [],
    } })
    expect(agentResponse.ok(), await agentResponse.text()).toBe(true)
    const agent = await agentResponse.json() as Agent
    const create = async (agentId: string) => {
      const response = await page.request.post(`${API}/sessions`, { data: { firstMessage: `Orphaned turn ${randomUUID()}`, agentId, persistFirstMessage: true } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json() as Promise<Session>
    }
    const first = await create(agent.id)
    const second = await create(DEFAULT_AGENT_ID)
    let reachedPatch!: () => void
    const patchReached = new Promise<void>(resolve => { reachedPatch = resolve })
    let sends = 0
    await page.route(`**${API}/sessions/*/messages`, async route => { sends += 1; await route.continue() })
    await page.route(`**${API}/sessions/${first.id}`, async route => {
      if (route.request().method() === 'PATCH') { reachedPatch(); await patchGate }
      await route.continue()
    })
    await page.goto(`/s/${first.id}`)
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(retry).toBeVisible()
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await page.getByRole('combobox', { name: 'Conversation Agent', exact: true }).selectOption(DEFAULT_AGENT_ID)
    await patchReached
    await page.keyboard.press('Escape')
    await expect(retry).toHaveCount(0)
    await expect(composer).toBeDisabled()
    // Same SPA navigation retains the exact queue; full reload would discard
    // the client hold and make the scope assertion vacuous.
    await page.getByRole('button', { name: 'Expand Sessions', exact: true }).click()
    await (await revealSessionRow(page, second.title)).click()
    await expect(page).toHaveURL(`/s/${second.id}`)
    await expect(retry).toBeVisible()
    await expect(composer).toBeEnabled()
    await (await revealSessionRow(page, first.title)).click()
    await expect(page).toHaveURL(`/s/${first.id}`)
    await expect(retry).toHaveCount(0)
    await expect(composer).toBeDisabled()
    releasePatch()
    await expect(retry).toBeVisible()
    await expect(composer).toBeEnabled()
    expect(sends).toBe(0)
  } finally {
    releasePatch()
    await owner.context.close()
  }
})

test('a lost Agent-change acknowledgement stays held until a Dismiss reconciliation succeeds', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, { 'x-user-id': `user-binding-reconcile-${stamp}`, 'x-tenant-id': `tenant-binding-reconcile-${stamp}` })
  const { page } = owner
  try {
    const agentResponse = await page.request.post(`${API}/agents`, { data: {
      label: `Reconcile selection ${stamp}`, providerId: DEFAULT_PROVIDER_ID, systemPromptId: 'sp-concise-reviewer', tools: [],
    } })
    expect(agentResponse.ok(), await agentResponse.text()).toBe(true)
    const agent = await agentResponse.json() as Agent
    const sessionResponse = await page.request.post(`${API}/sessions`, { data: {
      firstMessage: `Review the saved Agent binding ${stamp}`, agentId: agent.id, persistFirstMessage: true,
    } })
    expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
    const session = await sessionResponse.json() as Session

    let failSessionReads = false
    let patchCount = 0
    let messageCount = 0
    const sessionPath = `${API}/sessions/${encodeURIComponent(session.id)}`
    await page.route(url => url.pathname === sessionPath, async route => {
      const method = route.request().method()
      if (method === 'PATCH') {
        patchCount += 1
        const committed = await route.fetch()
        expect(committed.ok(), await committed.text()).toBe(true)
        failSessionReads = true
        // The server commits, but this browser loses the acknowledgement.
        await route.abort('failed')
        return
      }
      if (method === 'GET' && failSessionReads) {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'test-owned temporary read failure' })
        return
      }
      await route.continue()
    })
    await page.route(url => url.pathname === `${sessionPath}/messages`, async route => {
      messageCount += 1
      await route.continue()
    })

    await page.goto(`/s/${session.id}`)
    const pane = page.locator(`[data-conversation-pane="${session.id}"]`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    const retry = pane.getByRole('button', { name: 'Retry', exact: true })
    await expect(pane).toBeVisible()
    await expect(retry).toBeVisible()
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await page.getByRole('combobox', { name: 'Conversation Agent', exact: true }).selectOption(DEFAULT_AGENT_ID)
    await expect.poll(() => patchCount).toBe(1)

    const notice = page.locator('[data-session-metadata-mutation="failed"]')
    await expect(notice).toBeVisible()
    await expect(composer).toBeDisabled()
    await expect(retry).toHaveCount(0)
    await page.keyboard.press('Escape')
    const committed = await page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
    expect(committed.ok(), await committed.text()).toBe(true)
    expect((await committed.json() as Session).agentId).toBe(DEFAULT_AGENT_ID)

    // Dismiss is read-only; its failed authoritative read must not release the
    // binding lock or expose Retry for the orphaned user turn.
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notice).toContainText('Couldn’t read saved changes. Dismiss again to recheck without resending.')
    await expect(composer).toBeDisabled()
    await expect(retry).toHaveCount(0)
    expect(patchCount).toBe(1)
    expect(messageCount).toBe(0)

    // The next Dismiss succeeds only after read recovery. It must project the
    // committed Agent without replaying the PATCH or the orphaned message.
    failSessionReads = false
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(composer).toBeEnabled()
    await expect(retry).toBeVisible()
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(DEFAULT_AGENT_ID)
    await page.keyboard.press('Escape')
    expect(patchCount).toBe(1)
    expect(messageCount).toBe(0)
  } finally {
    await owner.context.close()
  }
})
