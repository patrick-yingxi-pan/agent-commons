/** The live-turn affordances (multi-account design §6.5, built in P6c): the
 *  STOP button cancels the SERVER-owned turn mid-stream — the partial persists
 *  as the record and the streaming state stands down. (The cancel route's
 *  semantics are node-locked in server/routes/turns.test.ts; this locks the UI
 *  wiring: button → cancelTurn → stream end → coherent thread.) */
import { test, expect, type Page } from '@playwright/test'
import type { Identity } from '../contract/index.ts'
import { sessionCreationId } from '../server/sessionCreationIdentity.ts'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
const PACED_MESSAGE = `paced stop me please ${STAMP}`
const RETRY_MESSAGE = `recover one logical turn ${STAMP}`
const DRAFT_RETRY_MESSAGE = `recover draft materialization ${STAMP}`
const LOST_DRAFT_RESPONSE_MESSAGE = `recover one committed draft ${STAMP}`
const CANNED_REPLY = 'The model here is a local mock, so free-form chat is canned — but every organizing act is real. Ask me to *open a workspace*, *connect the repo*, *save a document, sheet, or slide deck*, *file this under a project*, or *have a schedule save a digest*.'

// These tests deliberately spend several complete turns. Keep their plan
// window independent of whatever model-heavy specs share this balanced shard.
test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-grace',
    'x-tenant-id': 'tenant-beta',
  })
})

test('Stop mid-stream: the partial persists, the streaming state stands down', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()

  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(PACED_MESSAGE)
  await page.keyboard.press('Enter')

  // Mid-stream: the stop affordance is up and some text has arrived.
  await expect(page.getByText('Generating a reply…')).toBeVisible({ timeout: ms(15_000) })
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  // The affordance stands down (the stream's own message.end cleared it).
  await expect(page.getByText('Generating a reply…')).toHaveCount(0, { timeout: ms(10_000) })

  // The RECORD holds the cancelled partial: one user turn + one (truncated)
  // assistant turn — shorter than the full canned reply, which ends "…digest.".
  const list = await (await page.request.get('/api/v1/sessions')).json()
  const session = list.find((s: { title: string }) => s.title.startsWith(PACED_MESSAGE.slice(0, 20)))
  expect(session, 'the session exists').toBeTruthy()
  await expect
    .poll(async () => {
      const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
      return {
        roles: (full.messages ?? []).map((m: { role: string }) => m.role),
        live: full.activeTurnId ?? null,
      }
    })
    .toEqual({ roles: ['user', 'assistant'], live: null })
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(full.messages[1].content.length).toBeGreaterThan(0)
  // `toContain` takes ONE argument — a second string is silently discarded, so
  // this explanation never reached a failure report. Carried as a soft assertion
  // message instead, which is where Playwright actually shows it.
  expect(full.messages[1].content, 'the reply was cut short — a partial, not the full text').not.toContain('digest')
})

