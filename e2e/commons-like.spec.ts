/** Rendered recovery and cross-device truth for Commons endorsement. */
import { test, expect, type Page } from '@playwright/test'
import { createProject, gotoSection, newUser, openShareForm } from './social-helpers.ts'
import { ms } from './budget.ts'

const GRACE_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
const STAMP = Date.now().toString(36)

async function publishForGrace(page: Page, name: string, note: string): Promise<void> {
  await page.goto('/')
  await createProject(page, name)
  await openShareForm(page)
  await page.getByLabel('Audience id').fill('tenant-beta')
  await page.getByLabel('Tier').selectOption({ label: 'Propose' })
  await page.getByLabel('Share note (publishes when present)').fill(note)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('tenant-beta · published')).toBeVisible()
}

async function itemIdFor(page: Page, note: string): Promise<string> {
  const response = await page.request.get('/api/v1/commons')
  expect(response.ok()).toBe(true)
  const item = ((await response.json()) as Array<{ id: string; note?: string }>).find((candidate) => candidate.note === note)
  expect(item, `Commons item for '${note}'`).toBeTruthy()
  return item!.id
}

test('Like failure stays held across navigation and Retry keeps one exact request', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const owner = await newUser(browser)
  const grace = await newUser(browser, GRACE_HEADERS)
  const name = `Like retry ${STAMP}`
  const note = `Like retry note ${STAMP}`
  await publishForGrace(owner.page, name, note)
  const itemId = await itemIdFor(grace.page, note)
  await grace.page.request.post(`/api/v1/commons/${encodeURIComponent(itemId)}/like`, { data: { liked: false } })

  const keys: string[] = []
  const bodies: string[] = []
  let attempts = 0
  await grace.page.route('**/api/v1/commons/*/like', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postData() ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  await grace.page.goto('/')
  await gotoSection(grace.page, 'Commons')
  const card = grace.page.getByRole('article').filter({ hasText: note })
  await expect(card).toBeVisible({ timeout: ms(20_000) })
  await card.getByRole('button', { name: 'Like this post' }).click()

  const failure = grace.page.locator('[data-commons-like="failed"]')
  await expect(failure).toContainText('Couldn’t confirm your Like choice')
  await expect(card.getByRole('button', { name: 'Waiting for Retry' })).toBeDisabled()

  await gotoSection(grace.page, 'Projects')
  await expect(failure).toBeVisible()
  await gotoSection(grace.page, 'Commons')
  await expect(card.getByRole('button', { name: 'Waiting for Retry' })).toBeDisabled()

  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failure).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Unlike this post' })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toBe(bodies[0])

  await grace.page.request.post(`/api/v1/commons/${encodeURIComponent(itemId)}/like`, { data: { liked: false } })
  await owner.context.close()
  await grace.context.close()
})

test('a lost Like response reconciles once and its visible event heals another device', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const owner = await newUser(browser)
  const first = await newUser(browser, GRACE_HEADERS)
  const second = await newUser(browser, GRACE_HEADERS)
  const name = `Like acknowledgement ${STAMP}`
  const note = `Like acknowledgement note ${STAMP}`
  await publishForGrace(owner.page, name, note)
  const itemId = await itemIdFor(first.page, note)
  await first.page.request.post(`/api/v1/commons/${encodeURIComponent(itemId)}/like`, { data: { liked: false } })

  for (const page of [first.page, second.page]) {
    await page.goto('/')
    await gotoSection(page, 'Commons')
    await expect(page.getByRole('article').filter({ hasText: note })).toBeVisible({ timeout: ms(20_000) })
  }

  let attempts = 0
  let requestKey = ''
  await first.page.route('**/api/v1/commons/*/like', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    requestKey = route.request().headers()['idempotency-key'] ?? ''
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  const firstCard = first.page.getByRole('article').filter({ hasText: note })
  await firstCard.getByRole('button', { name: 'Like this post' }).click()
  await expect(first.page.locator('[data-commons-like]')).toHaveCount(0)
  await expect(firstCard.getByRole('button', { name: 'Unlike this post' })).toContainText('1')
  const secondLike = second.page
    .getByRole('article')
    .filter({ hasText: note })
    .getByRole('button', { name: 'Unlike this post' })
  await expect(secondLike).toContainText('1', { timeout: ms(20_000) })
  expect(attempts).toBe(1)
  expect(requestKey).not.toBe('')

  await second.page.request.post(`/api/v1/commons/${encodeURIComponent(itemId)}/like`, { data: { liked: false } })
  await owner.context.close()
  await first.context.close()
  await second.context.close()
})
