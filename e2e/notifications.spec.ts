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

  // The row is a door: it opens the project page and marks ITSELF read (other
  // specs' rows may keep the global badge — assert the row's own dot, not the badge).
  await row.click()
  await expect(watcher.page.getByRole('heading', { name: PROJECT })).toBeVisible()
  await watcher.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await expect(
    watcher.page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(ITEM) }).getByLabel('Unread'),
  ).toHaveCount(0)

  await owner.context.close()
  await watcher.context.close()
})

test('a work.commented bell opens the project ON the item’s thread, auto-expanded to the comment (R4 focus)', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // seeded default tenant
  const visitor = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const P = `Focus arena ${STAMP}`
  const IT = `focus-me item ${STAMP}`
  const CMT = `the anchored reply ${STAMP}`

  // Owner: shared project + one open item (owner is poster ⇒ in the item's audience).
  await openApp(owner.page)
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(P)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')
  await owner.page.getByPlaceholder('Post a work item (sub-goal)…').fill(IT)
  await owner.page.getByLabel('Effect target').fill('budget:demo')
  await owner.page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(owner.page.getByText(IT)).toBeVisible()

  // Visitor: opens the shared project and comments on the item → the OWNER's bell rings.
  await openApp(visitor.page)
  await visitor.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await visitor.page.getByText(P).first().click()
  await expect(visitor.page.getByRole('heading', { name: P })).toBeVisible()
  await visitor.page.getByRole('button', { name: 'Comment', exact: true }).click()
  await visitor.page.getByLabel(`Comment on ${IT}`).fill(CMT)
  await visitor.page.getByLabel(`Comment on ${IT}`).press('Enter')
  await expect(visitor.page.getByText(CMT)).toBeVisible()

  // Owner navigates AWAY (to Agents) so the door's navigation + focus is unambiguous —
  // the comment is nowhere on screen until the bell takes us there.
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  await expect(owner.page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  await expect(owner.page.getByText(CMT)).toHaveCount(0)

  // The owner's bell rings the comment; clicking it is the door.
  await expect(owner.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await owner.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await owner.page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: new RegExp(`commented on .*${IT}`) })
    .click()

  // The door FOCUSES: the project page opens AND the item's thread is auto-expanded
  // to the comment — no manual expand. (threadOpen defaults closed, so the comment
  // being visible here can only be the R4 focus consumption.)
  await expect(owner.page.getByRole('heading', { name: P })).toBeVisible()
  await expect(owner.page.getByText(CMT)).toBeVisible()

  await owner.context.close()
  await visitor.context.close()
})