test('Retry replays one logical send without duplicating the user turn or work', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const attempts: Array<{ key: string | null; body: { text?: string; retryLastUser?: boolean } }> = []
  let dropFirstResponse = true
  let sessionPath: string | undefined
  let holdDetailReads = false
  let retryPostSeen = false
  let deniedDetailReads = 0
  // Keep this specifically a MANUAL recovery walk. With ambient events live,
  // or a successful detail read, the persisted assistant would reconcile
  // before the lost response can surface Retry. Ambient events are offline and
  // detail reads are denied only after the response loss is armed.
  await page.route('**/api/v1/events*', (route) => route.abort('connectionrefused'))
  await page.route('**/api/v1/sessions/*', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (
      request.method() === 'GET' && sessionPath && pathname === sessionPath &&
      holdDetailReads && !retryPostSeen
    ) {
      deniedDetailReads += 1
      await route.abort('connectionrefused')
      return
    }
    await route.continue()
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    const request = route.request()
    sessionPath = new URL(request.url()).pathname.replace(/\/messages$/, '')
    attempts.push({
      key: await request.headerValue('idempotency-key'),
      body: request.postDataJSON() as { text?: string; retryLastUser?: boolean },
    })
    if (!dropFirstResponse) {
      retryPostSeen = true
      await route.continue()
      return
    }
    dropFirstResponse = false
    // Let the server finish and persist the turn, then lose only the browser's
    // view of that response. Retry must therefore hit completed-key replay;
    // a new key or a second optimistic send would create duplicate work.
    const response = await route.fetch()
    expect(response.ok(), 'the server completed the original logical send').toBe(true)
    await response.body()
    holdDetailReads = true
    await route.abort('connectionrefused')
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(RETRY_MESSAGE)
  await page.keyboard.press('Enter')

  const interrupted = page.getByRole('alert')
  await expect(interrupted).toBeVisible({ timeout: ms(20_000) })
  await expect(interrupted.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect.poll(() => deniedDetailReads, { timeout: ms(10_000) })
    .toBeGreaterThan(0)
  await expect(interrupted.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await interrupted.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(interrupted).toHaveCount(0, { timeout: ms(20_000) })
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(20_000) })
  expect(attempts).toHaveLength(2)
  expect(attempts[0]!.key).toBeTruthy()
  expect(attempts[1]!.key).toBe(attempts[0]!.key)
  expect(attempts[0]!.body.retryLastUser).toBeUndefined()
  expect(attempts[1]!.body.retryLastUser).toBe(true)

  const list = await (await page.request.get('/api/v1/sessions')).json()
  const session = list.find((candidate: { title: string }) => candidate.title.startsWith(RETRY_MESSAGE.slice(0, 20)))
  expect(session, 'the retried session exists').toBeTruthy()
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect((full.messages ?? []).map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])
  expect((full.messages ?? []).filter((message: { role: string }) => message.role === 'user')).toHaveLength(1)
})

test('a committed send heals automatically after its response is lost', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const message = `recover automatically after commit ${STAMP}`
  const attempts: Array<{ key: string | null; body: { text?: string; retryLastUser?: boolean } }> = []
  let sessionPath: string | undefined
  let responseLost = false
  let postLossDetailReads = 0
  let completedDetailRead: { roles: string[]; assistant?: string } | undefined

  await page.route('**/api/v1/events*', (route) => route.abort('connectionrefused'))
  await page.route('**/api/v1/sessions/*', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() !== 'GET' || !sessionPath || pathname !== sessionPath || !responseLost) {
      await route.continue()
      return
    }
    postLossDetailReads += 1
    const response = await route.fetch()
    const session = await response.json() as { messages?: Array<{ role: string; content: string }> }
    const messages = session.messages ?? []
    if (messages.length >= 2 && messages.at(-1)?.role === 'assistant') {
      completedDetailRead = {
        roles: messages.map((item) => item.role),
        assistant: messages.at(-1)?.content,
      }
    }
    await route.fulfill({ response, json: session })
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    const request = route.request()
    sessionPath = new URL(request.url()).pathname.replace(/\/messages$/, '')
    attempts.push({
      key: await request.headerValue('idempotency-key'),
      body: request.postDataJSON() as { text?: string; retryLastUser?: boolean },
    })
    const response = await route.fetch()
    expect(response.ok(), 'the server committed the first logical send before its response was lost').toBe(true)
    await response.body()
    responseLost = true
    await route.abort('connectionrefused')
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(message)
  await page.keyboard.press('Enter')

  const reply = page.locator('[data-turn]').filter({ hasText: 'free-form chat is canned' })
  await expect(reply).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: ms(20_000) })
  await expect.poll(() => postLossDetailReads, { timeout: ms(20_000) }).toBeGreaterThan(0)
  await expect.poll(() => completedDetailRead, { timeout: ms(20_000) }).toEqual({
    roles: ['user', 'assistant'],
    assistant: CANNED_REPLY,
  })
  expect(attempts, 'the completed logical send was not automatically posted again').toHaveLength(1)
  expect(attempts[0]!.key).toBeTruthy()
  expect(attempts[0]!.body).toEqual({ text: message })

  const list = await (await page.request.get('/api/v1/sessions')).json()
  const session = list.find((candidate: { title: string }) => candidate.title.startsWith(message.slice(0, 20)))
  expect(session, 'the automatically recovered session exists').toBeTruthy()
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect((full.messages ?? []).map((item: { role: string }) => item.role)).toEqual(['user', 'assistant'])
  expect((full.messages ?? []).filter((item: { role: string }) => item.role === 'user')).toHaveLength(1)
  expect(full.messages[1].content).toBe(CANNED_REPLY)
  await expect(page.locator('[data-turn]')).toHaveCount(2)
  await expect(reply).toContainText(CANNED_REPLY.replace(/\*/g, ''))
})

