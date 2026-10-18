/** Real pre-persist budget refusal and explicit recovery over authored Claude,
 * mounted DeepSeek and native Responses peers. No public provider traffic. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import type { Agent, ModelProvider, Session, SystemPromptEntry } from '../contract/index.ts'
import type { UsageSnapshot } from '../contract/usage.ts'
import { newUser } from './social-helpers.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { startProviderRoutinePeer, type ProviderRoutinePreset } from './provider-routine-peer.ts'

const API = '/api/v1'
const FIVE_HOUR = '5-hour limit'
const WEEKLY = 'Weekly · all models'
const REVIEW_VIEWPORTS = [{ width: 320, height: 700 }, { width: 1280, height: 800 }] as const

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

function counters(usage: UsageSnapshot) {
  return usage.limits.map(({ key, usedTokens }) => ({ key, usedTokens }))
}

async function budgetAdmission(browser: Browser, info: TestInfo, preset: ProviderRoutinePreset) {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 10)
  const tenantId = `tenant-provider-budget-${preset}-${stamp}`
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': tenantId })
  const { page } = owner
  let peer: Awaited<ReturnType<typeof startProviderRoutinePeer>> | undefined
  try {
    peer = await startProviderRoutinePeer(preset, stamp)
    const family = preset === 'anthropic' ? 'claude' : preset === 'openai' ? 'gpt' : 'deepseek'
    const provider = await post<ModelProvider>(page, '/providers', {
      label: `${preset} budget boundary ${stamp}`, modelFamily: family, effortLevels: [],
      plan: { windows: [{ label: FIVE_HOUR, ceiling: 0 }, { label: WEEKLY, ceiling: 10_000 }] },
      config: { baseURL: peer.baseURL, model: peer.modelId,
        protocol: preset === 'openai' ? 'openai-responses' : 'anthropic-messages' },
    })
    expect(provider).toMatchObject({ execution: 'configured', defaultModelId: peer.modelId,
      protocol: preset === 'openai' ? 'openai-responses' : 'anthropic-messages' })
    const prompt = await post<SystemPromptEntry>(page, '/system-prompts', {
      label: `${preset} budget prompt ${stamp}`, targetFamily: family, body: 'Answer briefly without tools.',
    })
    const agent = await post<Agent>(page, '/agents', {
      label: `${preset} budget Agent ${stamp}`, providerId: provider.id, systemPromptId: prompt.id,
      tools: [], instructions: 'Keep the local fixture response brief and use no tools.',
    })
    expect(agent.budget, 'this Agent inherits its provider plan through actual absence').toBeUndefined()
    const session = await post<Session>(page, '/sessions', {
      firstMessage: `${preset} provider budget recovery ${stamp}`, agentId: agent.id,
    })
    expect(session.providerId, 'the conversation inherits its Agent provider').toBeUndefined()
    const original = await read<Session>(page, `/sessions/${session.id}`)
    expect(original.messages ?? []).toEqual([])
    const beforeUsage = counters(await read<UsageSnapshot>(page, `/usage?session=${session.id}`))
    expect(beforeUsage.every(window => window.usedTokens === 0), 'the test owns a fresh account usage partition').toBe(true)
    expect(peer.generationRequests(), 'registration conformance probes are excluded from generation').toHaveLength(0)

    const attempts: Array<{ text: string; key: string }> = []
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions/${session.id}/messages`) {
        attempts.push({ text: request.postDataJSON().text, key: request.headers()['idempotency-key'] ?? '' })
      }
    })
    await page.goto(`/s/${session.id}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeEnabled()
    const intent = `Preserve this exact ${preset} user intent ${stamp} until I explicitly retry.`
    await composer.fill(intent)
    const refusalPromise = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `${API}/sessions/${session.id}/messages`)
    await composer.press('Enter')
    const refusal = await refusalPromise
    expect(refusal.status(), 'the real server rejects the inherited zero provider cap').toBe(429)
    expect(await refusal.json()).toMatchObject({ error: { code: 'limit_exceeded' } })
    const error = page.getByRole('alert').filter({ hasText: /Plan limit reached for '5-hour limit'/ })
    await expect(error).toContainText('this turn is refused until the window resets')
    await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
    expect(peer.generationRequests(), 'a pre-persist refusal performs no generation').toHaveLength(0)
    expect((await read<Session>(page, `/sessions/${session.id}`)).messages ?? []).toEqual(original.messages ?? [])
    expect(counters(await read<UsageSnapshot>(page, `/usage?session=${session.id}`))).toEqual(beforeUsage)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].text).toBe(intent)
    expect(attempts[0].key).not.toBe('')

    for (const viewport of REVIEW_VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(error).toBeInViewport()
      await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport()
      await settledOpaquePaint(error)
      await expect.poll(async () => {
        const box = await error.boundingBox()
        return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width
          && box.y + box.height <= viewport.height
      }).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(page, `${preset} inherited provider-budget refusal ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: info.outputPath(`${preset}-budget-refusal-${viewport.width}x${viewport.height}.png`) })
    }

    const current = await read<ModelProvider>(page, `/providers/${provider.id}`)
    const raised = await page.request.patch(`${API}/providers/${provider.id}`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { expectedRevision: current.definitionRevision ?? 0,
        plan: { windows: [{ label: FIVE_HOUR, ceiling: 1_000 }, { label: WEEKLY, ceiling: 10_000 }] } },
    })
    expect(raised.ok(), await raised.text()).toBe(true)
    expect((await raised.json() as ModelProvider).definitionRevision).toBe((current.definitionRevision ?? 0) + 1)
    expect((await read<Agent>(page, `/agents/${agent.id}`)).budget).toBeUndefined()
    expect(peer.generationRequests(), 'raising a plan does not automatically replay user intent').toHaveLength(0)
    const retryPromise = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `${API}/sessions/${session.id}/messages`)
    await error.getByRole('button', { name: 'Retry', exact: true }).click()
    expect((await retryPromise).status()).toBe(200)
    await expect(page.locator('main [data-turn]').filter({ hasText: peer.reply })).toHaveCount(1)
    await expect(error).toHaveCount(0)
    await expect.poll(async () => (await read<Session>(page, `/sessions/${session.id}`)).messages?.map(message => message.role))
      .toEqual(['user', 'assistant'])
    const completed = await read<Session>(page, `/sessions/${session.id}`)
    expect(completed.messages?.map(message => message.content)).toEqual([intent, peer.reply])
    expect(peer.generationRequests()).toHaveLength(1)
    const generated = peer.generationRequests()[0]
    expect(generated.path).toBe(preset === 'openai' ? '/v1/responses' : preset === 'deepseek' ? '/anthropic/v1/messages' : '/v1/messages')
    expect(generated.body).toMatchObject({ model: peer.modelId })
    expect(JSON.stringify(generated.body).split(intent)).toHaveLength(2)
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
    const afterUsage = counters(await read<UsageSnapshot>(page, `/usage?session=${session.id}`))
    const tokens = 3 + Math.max(1, Math.ceil(peer.reply.length / 4))
    expect(afterUsage).toEqual(beforeUsage.map(window => ({ ...window, usedTokens: window.usedTokens + tokens })))

    await page.reload()
    await expect(page.locator('main [data-turn]').filter({ hasText: peer.reply })).toHaveCount(1)
    await expect(page.locator('main [data-turn]').filter({ hasText: intent })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
    expect((await read<Session>(page, `/sessions/${session.id}`)).messages).toEqual(completed.messages)
    expect(counters(await read<UsageSnapshot>(page, `/usage?session=${session.id}`))).toEqual(afterUsage)
    expect(peer.generationRequests(), 'reload never repeats a settled paid-work boundary').toHaveLength(1)
    expect(attempts).toHaveLength(2)
  } finally {
    await owner.context.close()
    await peer?.close()
  }
}

test('Claude-root Send respects inherited provider budget and retries exactly once after repair', async ({ browser }, info) => {
  await budgetAdmission(browser, info, 'anthropic')
})

test('DeepSeek-mounted Send respects inherited provider budget and retries exactly once after repair', async ({ browser }, info) => {
  await budgetAdmission(browser, info, 'deepseek')
})

test('OpenAI Responses Send respects inherited provider budget and retries exactly once after repair', async ({ browser }, info) => {
  await budgetAdmission(browser, info, 'openai')
})
