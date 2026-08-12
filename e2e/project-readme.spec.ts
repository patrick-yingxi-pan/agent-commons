import { test, expect, type Browser, type Page } from '@playwright/test'
import { openSection } from './social-helpers.ts'
import { ms } from './budget.ts'

/** D26 — the project README through the rendered UI: the owner writes the public
 *  "about" on the one project page; a FOREIGN tenant reads it on the same page —
 *  with no Edit affordance (capability shapes affordances, not location). */

const STAMP = Date.now().toString(36)
const PROJECT = `Documented project ${STAMP}`
const README = `This project exists to prove READMEs travel. Contribute via open work. ${STAMP}`

async function openApp(page: Page) {
  await page.goto('/')
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('the owner writes the README; the visitor reads it on the same page, without Edit', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const visitor = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  await openApp(owner.page)
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  // Configuration sections open FOLDED (owner decision 2026-08-12), so the share
  // controls are one click behind their header now — exactly as a reader finds them.
  await openSection(owner.page, 'Sharing')
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')

  // Owner: write the About through the page's own editor (the About section's
  // header verb — the hover-revealed SectionAction, named in full).
  await owner.page.getByRole('button', { name: /^Edit README/ }).click()
  await owner.page.getByLabel('Project README').fill(README)
  await owner.page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(owner.page.getByText(README)).toBeVisible()

  // Visitor: same page, the About renders — and no Edit affordance next to it.
  await openApp(visitor.page)
  await visitor.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await visitor.page.getByText(PROJECT).first().click()
  await expect(visitor.page.getByText(README)).toBeVisible()
  await expect(visitor.page.getByLabel('Project README')).toHaveCount(0)
  await expect(visitor.page.getByRole('button', { name: /^Edit README/ })).toHaveCount(0)
  const about = visitor.page.getByRole('main').getByText('About')
  await expect(about).toBeVisible()

  await owner.context.close()
  await visitor.context.close()
})
