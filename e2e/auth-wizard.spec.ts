/** The multi-account stack in the browser (multi-account §12): two accounts
 *  signed in through the DEDICATED auth flow become instant, credential-less
 *  switch targets in the account switcher (GitHub-style); sign-out forgets
 *  only the active account and lands on the "Choose an account" picker, from
 *  which the remaining account hops back in — again without a credential. */
import { test, expect, type Page } from '@playwright/test'

const STAMP = Date.now().toString(36)
const A = { name: `Stack Ana ${STAMP}`, email: `ana-${STAMP}@example.test`, password: `anas-password-${STAMP}` }
const B = { name: `Stack Bix ${STAMP}`, email: `bix-${STAMP}@example.test`, password: `bixs-password-${STAMP}` }

async function completeWizard(page: Page, who: { name: string; email: string; password: string }) {
  await page.getByTestId('auth-name').fill(who.name)
  await page.getByTestId('auth-email').fill(who.email)
  await page.getByTestId('auth-continue').click()
  await page.getByTestId('auth-password').fill(who.password)
  await page.getByTestId('auth-submit').click() // two steps since FWD-5 Phase 2
}

test('two accounts stack; the switcher hops between them instantly; sign-out lands on the picker', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')

  // ── Account A signs up through the wizard ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await completeWizard(page, A)
  await expect(page.getByTestId('account-chip')).toContainText(A.name, { timeout: 5_000 })

  // The menu now has an Accounts section: A, active, plus "Add account…".
  await page.getByTestId('account-chip').click()
  await expect(page.getByTestId('account-stack-option')).toHaveCount(1)
  await expect(page.getByTestId('account-stack-option')).toContainText('Active')

  // ── "Add account…" opens the full-screen sign-in; B signs UP from there ──
  await page.getByTestId('auth-add-account').click()
  await expect(page.getByTestId('auth-screen')).toBeVisible()
  await expect(page.locator('h1')).toContainText('Add another account')
  await page.getByTestId('auth-open-signup').click()
  await completeWizard(page, B)
  await expect(page.getByTestId('account-chip')).toContainText(B.name, { timeout: 5_000 })

  // ── Both remembered; the hop to A is one click, no credential ──
  await page.getByTestId('account-chip').click()
  const rows = page.getByTestId('account-stack-option')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: B.name })).toContainText('Active')
  await rows.filter({ hasText: A.name }).click()
  await expect(page.getByTestId('account-chip')).toContainText(A.name, { timeout: 5_000 })
  await expect(page.getByTestId('auth-screen')).toHaveCount(0) // no sign-in surface involved

  // ── Sign out (of A): the picker offers the REMAINING account (B) ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signout').click()
  await expect(page.getByTestId('auth-screen')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('h1')).toContainText('Choose an account')
  const picker = page.getByTestId('auth-picker-account')
  await expect(picker).toHaveCount(1)
  await expect(picker).toContainText(B.name)

  // ── The hop back in from the picker — again, no credential ──
  await picker.click()
  await expect(page.getByTestId('account-chip')).toContainText(B.name, { timeout: 5_000 })

  // A was forgotten by ITS sign-out (GitHub semantics): only B remains stacked.
  await page.getByTestId('account-chip').click()
  await expect(page.getByTestId('account-stack-option')).toHaveCount(1)
  await expect(page.getByTestId('account-stack-option')).toContainText(B.name)
})
