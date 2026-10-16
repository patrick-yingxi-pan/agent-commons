/** Rendered conversation provenance stays attached to the turn that produced it.
 *
 * The sessions and authorization reads below are real and test-owned. Where a
 * turn needs a provider/model combination that the isolated server did not
 * execute, this spec substitutes an explicitly named rendering fixture only
 * after the real authorized GET has succeeded. This proves UI projection, not
 * live Claude/OpenAI/DeepSeek protocol execution.
 */
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Agent, Message, ModelProvider, Session } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

const LONG_AGENT = 'Research Agent for Cross-Functional Product Reliability Reviews'
const LONG_OPENAI = 'OpenAI production connection for the Acme product reliability workspace'
const LONG_ANTHROPIC = 'Anthropic Claude production connection for the shared engineering workspace'
const LONG_DEEPSEEK = 'DeepSeek production connection for economical long-context analysis'
const LONG_DEEPSEEK_MODEL = `deepseek-${'production-model-identifier-'.repeat(8)}v3`
const LONG_RELAY = 'Delegated desktop Claude session for the product reliability workspace'

const MESSAGE_IDS = {
  openai: 'provenance-openai',
  anthropic: 'provenance-anthropic',
  deepseek: 'provenance-deepseek',
  relay: 'provenance-relay',
  noProvider: 'provenance-no-provider',
  noRecordedModel: 'provenance-no-model',
  unknownAgent: 'provenance-unknown-agent',
  unavailable: 'provenance-unavailable',
} as const

/** Stamps used only by this browser projection fixture. The provider rows keep
 * seeded IDs where the live session PATCH needs the real catalog, while the
 * DeepSeek and relay entries deliberately exist only in this rendered response. */
const PROJECTION_MESSAGES: Message[] = [
  { id: 'provenance-user', role: 'user', content: 'Compare the exact provider and model recorded for these historical turns.' },
  { id: MESSAGE_IDS.openai, role: 'assistant', content: 'OpenAI provenance fixture.', agentId: 'agent-default', providerId: 'provider-openai', modelId: 'gpt-5.1' },
  { id: MESSAGE_IDS.anthropic, role: 'assistant', content: 'Claude provenance fixture.', agentId: 'agent-provenance-long', providerId: 'provider-anthropic', modelId: 'claude-opus-4-8' },
  { id: MESSAGE_IDS.deepseek, role: 'assistant', content: 'DeepSeek provenance fixture.', agentId: 'agent-provenance-long', providerId: 'provider-provenance-deepseek', modelId: LONG_DEEPSEEK_MODEL },
  { id: MESSAGE_IDS.relay, role: 'assistant', content: 'Delegated session provenance fixture.', agentId: 'agent-provenance-long', providerId: 'provider-provenance-relay' },
  { id: MESSAGE_IDS.noProvider, role: 'assistant', content: 'Legacy turn without model identity.', agentId: 'agent-default' },
  { id: MESSAGE_IDS.noRecordedModel, role: 'assistant', content: 'Legacy turn with only a model id.', agentId: 'agent-default', modelId: 'retired-model-id' },
  { id: MESSAGE_IDS.unknownAgent, role: 'assistant', content: 'Turn from an Agent no longer in this registry.', agentId: 'private-or-deleted-agent', providerId: 'provider-openai', modelId: 'gpt-4.1' },
  { id: MESSAGE_IDS.unavailable, role: 'assistant', content: 'Turn from a no-longer-visible connection.', agentId: 'agent-default', providerId: 'private-or-deleted-provider', modelId: 'former-private-model' },
]

function projectionProviders(providers: ModelProvider[]): ModelProvider[] {
  const openai = providers.find((provider) => provider.id === 'provider-openai')
  const anthropic = providers.find((provider) => provider.id === 'provider-anthropic')
  if (!openai || !anthropic) throw new Error('The test tenant must read the seeded OpenAI and Anthropic registry entries.')
  return [
    ...providers.map((provider) => provider.id === openai.id
      ? { ...provider, label: LONG_OPENAI }
      : provider.id === anthropic.id
        ? { ...provider, label: LONG_ANTHROPIC }
        : provider),
    {
      ...openai,
      id: 'provider-provenance-deepseek',
      label: LONG_DEEPSEEK,
      modelFamily: 'deepseek',
      models: [{ id: LONG_DEEPSEEK_MODEL, label: 'DeepSeek Chat', contextWindow: 128_000 }],
      execution: 'configured',
    },
    {
      ...anthropic,
      id: 'provider-provenance-relay',
      label: LONG_RELAY,
      kind: 'session',
      execution: undefined,
      online: true,
      models: undefined,
    },
  ]
}

