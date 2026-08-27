/** The live-turn affordances (multi-account design §6.5, built in P6c): the
 *  STOP button cancels the SERVER-owned turn mid-stream — the partial persists
 *  as the record and the streaming state stands down. (The cancel route's
 *  semantics are node-locked in server/routes/turns.test.ts; this locks the UI
 *  wiring: button → cancelTurn → stream end → coherent thread.) */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
const PACED_MESSAGE = `paced stop me please ${STAMP}`
const RETRY_MESSAGE = `recover one logical turn ${STAMP}`
const DRAFT_RETRY_MESSAGE = `recover draft materialization ${STAMP}`

test('Stop mid-stream: the partial persists, the streaming state stands down', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()

  await page.getByPlaceholder('Reply to Claude…').fill(PACED_MESSAGE)
  await page.keyboard.press('Enter')

  // Mid-stream: the stop affordance is up and some text has arrived.
  await expect(page.getByText('Claude is writing…')).toBeVisible({ timeout: ms(15_000) })
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  // The affordance stands down (the stream's own message.end cleared it).
  await expect(page.getByText('Claude is writing…')).toHaveCount(0, { timeout: ms(10_000) })

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
  // Keep this specifically a MANUAL recovery walk. With ambient events live,
  // session.updated truthfully reconciles the persisted assistant before the
  // lost response can surface Retry (covered by the pure controller lock).
  await page.route('**/api/v1/events*', (route) => route.abort('connectionrefused'))
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    const request = route.request()
    attempts.push({
      key: await request.headerValue('idempotency-key'),
      body: request.postDataJSON() as { text?: string; retryLastUser?: boolean },
    })
    if (!dropFirstResponse) {
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
    await route.abort('connectionrefused')
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByPlaceholder('Reply to Claude…').fill(RETRY_MESSAGE)
  await page.keyboard.press('Enter')

  const interrupted = page.getByRole('alert')
  await expect(interrupted).toBeVisible({ timeout: ms(20_000) })
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

test('Retry rematerializes a failed draft before sending its preserved user turn', async ({ page }) => {
  test.setTimeout(ms(60_000))
  let failCreate = true
  let failDraftSend = true
  await page.route('**/api/v1/sessions', async (route) => {
    if (route.request().method() === 'POST' && failCreate) {
      failCreate = false
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
  await page.getByPlaceholder('Reply to Claude…').fill(DRAFT_RETRY_MESSAGE)
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
})
