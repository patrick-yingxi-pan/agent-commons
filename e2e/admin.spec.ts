/** FWD-7 — the maintainer console through the rendered UI. The e2e stack lists
 *  Ada as the one maintainer (playwright.config.ts MAINTAINERS='user-ada');
 *  the grant lands only on VERIFIED resolutions, so:
 *   - the default (unsigned) boot shows NO Maintain rail row — even though the
 *    backend default principal IS Ada;
 *   - signed in as Ada, the row appears and the console's surfaces render the
 *     cross-tenant world (accounts from other tenants, the ops tiles) and can
 *     revoke another user's bearer token;
 *   - signed in as Grace (unlisted), no row — and the pasted /admin URL lands
 *     on the explanatory empty state, not a broken page. */
import { test, expect, type Page } from '@playwright/test'

const sectionsNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function signIn(page: Page, email: string, password: string) {
  const login = await page.request.post('/api/v1/auth/login', { data: { email, password } })
  expect(login.ok()).toBeTruthy()
  await page.reload()
}

test('the console: hidden unsigned, full for the maintainer, absent for everyone else', async ({ browser, page }) => {
  test.setTimeout(120_000)

  // ── Unsigned (via 'default' — resolves as Ada, but unverified): no row ──
  await page.goto('/')
  await expect(sectionsNav(page).getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
  await expect(sectionsNav(page).getByRole('button', { name: 'Maintain', exact: true })).toHaveCount(0)

  // ── Grace mints a labeled bearer token (a session-verified act) the console
  //    will later revoke ──
  const graceCtx = await browser.newContext()
  const grace = await graceCtx.newPage()
  await grace.goto('/')
  await signIn(grace, 'grace@acme.example', 'grace-demo-password')
  const mint = await grace.request.post('/api/v1/auth/token', { data: { label: 'e2e console probe' } })
  expect(mint.ok()).toBeTruthy()

  // ── Ada signs in: the Maintain row appears; the console opens on Accounts ──
  await signIn(page, 'ada@acme.example', 'ada-demo-password')
  const maintain = sectionsNav(page).getByRole('button', { name: 'Maintain', exact: true })
  await expect(maintain).toBeVisible({ timeout: 5_000 })
  await maintain.click()
  await expect(page.getByRole('heading', { name: 'Maintain' })).toBeVisible()
  // Cross-tenant: accounts from OTHER tenants list (Grace / Beta Platform).
  await expect(page.getByText('Grace Hopper')).toBeVisible()
  await expect(page.getByText('Tenants')).toBeVisible()

  // ── Credentials: Grace's token rows list; revoke goes through the two-step
  //    confirm and the row disappears ──
  await sectionsNav(page).getByRole('button', { name: 'Credentials', exact: true }).click()
  const tokenRow = page.getByText('e2e console probe')
  await expect(tokenRow).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Revoke', exact: true }).first().click()
  await page.getByRole('button', { name: 'Revoke token', exact: true }).click()
  await expect(page.getByText('e2e console probe')).toHaveCount(0, { timeout: 5_000 })

  // ── Ops: the stat tiles render from the live snapshot ──
  await sectionsNav(page).getByRole('button', { name: 'Ops', exact: true }).click()
  await expect(page.getByText('Backend', { exact: true })).toBeVisible()
  await expect(page.getByText('Uptime', { exact: true })).toBeVisible()

  // ── Grace (unlisted): no rail row, and the pasted URL degrades gracefully ──
  await expect(sectionsNav(grace).getByRole('button', { name: 'Maintain', exact: true })).toHaveCount(0)
  await grace.goto('/admin')
  await expect(grace.getByText('This console is for instance maintainers', { exact: false })).toBeVisible({
    timeout: 5_000,
  })

  await graceCtx.close()
})