/** Install read-projection fixtures without bypassing server authorization.
 * Each intercepted GET first reaches the real router, then changes only the
 * provider/Agent/message presentation returned to this browser. */
async function installProjectionFixtures(page: Page, sessionId: string, options: { providersGate?: Promise<void> } = {}) {
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await options.providersGate
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    const providers = await response.json() as ModelProvider[]
    await route.fulfill({ response, json: projectionProviders(providers) })
  })
  await page.route('**/api/v1/agents', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    const agents = await response.json() as Agent[]
    const defaultAgent = agents.find((agent) => agent.id === 'agent-default')
    if (!defaultAgent) throw new Error('The real authorized Agent read must include the seeded Default agent.')
    await route.fulfill({
      response,
      json: [...agents, { ...defaultAgent, id: 'agent-provenance-long', label: LONG_AGENT }],
    })
  })
  await page.route(`**/api/v1/sessions/${encodeURIComponent(sessionId)}?*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    const session = await response.json() as Session
    await route.fulfill({ response, json: { ...session, messages: PROJECTION_MESSAGES } })
  })
}

async function createSession(page: Page, label: string): Promise<string> {
  const response = await page.request.post(`${API}/sessions`, {
    data: { firstMessage: `${label} ${crypto.randomUUID()}`, persistFirstMessage: true },
    headers: { 'Idempotency-Key': `conversation-provenance-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const session = await response.json() as { id: string }
  expect(session.id).toBeTruthy()
  return session.id
}

async function signInSeed(page: Page, email: string, password: string, accountName: string) {
  const response = await page.request.post(`${API}/auth/login`, { data: { email, password } })
  expect(response.ok(), await response.text()).toBeTruthy()
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText(accountName)
}

function turn(page: Page, id: string) {
  return page.locator(`[data-turn="${id}"]`)
}

