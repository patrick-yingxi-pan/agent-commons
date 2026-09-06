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
import { ms } from './budget.ts'

const sectionsNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function signIn(page: Page, email: string, password: string) {
  const login = await page.request.post('/api/v1/auth/login', { data: { email, password } })
  expect(login.ok()).toBeTruthy()
  await page.reload()
}

test('the console: hidden unsigned, full for the maintainer, absent for everyone else', async ({ browser, page }) => {
  test.setTimeout(ms(120_000))

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
  await expect(maintain).toBeVisible({ timeout: ms(5_000) })
  await maintain.click()
  await expect(page.getByRole('heading', { name: 'Maintain' })).toBeVisible()
  // Cross-tenant: accounts from OTHER tenants list (Grace's namespace). `.first()`
  // because her name now appears on BOTH the Accounts and Tenants panels — a
  // namespace wears its person's name, so the console shows it twice by design.
  await expect(page.getByText('Grace Hopper').first()).toBeVisible()
  await expect(page.getByText('Tenants')).toBeVisible()

  // ── The row is a DOOR (FWD-7 v1.1): Grace's name opens her account's own
  //    page at its canonical address, with her full facts; Back returns ──
  await page.getByRole('button', { name: 'Grace Hopper', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/users\/user-grace$/)
  await expect(page.getByText('Organization seats')).toBeVisible()
  await expect(page.getByText('Bearer tokens', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Back/ }).click()
  await expect(page.getByRole('heading', { name: 'Maintain' })).toBeVisible()

  // ── The detail is a real ADDRESS (ADAPT-15): a direct boot lands on it and
  //    a reload keeps it; a stale id degrades to the console panels ──
  await page.goto('/admin/users/user-grace')
  await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Grace Hopper' })).toBeVisible()
  await page.goto('/admin/users/user-nope')
  await expect(page.getByRole('heading', { name: 'Maintain' })).toBeVisible()

  // ── Credentials: Grace's token rows list; revoke goes through the two-step
  //    confirm and the row disappears ──
  await sectionsNav(page).getByRole('button', { name: 'Credentials', exact: true }).click()
  const tokenRow = page.getByText('e2e console probe')
  await expect(tokenRow).toBeVisible({ timeout: ms(5_000) })
  await page.getByRole('button', { name: 'Revoke', exact: true }).first().click()
  await page.getByRole('button', { name: 'Revoke token', exact: true }).click()
  await expect(page.getByText('e2e console probe')).toHaveCount(0, { timeout: ms(5_000) })

  // ── Ops: the stat tiles render from the live snapshot ──
  await sectionsNav(page).getByRole('button', { name: 'Ops', exact: true }).click()
  await expect(page.getByText('Backend', { exact: true })).toBeVisible()
  await expect(page.getByText('Uptime', { exact: true })).toBeVisible()

  // ── Grace (unlisted): no rail row, and the pasted URL degrades gracefully ──
  await expect(sectionsNav(grace).getByRole('button', { name: 'Maintain', exact: true })).toHaveCount(0)
  await grace.goto('/admin')
  await expect(grace.getByText('This console is for instance maintainers', { exact: false })).toBeVisible({
    timeout: ms(5_000),
  })

  await graceCtx.close()
})

test('lost maintainer capability cannot strand the restored workspace on a hidden page', async ({ page }) => {
  await page.goto('/')
  const identity = await page.request.get('/api/v1/me')
  expect(identity.ok()).toBeTruthy()
  const me = (await identity.json()) as { user: { id: string }; instanceAdmin?: boolean }
  expect(me.instanceAdmin).not.toBe(true)

  // Model a view saved while the account had the deployment-level grant. The
  // default e2e identity is deliberately unsigned, so its current chrome no
  // longer offers Maintain even though the per-account local blob still does.
  const storageKey = `claude-ui.mainsplit.v1.${me.user.id}`
  const stalePreference = JSON.stringify({
    kind: 'pane',
    content: { kind: 'msection', id: 'admin', sub: 'ops' },
  })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: storageKey,
    value: stalePreference,
  })
  await page.reload()

  await expect(page.locator('[data-conversation-pane="draft"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Maintain/ })).toHaveCount(0)
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey)).not.toBe(stalePreference)
  const safePreference = await page.evaluate((key) => localStorage.getItem(key), storageKey)
  if (safePreference !== null) {
    expect(JSON.parse(safePreference)).toEqual({ kind: 'pane', content: { kind: 'msession', id: 'draft' } })
  }
  expect(new URL(page.url()).pathname).toBe('/')

  // A deliberate deep link remains an honest explanation instead of becoming
  // a client-side authorization oracle or silently changing destinations.
  await page.goto('/admin')
  await expect(page.getByText('This console is for instance maintainers', { exact: false })).toBeVisible()
})
