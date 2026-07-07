import { test, expect, type Browser, type Page } from '@playwright/test'

/** D24 — the bell, end to end through the rendered UI: a visitor watches a shared
 *  project; the owner posts a work item; the visitor's bell badges live (the
 *  tenant-targeted SSE), the inbox row names the act, and clicking it deep-links
 *  to the project page and clears the badge. */

const STAMP = Date.now().toString(36)
const PROJECT = `Belled project ${STAMP}`
const ITEM = `ring the bell ${STAMP}`

async function dismissIntro(page: Page, timeout = 2_500) {
  await page
    .getByRole('button', { name: 'Explore on my own' })
    .click({ timeout })
    .catch(() => {})
}

async function openApp(page: Page) {
  await page.goto('/')
  await dismissIntro(page, 5_000)
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('watch a shared project → the owner acts → the watcher’s bell rings, the row is a door', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser)
  const watcher = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // Owner: create + share.
  await openApp(owner.page)
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')

  // Watcher: open the shared project page and hit Watch.
  await openApp(watcher.page)
  await watcher.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await watcher.page.getByText(PROJECT).first().click()
  const watch = watcher.page.getByRole('button', { name: 'Watch', exact: true })
  await watch.click()
  await expect(watcher.page.getByRole('button', { name: 'Watching', exact: true })).toBeVisible()

  // Owner posts a work item — the public act.
  await owner.page.getByPlaceholder('Post a work item (sub-goal)…').fill(ITEM)
  await owner.page.getByLabel('Effect target').fill('budget:demo')
  await owner.page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(owner.page.getByText(ITEM)).toBeVisible()

  // The watcher's bell badges LIVE (tenant-targeted SSE — no reload).
  await expect(watcher.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await watcher.page.getByRole('complementary').getByLabel(/Notifications/).click()
  const panel = watcher.page.getByRole('dialog', { name: 'Notifications' })
  const row = panel.getByRole('button', { name: new RegExp(ITEM) })
  await expect(row).toBeVisible()

  // The row is a door: it opens the project page and the badge clears.
  await row.click()
  await expect(watcher.page.getByRole('heading', { name: PROJECT })).toBeVisible()
  await expect(watcher.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toHaveCount(0)

  await owner.context.close()
  await watcher.context.close()
})