test('stamped conversation provenance stays with each turn after the current model changes', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const identity = crypto.randomUUID()
  const owned = await newUser(browser, {
    'x-user-id': `user-conversation-provenance-${identity}`,
    'x-tenant-id': `tenant-conversation-provenance-${identity}`,
  })
  const { page } = owned
  try {
    const sessionId = await createSession(page, 'Conversation provenance')
    await installProjectionFixtures(page, sessionId)
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toHaveAttribute('placeholder', 'Message…')
    await expect(composer).toBeEnabled()

    await expect(turn(page, MESSAGE_IDS.openai).locator('[data-turn-author]')).toHaveText('Default agent')
    await expect(turn(page, MESSAGE_IDS.openai).locator('[data-turn-model]')).toHaveText(`${LONG_OPENAI} · gpt-5.1`)
    await expect(turn(page, MESSAGE_IDS.anthropic).locator('[data-turn-author]')).toHaveText(LONG_AGENT)
    await expect(turn(page, MESSAGE_IDS.anthropic).locator('[data-turn-model]')).toHaveText(`${LONG_ANTHROPIC} · claude-opus-4-8`)
    await expect(turn(page, MESSAGE_IDS.deepseek).locator('[data-turn-model]')).toHaveText(`${LONG_DEEPSEEK} · ${LONG_DEEPSEEK_MODEL}`)
    await expect(turn(page, MESSAGE_IDS.relay).locator('[data-turn-model]')).toHaveText(`${LONG_RELAY} · via your delegated session`)

    // Change the current session choice through the real picker/PATCH. Historical
    // turn metadata remains sourced from its message stamp, never today's pick.
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Model and effort' })
    await picker.getByRole('button').filter({ hasText: LONG_OPENAI }).click()
    await picker.getByRole('button', { name: /GPT-5\.1 mini/ }).click()
    await expect.poll(async () => {
      const response = await page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
      expect(response.ok()).toBeTruthy()
      const current = await response.json() as Session
      return [current.providerId, current.modelId]
    }).toEqual(['provider-openai', 'gpt-5.1-mini'])
    await expect(turn(page, MESSAGE_IDS.openai).locator('[data-turn-model]')).toHaveText(`${LONG_OPENAI} · gpt-5.1`)
    await expect(turn(page, MESSAGE_IDS.anthropic).locator('[data-turn-model]')).toHaveText(`${LONG_ANTHROPIC} · claude-opus-4-8`)
    await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    await expect(picker).toHaveCount(0)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      const reviewedTurn = turn(page, MESSAGE_IDS.deepseek)
      await reviewedTurn.scrollIntoViewIfNeeded()
      const author = reviewedTurn.locator('[data-turn-author]')
      const model = reviewedTurn.locator('[data-turn-model]')
      await expect(author).toBeVisible()
      await expect(model).toBeVisible()
      for (const [label, node] of [['author', author], ['model', model]] as const) {
        const geometry = await node.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
        expect(geometry.clientWidth, `${label} has rendered width at ${viewport.width}×${viewport.height}`).toBeGreaterThan(0)
        expect(geometry.scrollWidth, `${label} text does not overflow at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(geometry.clientWidth)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        `the long Agent/provider/model labels fit at ${viewport.width}×${viewport.height}`).toBe(true)
      const pickerBounds = await page.getByRole('button', { name: 'Model and effort', exact: true }).boundingBox()
      const usageBounds = await page.getByRole('button', { name: /^Usage —/ }).boundingBox()
      const controls = page.locator('[data-composer-model-controls]')
      const controlsBounds = await controls.boundingBox()
      expect(pickerBounds, 'the model selector is rendered').not.toBeNull()
      expect(usageBounds, 'the Usage control is rendered').not.toBeNull()
      expect(controlsBounds, 'the constrained model-controls group is rendered').not.toBeNull()
      expect(await controls.evaluate(element => element.scrollWidth <= element.clientWidth),
        'no standing action overflows the constrained group').toBe(true)
      expect(usageBounds!.x + usageBounds!.width, 'Usage stays inside its own control group')
        .toBeLessThanOrEqual(controlsBounds!.x + controlsBounds!.width + 1)
      expect(usageBounds!.x + usageBounds!.width,
        `Usage is not clipped behind the shell at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(viewport.width - 12)
      expect(pickerBounds!.x, 'the model selector stays inside the composer').toBeGreaterThanOrEqual(12)
      await settledOpaquePaint(reviewedTurn)
      await assertWcag22Aa(page, `conversation provenance ${viewport.width}×${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`conversation-provenance-${viewport.width}x${viewport.height}.png`) })
    }
  } finally {
    await owned.context.close()
  }
})

test('legacy and unavailable turn stamps stay honest while the provider registry loads', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const sessionId = await createSession(page, 'Unknown provenance')
  let releaseProviders!: () => void
  const providersGate = new Promise<void>((resolve) => { releaseProviders = resolve })
  await installProjectionFixtures(page, sessionId, { providersGate })
  try {
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await expect(turn(page, MESSAGE_IDS.unavailable).locator('[data-turn-model]'))
      .toHaveText('Loading model connection… · former-private-model')
    await expect(turn(page, MESSAGE_IDS.noProvider).locator('[data-turn-model]')).toHaveText('Model details not recorded')
    await expect(turn(page, MESSAGE_IDS.noRecordedModel).locator('[data-turn-model]'))
      .toHaveText('Model connection not recorded · retired-model-id')
    await expect(turn(page, MESSAGE_IDS.unavailable).locator('[data-turn-author]')).toHaveText('Default agent')
    await expect(turn(page, MESSAGE_IDS.unknownAgent).locator('[data-turn-author]')).toHaveText('Assistant')
  } finally {
    releaseProviders()
  }
  await expect(turn(page, MESSAGE_IDS.unavailable).locator('[data-turn-model]'))
    .toHaveText('Model connection unavailable · former-private-model')
  await expect(turn(page, MESSAGE_IDS.noProvider).locator('[data-turn-author]')).toHaveText('Default agent')
  await expect(turn(page, MESSAGE_IDS.noRecordedModel).locator('[data-turn-author]')).toHaveText('Default agent')
  await expect(turn(page, MESSAGE_IDS.unavailable).locator('[data-turn-author]')).toHaveText('Default agent')
  await expect(turn(page, MESSAGE_IDS.unknownAgent).locator('[data-turn-author]')).toHaveText('Assistant')
  await expect(turn(page, MESSAGE_IDS.unknownAgent).locator('[data-turn-model]')).toHaveText(`${LONG_OPENAI} · gpt-4.1`)
  await expect(turn(page, MESSAGE_IDS.deepseek).locator('[data-turn-model]')).toHaveText(`${LONG_DEEPSEEK} · ${LONG_DEEPSEEK_MODEL}`)
})

test('shared readers see the authorized stamped transcript and foreign tenants remain walled', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(75_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser)
  const foreign = await newUser(browser)
  try {
    await signInSeed(owner.page, 'ada@acme.example', 'ada-demo-password', 'Ada Lovelace')
    await signInSeed(reader.page, 'grace@acme.example', 'grace-demo-password', 'Grace Hopper')
    await signInSeed(foreign.page, 'maya@growthworks.example', 'maya-demo-password', 'Maya Chen')

    const sessionId = await createSession(owner.page, 'Shared provenance')
    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()

    await installProjectionFixtures(owner.page, sessionId)
    await installProjectionFixtures(reader.page, sessionId)
    await owner.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await reader.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await expect(owner.page.locator(`[data-turn="${MESSAGE_IDS.openai}"] [data-turn-model]`))
      .toHaveText(`${LONG_OPENAI} · gpt-5.1`)
    await expect(reader.page.locator(`[data-turn="${MESSAGE_IDS.openai}"] [data-turn-model]`))
      .toHaveText(`${LONG_OPENAI} · gpt-5.1`)
    const readerComposer = reader.page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(readerComposer).toBeDisabled()
    await expect(readerComposer).toHaveAttribute('placeholder', 'Only the conversation owner can send messages.')

    const foreignRead = await foreign.page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
    expect(foreignRead.status()).toBe(404)
    const renderedForeignRead = foreign.page.waitForResponse((response) =>
      new URL(response.url()).pathname === `${API}/sessions/${encodeURIComponent(sessionId)}` && response.request().method() === 'GET')
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await renderedForeignRead).status()).toBe(404)
    await expect(foreign.page.locator('[data-conversation-pane="draft"]')
      .getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    await expect(foreign.page.getByTestId('account-chip')).toContainText('Maya Chen')
    await expect(foreign.page.locator('[data-turn-author]')).toHaveCount(0)
    await expect(foreign.page.locator('[data-turn-model]')).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('a failed provider registry read preserves recorded model IDs and recovers on reload', async ({ page }) => {
  const sessionId = await createSession(page, 'Failed provenance registry')
  await installProjectionFixtures(page, sessionId)
  let failRegistry = true
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() !== 'GET' || !failRegistry) return route.fallback()
    await route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Test-owned provider read failed.' } }) })
  })
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  await expect(turn(page, MESSAGE_IDS.openai).locator('[data-turn-model]'))
    .toHaveText('Model connection could not be loaded · gpt-5.1')
  await expect(turn(page, MESSAGE_IDS.noProvider).locator('[data-turn-model]'))
    .toHaveText('Model details not recorded')
  failRegistry = false
  await page.reload()
  await expect(turn(page, MESSAGE_IDS.openai).locator('[data-turn-model]'))
    .toHaveText(`${LONG_OPENAI} · gpt-5.1`)
})

test('composer shows neutral idle and busy copy for a held generation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const sessionId = await createSession(page, 'Composer identity')
  await installProjectionFixtures(page, sessionId)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await expect(composer).toHaveAttribute('placeholder', 'Message…')
  await expect(composer).toBeEnabled()

  let releaseSend!: () => void
  let markSendHeld!: () => void
  const sendGate = new Promise<void>((resolve) => { releaseSend = resolve })
  const sendHeld = new Promise<void>((resolve) => { markSendHeld = resolve })
  await page.route(`**/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    markSendHeld()
    await sendGate
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Held test response released.' } }),
    })
  })
  try {
    await composer.fill('Hold this test-owned send briefly.')
    await composer.press('Enter')
    await sendHeld
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', 'Generating a reply…')
  } finally {
    releaseSend()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