test('Retry rematerializes a failed draft before sending its preserved user turn', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const creationKeys: string[] = []
  let failedCreates = 0
  let failDraftSend = true
  await page.route('**/api/v1/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      creationKeys.push((await route.request().headerValue('idempotency-key')) ?? '')
    }
    if (route.request().method() === 'POST' && failedCreates < 2) {
      failedCreates += 1
      await route.abort('connectionrefused')
      return
    }
    await route.continue()
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    if (failDraftSend) {
      failDraftSend = false
      await route.abort('connectionrefused')
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(DRAFT_RETRY_MESSAGE)
  await page.keyboard.press('Enter')

  const interrupted = page.getByRole('alert')
  await expect(interrupted.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await interrupted.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(interrupted).toHaveCount(0, { timeout: ms(20_000) })
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(20_000) })

  const list = await (await page.request.get('/api/v1/sessions')).json()
  const session = list.find((candidate: { title: string }) => candidate.title.startsWith(DRAFT_RETRY_MESSAGE.slice(0, 20)))
  expect(session, 'retry materialized a durable session').toBeTruthy()
  // A visible delta proves the second stream is healthy, not that its terminal
  // frame has persisted yet. Poll the record until generation is complete.
  await expect
    .poll(async () => {
      const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
      return {
        roles: (full.messages ?? []).map((message: { role: string }) => message.role),
        live: full.activeTurnId ?? null,
      }
    })
    .toEqual({ roles: ['user', 'assistant'], live: null })
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect((full.messages ?? []).filter((message: { role: string }) => message.role === 'user')).toHaveLength(1)
  expect(creationKeys).toHaveLength(3)
  expect(new Set(creationKeys)).toEqual(new Set([creationKeys[0]!]))
})

test('a committed draft is adopted automatically when its materialization response was lost', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const keys: string[] = []
  const bodies: unknown[] = []
  let attempts = 0
  await page.route('**/api/v1/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push((await route.request().headerValue('idempotency-key')) ?? '')
    bodies.push(route.request().postDataJSON())
    if (attempts > 1) return route.continue()
    const committed = await route.fetch()
    expect(committed.ok(), 'the first draft row committed before acknowledgement was lost').toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Materialization acknowledgement lost.' } }),
    })
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(LOST_DRAFT_RESPONSE_MESSAGE)
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/s\/sess-new-/, { timeout: ms(20_000) })
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(20_000) })

  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const me = (await (await page.request.get('/api/v1/me')).json()) as Identity
  const expectedId = sessionCreationId(me.tenant.id, keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/s/${expectedId}$`))
  await expect(page.getByRole('alert')).toHaveCount(0)
  const list = await (await page.request.get('/api/v1/sessions')).json() as Array<{ id: string }>
  expect(list.filter((session) => session.id === expectedId)).toHaveLength(1)
  const full = await (await page.request.get(`/api/v1/sessions/${expectedId}`)).json()
  expect((full.messages ?? []).filter((message: { role: string }) => message.role === 'user')).toHaveLength(1)
})
