/** Recovery walks for Continue from here: a whole copied conversation must not
 * duplicate merely because its creation acknowledgement was lost. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { sessionForkCreationId } from '../server/sessionCreationIdentity.ts'
import { ms } from './budget.ts'
import { API, TURN_SESSION, newUser } from './social-helpers.ts'

const SOURCE_ID = TURN_SESSION.split('/s/')[1]!
const AUDIENCE = 'tenant-beta'

async function grantBranchAccess(browser: Browser) {
  const owner = await newUser(browser)
  const response = await owner.page.request.post(`${API}/grants`, {
    headers: { 'Idempotency-Key': `session-fork-grant-${crypto.randomUUID()}` },
    data: {
      subject: { kind: 'session', id: SOURCE_ID },
      audience: { kind: 'org', orgId: AUDIENCE },
      tier: 'propose',
    },
  })
  expect(response.ok()).toBe(true)
  await owner.context.close()
  return newUser(browser, { 'x-tenant-id': AUDIENCE })
}

async function branchAtSecondTurn(page: Page) {
  await page.goto(TURN_SESSION)
  const actions = page.getByTitle('Continue from here')
  await expect(actions.first()).toBeAttached({ timeout: ms(20_000) })
  expect(await actions.count()).toBeGreaterThan(1)
  return actions.nth(1)
}

async function readBranch(page: Page, sessionId: string) {
  return await (await page.request.get(`${API}/sessions/${sessionId}`)).json() as {
    id: string
    messages: Array<{ id: string; role: string }>
    forkedFrom?: { sessionId: string; atMessageId: string; title: string }
  }
}

test('failed branch creation stays held and Retry preserves one Session copy', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const grace = await grantBranchAccess(browser)
  const creationKeys: string[] = []
  const creationBodies: unknown[] = []
  let failCreate = true

  await grace.page.route(`**${API}/sessions/${SOURCE_ID}/fork`, async (route) => {
    creationKeys.push(route.request().headers()['idempotency-key'] ?? '')
    creationBodies.push(route.request().postDataJSON())
    if (failCreate) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary branch outage' } }),
      })
      return
    }
    await route.continue()
  })

  const action = await branchAtSecondTurn(grace.page)
  await action.evaluate((button) => {
    button.click()
    button.click()
  })

  const notice = grace.page.locator('[data-session-fork="failed"]')
  await expect(notice).toBeVisible({ timeout: ms(20_000) })
  await expect(grace.page.getByRole('button', { name: 'Continuing…' })).toBeDisabled()
  expect(creationKeys).toHaveLength(1)
  expect(creationKeys[0]).toBeTruthy()

  failCreate = false
  await notice.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(grace.page).toHaveURL(/\/s\/sess-fork-/, { timeout: ms(20_000) })
  const sessionId = new URL(grace.page.url()).pathname.split('/s/')[1]!
  expect(sessionId).toBe(sessionForkCreationId(AUDIENCE, creationKeys[0]!))
  const branch = await readBranch(grace.page, sessionId)
  expect(branch.messages).toHaveLength(2)
  expect(branch.forkedFrom).toEqual({
    sessionId: SOURCE_ID,
    atMessageId: branch.messages[1]!.id,
    title: expect.any(String),
  })
  expect(creationKeys).toHaveLength(2)
  expect(new Set(creationKeys)).toEqual(new Set([creationKeys[0]!]))
  expect(creationBodies[1]).toEqual(creationBodies[0])
  const sessions = await (await grace.page.request.get(`${API}/sessions`)).json() as Array<{ id: string }>
  expect(sessions.filter((session) => session.id === sessionId)).toHaveLength(1)

  await grace.context.close()
})

test('lost branch acknowledgement reconciles and opens the exact durable copy', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const grace = await grantBranchAccess(browser)
  const creationKeys: string[] = []

  await grace.page.route(`**${API}/sessions/${SOURCE_ID}/fork`, async (route) => {
    creationKeys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Branch acknowledgement lost' } }),
    })
  })

  const action = await branchAtSecondTurn(grace.page)
  await action.click()
  await expect(grace.page).toHaveURL(/\/s\/sess-fork-/, { timeout: ms(20_000) })
  const sessionId = new URL(grace.page.url()).pathname.split('/s/')[1]!
  expect(creationKeys).toHaveLength(1)
  expect(sessionId).toBe(sessionForkCreationId(AUDIENCE, creationKeys[0]!))
  const branch = await readBranch(grace.page, sessionId)
  expect(branch.messages).toHaveLength(2)
  expect(branch.forkedFrom?.sessionId).toBe(SOURCE_ID)
  await expect(grace.page.locator('[data-session-fork]')).toHaveCount(0)

  await grace.context.close()
})
