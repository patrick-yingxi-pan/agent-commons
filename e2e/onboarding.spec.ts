/** Real-account onboarding in the browser (multi-account P7; §12: the
 *  full-screen flow): create an account through the DEDICATED sign-up wizard
 *  (details → password, two steps since FWD-5 Phase 2 — the account is minted
 *  WITH its one namespace; a GitHub-style surface replacing the app frame, not
 *  a menu popover) → signed in immediately (server-minted cookie, chip label
 *  from /v1/me); the account's world is its own (invisible to the seeded
 *  default tenant); a RELOAD stays signed in (the cookie is the persistence);
 *  sign out lands on the auth screen — and a wrong password there is a visible
 *  error that leaves the surface up, while the real credential signs back into
 *  the same world. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
const NAME = `Onboard Olive ${STAMP}`
const EMAIL = `olive-${STAMP}@example.test`
const PASSWORD = `olives-password-${STAMP}`
const MESSAGE = `hello from my new account ${STAMP}`

/** Drive the sign-up wizard from its first step to the created account. */
async function completeWizard(page: Page, name: string, email: string, password: string) {
  await expect(page.getByTestId('auth-step')).toContainText('Step 1 of 2')
  await page.getByTestId('auth-name').fill(name)
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-continue').click()
  await expect(page.getByTestId('auth-step')).toContainText('Step 2 of 2')
  await page.getByTestId('auth-password').fill(password)
  await expect(page.getByTestId('auth-rule-min')).toHaveAttribute('data-ok', 'true')
  await page.getByTestId('auth-submit').click()
}

test('create account via the wizard → own world → reload stays signed in → sign out → sign back in', async ({ page, browser }) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace') // the remote default

  // ── The chip menu opens the DEDICATED full-screen wizard (no inline form) ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await expect(page.getByTestId('auth-screen')).toBeVisible()
  await expect(page.getByTestId('account-chip')).toHaveCount(0) // the workspace frame is replaced, not overlaid
  await completeWizard(page, NAME, EMAIL, PASSWORD)

  // Signed in immediately — back in the app, chip re-labeled from /v1/me. The
  // namespace bears the person's name (FWD-5 — no "(personal)" suffix).
  await expect(page.getByTestId('account-chip')).toContainText(NAME, { timeout: ms(5_000) })

  // The new account's world: fresh sidebar (none of Ada's sessions), own thread.
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByPlaceholder('Reply to Claude…').fill(MESSAGE)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })

  // ── Reload: the cookie is the persistence — still the new account ──
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText(NAME)
  await page.getByRole('button', { name: 'Expand Recents' }).click()
  await expect(page.locator('aside').getByText(new RegExp(MESSAGE.slice(0, 20))).first()).toBeVisible({ timeout: ms(5_000) })

  // ── Isolation: a fresh context (the seeded default) sees none of it ──
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto('/')
  await expect(otherPage.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await expect(otherPage.getByText(MESSAGE)).toHaveCount(0)
  await other.close()

  // ── Sign out: lands on the dedicated auth surface (not the workspace) ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signout').click()
  await expect(page.getByTestId('auth-screen')).toBeVisible({ timeout: ms(5_000) })

  // ── Wrong password: a visible error, the auth surface stays up ──
  await page.getByTestId('auth-email').fill(EMAIL)
  await page.getByTestId('auth-password').fill('not-the-password')
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-error')).toContainText('Invalid email or password')
  await expect(page.getByTestId('auth-screen')).toBeVisible()

  // ── The real credential signs back in; the world is still there ──
  await page.getByTestId('auth-password').fill(PASSWORD)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('account-chip')).toContainText(NAME, { timeout: ms(5_000) })
  await expect(page.locator('aside').getByText(new RegExp(MESSAGE.slice(0, 20))).first()).toBeVisible({ timeout: ms(5_000) })
})

test('the workspace affordances are gone (FWD-5 Phase 2): no menu section, no wizard step', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await completeWizard(page, `Wsp Wren ${STAMP}`, `wren-${STAMP}@example.test`, `wrens-password-${STAMP}`)
  await expect(page.getByTestId('account-chip')).toContainText('Wren')

  // The chip menu carries the account stack + account actions — and NOTHING
  // workspace-shaped: no "Your workspaces" rows, no "New workspace" form.
  await page.getByTestId('account-chip').click()
  await expect(page.getByTestId('account-stack-option').first()).toBeVisible()
  await expect(page.getByTestId('workspace-option')).toHaveCount(0)
  await expect(page.getByTestId('workspace-new')).toHaveCount(0)
})
