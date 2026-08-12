import { test, expect, type Browser, type Page } from '@playwright/test'
import { ms } from './budget.ts'

/** D23 — a work item is a conversation, end to end through the rendered UI:
 *  the owner posts an item on a shared project; a FOREIGN tenant opens the same
 *  project page, reads the thread, comments (attribution = display name); the
 *  owner sees the comment and retracts the item; the retracted face renders and
 *  the visitor's Retract affordance never existed (poster/owner only). */

const STAMP = Date.now().toString(36)
const PROJECT = `Discussion arena ${STAMP}`
const ITEM = `debate-worthy item ${STAMP}`
const COMMENT = `what does this need, exactly? ${STAMP}`

async function openApp(page: Page) {
  await page.goto('/')
}

/** Navigate to a section from the rail tree (ADAPT-13: an inline disclosure tree —
 *  every section row is always present; there is no drill-in to pop back from). */
async function gotoSection(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

async function openProject(page: Page, name: string) {
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
  test.setTimeout(ms(120_000))
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
  // The post form is on demand — the Open-work header's verb discloses it.
  await owner.page.getByRole('button', { name: 'Post a work item' }).click()
  await owner.page.getByPlaceholder('Post a work item (sub-goal)…').fill(ITEM)
  await owner.page.getByLabel('Effect target').fill('budget:demo')
  await owner.page.getByRole('button', { name: 'Post work item' }).click()
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
  await openProject(visitor.page, PROJECT)
  await expect(visitor.page.getByText(/retracted by/)).toBeVisible()

  await owner.context.close()
  await visitor.context.close()
})
