/** Rendered exact-cursor recovery for the direct-message inbox. */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import type { Discussion } from '../contract/index.ts'
import { gotoSection, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const MAYA_HEADERS = { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' }
const MAYA_NAME = 'Maya Chen'
const ADA_NAME = 'Ada Lovelace'
const STAMP = Date.now().toString(36)
let sequence = 0

async function settleExisting(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/discussions?direct=1')
  expect(response.ok()).toBe(true)
  const existing = ((await response.json()) as Discussion[]).find((row) => row.counterpart === MAYA_NAME)
  if (!existing) return
  const settled = await request.post(`/api/v1/discussions/${existing.id}/read`, { data: {} })
  expect(settled.ok()).toBe(true)
}

async function sendFromMaya(request: APIRequestContext, body: string): Promise<Discussion> {
  const suffix = `${STAMP}-${(sequence += 1)}`
  const response = await request.post('/api/v1/discussions', {
    data: { anchor: { ref: { kind: 'principal', id: ADA_NAME } }, firstPost: body },
    headers: { 'idempotency-key': `discussion-read-message-${suffix}` },
  })
  expect(response.ok()).toBe(true)
  return await response.json() as Discussion
}

const messageRow = (page: Page, text: string) =>
  page.getByRole('main').locator('[data-message-row]').filter({ hasText: text })

test('opening a DM freezes its rendered post across failure, navigation, and a later message', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const ada = await newUser(browser)
  const maya = await newUser(browser, MAYA_HEADERS)
  const earlyBody = `Freeze this read position ${STAMP}`
  const lateBody = `Arrived after the view ${STAMP}`

  try {
    await settleExisting(ada.page.request)
    const thread = await sendFromMaya(maya.page.request, earlyBody)
    const earlyPost = thread.posts[thread.posts.length - 1]!

    await ada.page.goto('/messages')
    const earlyRow = messageRow(ada.page, earlyBody)
    await expect(earlyRow.getByLabel('1 unread')).toBeVisible({ timeout: ms(20_000) })

    const keys: string[] = []
    const bodies: Array<{ throughPostId?: string }> = []
    let attempts = 0
    await ada.page.route(`**/api/v1/discussions/${thread.id}/read*`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      attempts += 1
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      bodies.push(route.request().postDataJSON() as { throughPostId?: string })
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Simulated read-position outage.' } }),
        })
        return
      }
      await route.continue()
    })

    await earlyRow.getByRole('button', { name: MAYA_NAME, exact: true }).click()
    const failure = ada.page.locator('[data-discussion-read="failed"]')
    await expect(failure).toContainText('Couldn’t confirm your read position', { timeout: ms(20_000) })

    await gotoSection(ada.page, 'Models')
    await expect(failure).toBeVisible()
    await sendFromMaya(maya.page.request, lateBody)

    await gotoSection(ada.page, 'Messages')
    const lateRow = messageRow(ada.page, lateBody)
    await expect(lateRow).toHaveAttribute('data-message-read', 'failed')
    await expect(lateRow.getByLabel('2 unread')).toBeVisible()

    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(failure).toHaveCount(0)
    await expect(lateRow.getByLabel('1 unread')).toBeVisible({ timeout: ms(20_000) })
    await expect(lateRow).not.toHaveAttribute('data-message-read', /.+/)

    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe('')
    expect(keys[1]).toBe(keys[0])
    expect(bodies).toEqual([
      { throughPostId: earlyPost.id },
      { throughPostId: earlyPost.id },
    ])
  } finally {
    await maya.context.close()
    await ada.context.close()
  }
})

test('a lost DM read acknowledgement reconciles once and heals another device privately', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const first = await newUser(browser)
  const second = await newUser(browser)
  const maya = await newUser(browser, MAYA_HEADERS)
  const body = `One private read event ${STAMP}`

  try {
    await settleExisting(first.page.request)
    const thread = await sendFromMaya(maya.page.request, body)
    const target = thread.posts[thread.posts.length - 1]!

    for (const page of [first.page, second.page]) {
      await page.goto('/messages')
      await expect(messageRow(page, body).getByLabel('1 unread')).toBeVisible({ timeout: ms(20_000) })
    }

    let attempts = 0
    let requestKey = ''
    let requestBody: { throughPostId?: string } = {}
    await first.page.route(`**/api/v1/discussions/${thread.id}/read*`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      attempts += 1
      requestKey = route.request().headers()['idempotency-key'] ?? ''
      requestBody = route.request().postDataJSON() as { throughPostId?: string }
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await committed.body()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
    })

    await messageRow(first.page, body).getByRole('button', { name: MAYA_NAME, exact: true }).click()
    await expect(first.page.getByRole('heading', { name: MAYA_NAME })).toBeVisible()
    await expect.poll(() => attempts).toBe(1)
    await expect(first.page.locator('[data-discussion-read]')).toHaveCount(0)
    await expect(messageRow(second.page, body).getByLabel(/unread/)).toHaveCount(0, { timeout: ms(20_000) })

    await gotoSection(first.page, 'Messages')
    await expect(messageRow(first.page, body).getByLabel(/unread/)).toHaveCount(0)
    expect(attempts).toBe(1)
    expect(requestKey).not.toBe('')
    expect(requestBody).toEqual({ throughPostId: target.id })
  } finally {
    await maya.context.close()
    await second.context.close()
    await first.context.close()
  }
})
