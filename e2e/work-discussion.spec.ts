import { test, expect, type Browser, type Page } from '@playwright/test'

/** D23 — a work item is a conversation, end to end through the rendered UI:
 *  the owner posts an item on a shared project; a FOREIGN tenant opens the same
 *  project page, reads the thread, comments (attribution = display name); the
 *  owner sees the comment and retracts the item; the retracted face renders and
 *  the visitor's Retract affordance never existed (poster/owner only). */

const STAMP = Date.now().toString(36)
const PROJECT = `Discussion arena ${STAMP}`
const ITEM = `debate-worthy item ${STAMP}`
const COMMENT = `what does this need, exactly? ${STAMP}`

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

/** Navigate to a section from the rail. Section sub-nav is a drill-in menu (ADAPT-13):
 *  while inside a section its sibling section rows are hidden behind the sub-menu, so
 *  pop back to the section list first (a no-op when we're already at the top level). */
async function gotoSection(page: Page, name: string) {
  const back = page.getByRole('navigation').getByRole('button', { name: 'Sections', exact: true })
  if (await back.isVisible().catch(() => false)) await back.click()
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

async function openProject(page: Page, name: string) {
  await dismissIntro(page, 250)
  await gotoSection(page, 'Projects')
  await page.getByText(name).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('a work item hosts a cross-tenant discussion; the poster retracts it honestly', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // seeded default tenant
  const visitor = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // Owner: shared project + one open item.
  await openApp(owner.page)
  await gotoSection(owner.page, 'Projects')
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')
  await owner.page.getByPlaceholder('Post a work item (sub-goal)…').fill(ITEM)
  await owner.page.getByLabel('Effect target').fill('budget:demo')
  await owner.page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(owner.page.getByText(ITEM)).toBeVisible()

  // Visitor: same page, opens the (empty) thread and comments.
  await openApp(visitor.page)
  await openProject(visitor.page, PROJECT)
  await expect(visitor.page.getByText(ITEM)).toBeVisible()
  // The visitor is neither poster nor owner — Retract must not render for them.
  await expect(visitor.page.getByRole('button', { name: 'Retract' })).toHaveCount(0)
  await visitor.page.getByRole('button', { name: 'Comment', exact: true }).click()
  await visitor.page.getByLabel(`Comment on ${ITEM}`).fill(COMMENT)
  await visitor.page.getByLabel(`Comment on ${ITEM}`).press('Enter')
  await expect(visitor.page.getByText(COMMENT)).toBeVisible()
  await expect(visitor.page.getByRole('button', { name: '1 comment', exact: true })).toBeVisible()

  // Owner: reads the foreign comment (display-name attribution), then retracts.
  await openProject(owner.page, PROJECT)
  await owner.page.getByRole('button', { name: '1 comment', exact: true }).click()
  await expect(owner.page.getByText(COMMENT)).toBeVisible()
  await owner.page.getByRole('button', { name: 'Retract' }).click()
  await expect(owner.page.getByText(/retracted by/)).toBeVisible()

  // The visitor's view converges (live event or reload) to the closed face.
  await visitor.page.reload()
  await dismissIntro(visitor.page)
  await openProject(visitor.page, PROJECT)
  await expect(visitor.page.getByText(/retracted by/)).toBeVisible()

  await owner.context.close()
  await visitor.context.close()
})
