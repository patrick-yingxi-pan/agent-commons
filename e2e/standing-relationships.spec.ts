/** Rendered recovery and cross-device truth for Follow and Watch. */
import { test, expect } from '@playwright/test'
import { createProject, gotoSection, newUser, openAdaProfile, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'

const GRACE_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
const WATCH_PROJECT = `Standing watch ${Date.now().toString(36)}`

test('Follow failure stays held across navigation and Retry keeps one exact request', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const grace = await newUser(browser, GRACE_HEADERS)
  await grace.page.request.post('/api/v1/social/follow', {
    data: { name: 'Ada Lovelace', following: false },
  })

  const keys: string[] = []
  const bodies: string[] = []
  let attempts = 0
  await grace.page.route('**/api/v1/social/follow', async (route) => {
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
  await openAdaProfile(grace.page)
  await grace.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()

  const failure = grace.page.locator('[data-standing-relationship="failed"]')
  await expect(failure).toContainText('Couldn’t confirm your Follow or Watch choice')
  const waiting = grace.page.getByRole('main').getByRole('button', { name: 'Waiting for Retry', exact: true })
  await expect(waiting).toBeDisabled()

  await gotoSection(grace.page, 'Projects')
  await expect(failure).toBeVisible()
  await openAdaProfile(grace.page)
  await expect(waiting).toBeDisabled()

  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failure).toHaveCount(0)
  await expect(grace.page.getByRole('main').getByRole('button', { name: 'Following', exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toBe(bodies[0])

  await grace.page.request.post('/api/v1/social/follow', {
    data: { name: 'Ada Lovelace', following: false },
  })
  await grace.context.close()
})

test('a lost Watch response reconciles once and its private event heals another device', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const first = await newUser(browser)
  const second = await newUser(browser)
  await first.page.goto('/')
  await createProject(first.page, WATCH_PROJECT)
  const projectId = decodeURIComponent(new URL(first.page.url()).pathname.split('/').filter(Boolean).at(-1)!)
  await openSection(first.page, 'Sharing')
  const share = first.page.getByTestId('share-toggle')
  if ((await share.getAttribute('aria-pressed')) !== 'true') await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')
  const subject = { kind: 'project', id: projectId }
  await first.page.request.post('/api/v1/social/watch', { data: { subject, watching: false } })
  await first.page.reload()
  await expect(first.page.getByRole('button', { name: 'Watch', exact: true })).toBeVisible()
  await second.page.goto(`/projects/${encodeURIComponent(projectId)}`)
  await expect(second.page.getByRole('heading', { name: WATCH_PROJECT, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(second.page.getByRole('button', { name: 'Watch', exact: true })).toBeVisible()

  let attempts = 0
  let requestKey = ''
  await first.page.route('**/api/v1/projects/*/watch', async (route) => {
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

  await first.page.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(first.page.locator('[data-standing-relationship]')).toHaveCount(0)
  await expect(first.page.getByRole('button', { name: 'Watching', exact: true })).toBeVisible()
  await expect(second.page.getByRole('button', { name: 'Watching', exact: true })).toBeVisible({ timeout: ms(20_000) })
  expect(attempts).toBe(1)
  expect(requestKey).not.toBe('')

  await second.page.request.post('/api/v1/social/watch', { data: { subject, watching: false } })
  await first.context.close()
  await second.context.close()
})
