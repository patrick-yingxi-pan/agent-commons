/** Rendered recovery and frozen-scope truth for notification triage. */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { gotoSection, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const GRACE_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
const STAMP = Date.now().toString(36)
let fixtureSequence = 0

async function shareNotification(owner: APIRequestContext, label: string): Promise<void> {
  const suffix = `${STAMP}-${(fixtureSequence += 1)}`
  const projectId = `p-notification-read-${suffix}`
  const created = await owner.post('/api/v1/relations/ops', {
    data: {
      op: {
        kind: 'create-project',
        projectId,
        projectName: label,
        projectDescription: '',
      },
    },
    headers: { 'idempotency-key': `notification-read-project-${suffix}` },
  })
  expect(created.ok()).toBe(true)
  const granted = await owner.post('/api/v1/grants', {
    data: {
      subject: { kind: 'project', id: projectId },
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier: 'view',
      note: `Notification recovery fixture ${suffix}`,
    },
    headers: { 'idempotency-key': `notification-read-grant-${suffix}` },
  })
  expect(granted.ok()).toBe(true)
}

async function notification(page: Page, label: string): Promise<{ id: string; read: boolean }> {
  const response = await page.request.get('/api/v1/notifications')
  expect(response.ok()).toBe(true)
  const row = ((await response.json()) as Array<{ id: string; read: boolean; subjectName?: string }>)
    .find((candidate) => candidate.subjectName === label)
  expect(row, `notification for '${label}'`).toBeTruthy()
  return row!
}

const notificationRow = (page: Page, label: string) =>
  page.getByRole('main').locator('[data-notification-row]').filter({ hasText: label })

test('Mark all read freezes its rows across failure, navigation, and later arrivals', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const owner = await newUser(browser)
  const grace = await newUser(browser, GRACE_HEADERS)
  const earlyLabel = `Frozen inbox ${STAMP}`
  const lateLabel = `Later inbox ${STAMP}`

  await grace.page.request.post('/api/v1/notifications/read', { data: {} })
  await shareNotification(owner.page.request, earlyLabel)
  const early = await notification(grace.page, earlyLabel)
  expect(early.read).toBe(false)

  await grace.page.goto('/notifications')
  await expect(notificationRow(grace.page, earlyLabel)).toBeVisible({ timeout: ms(20_000) })

  const keys: string[] = []
  const bodies: string[] = []
  let attempts = 0
  await grace.page.route('**/api/v1/notifications/read', async (route) => {
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

  await grace.page.getByRole('button', { name: 'Mark all read', exact: true }).click()
  const failure = grace.page.locator('[data-notification-read="failed"]')
  await expect(failure).toContainText('Couldn’t confirm which notifications were read')

  await gotoSection(grace.page, 'Projects')
  await expect(failure).toBeVisible()
  await shareNotification(owner.page.request, lateLabel)
  const late = await notification(grace.page, lateLabel)
  expect(late.read).toBe(false)

  await gotoSection(grace.page, 'Notifications')
  await expect(notificationRow(grace.page, earlyLabel)).toHaveAttribute('data-notification-row-read', 'failed')
  await expect(notificationRow(grace.page, lateLabel).getByLabel('Unread')).toBeVisible()

  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failure).toHaveCount(0)
  await expect(notificationRow(grace.page, earlyLabel).getByLabel('Unread')).toHaveCount(0)
  await expect(notificationRow(grace.page, lateLabel).getByLabel('Unread')).toBeVisible()

  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toBe(bodies[0])
  expect(JSON.parse(bodies[0]!)).toEqual({ ids: [early.id] })

  await owner.context.close()
  await grace.context.close()
})

test('a lost row-open acknowledgement reconciles once and heals another device', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const owner = await newUser(browser)
  const first = await newUser(browser, GRACE_HEADERS)
  const second = await newUser(browser, GRACE_HEADERS)
  const label = `Opened inbox ${STAMP}`

  await first.page.request.post('/api/v1/notifications/read', { data: {} })
  await shareNotification(owner.page.request, label)
  const initial = await notification(first.page, label)
  expect(initial.read).toBe(false)

  for (const page of [first.page, second.page]) {
    await page.goto('/notifications')
    await expect(notificationRow(page, label).getByLabel('Unread')).toBeVisible({ timeout: ms(20_000) })
  }

  let attempts = 0
  let requestKey = ''
  await first.page.route('**/api/v1/notifications/read', async (route) => {
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

  await notificationRow(first.page, label).getByRole('button').click()
  await expect(first.page.getByRole('heading', { name: label })).toBeVisible()
  await expect.poll(() => attempts).toBe(1)
  await expect.poll(async () => (await notification(first.page, label)).read).toBe(true)
  await expect(first.page.locator('[data-notification-read]')).toHaveCount(0)
  await expect(notificationRow(second.page, label).getByLabel('Unread')).toHaveCount(0, { timeout: ms(20_000) })

  await gotoSection(first.page, 'Notifications')
  await expect(notificationRow(first.page, label).getByLabel('Unread')).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(requestKey).not.toBe('')

  await owner.context.close()
  await first.context.close()
  await second.context.close()
})
