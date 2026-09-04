/** The discussion → conversation bridge is a durable handoff, not a hopeful
 * create-then-send chain. These walks prove the rendered action stays held,
 * one logical Session survives uncertainty, and generation reuses the first
 * user turn committed with that Session. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

const DISCUSSION_PATH = '/discussions/disc-seed-1'

async function expectOneCompletedTurn(page: import('@playwright/test').Page, sessionId: string) {
  await expect.poll(async () => {
    const full = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
    return {
      roles: (full.messages ?? []).map((message: { role: string }) => message.role),
      activeTurnId: full.activeTurnId ?? null,
    }
  }, { timeout: ms(20_000) }).toEqual({ roles: ['user', 'assistant'], activeTurnId: null })
}

test('failed creation stays held and Retry preserves one Session and user turn', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const creationKeys: string[] = []
  const creationBodies: unknown[] = []
  const sendBodies: Array<{ retryLastUser?: boolean }> = []
  let failCreate = true

  await page.route('**/api/v1/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    creationKeys.push((await route.request().headerValue('idempotency-key')) ?? '')
    creationBodies.push(route.request().postDataJSON())
    if (failCreate) {
      await route.abort('connectionrefused')
      return
    }
    await route.continue()
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    sendBodies.push(route.request().postDataJSON() as { retryLastUser?: boolean })
    await route.continue()
  })

  await page.goto(DISCUSSION_PATH)
  await page.getByRole('button', { name: 'Discuss with Claude' }).evaluate((button) => {
    // Two activations in the same task bypass the visual disabled-state timing;
    // the eager facade must still coalesce them onto one logical handoff.
    button.click()
    button.click()
  })

  const notice = page.locator('[data-discussion-session-launch="failed"]')
  await expect(notice).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByRole('button', { name: 'Starting conversation…' })).toBeDisabled()
  expect(creationKeys).toHaveLength(1)
  expect(creationKeys[0]).not.toBe('')
  expect(creationBodies[0]).toMatchObject({ persistFirstMessage: true })

  failCreate = false
  await notice.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page).toHaveURL(/\/s\/sess-new-/, { timeout: ms(20_000) })
  const sessionId = new URL(page.url()).pathname.split('/s/')[1]!
  await expectOneCompletedTurn(page, sessionId)

  expect(creationKeys).toHaveLength(2)
  expect(new Set(creationKeys)).toEqual(new Set([creationKeys[0]!]))
  expect(creationBodies[1]).toEqual(creationBodies[0])
  expect(sendBodies).toHaveLength(1)
  expect(sendBodies[0]?.retryLastUser).toBe(true)
})

test('a lost creation acknowledgement reconciles and opens the exact durable Session', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const creationKeys: string[] = []
  const sendBodies: Array<{ retryLastUser?: boolean }> = []

  await page.route('**/api/v1/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    creationKeys.push((await route.request().headerValue('idempotency-key')) ?? '')
    const committed = await route.fetch()
    expect(committed.ok(), 'the Session and first user turn committed before acknowledgement was lost').toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Creation acknowledgement lost.' } }),
    })
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    sendBodies.push(route.request().postDataJSON() as { retryLastUser?: boolean })
    await route.continue()
  })

  await page.goto(DISCUSSION_PATH)
  await page.getByRole('button', { name: 'Discuss with Claude' }).click()

  await expect(page).toHaveURL(/\/s\/sess-new-/, { timeout: ms(20_000) })
  const sessionId = new URL(page.url()).pathname.split('/s/')[1]!
  await expectOneCompletedTurn(page, sessionId)
  await expect(page.locator('[data-discussion-session-launch]')).toHaveCount(0)

  expect(creationKeys).toHaveLength(1)
  expect(creationKeys[0]).not.toBe('')
  expect(sendBodies).toHaveLength(1)
  expect(sendBodies[0]?.retryLastUser).toBe(true)

  const sessions = await (await page.request.get('/api/v1/sessions')).json() as Array<{ id: string }>
  expect(sessions.filter((session) => session.id === sessionId)).toHaveLength(1)
})
