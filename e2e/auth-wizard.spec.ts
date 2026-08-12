/** The multi-account stack in the browser (multi-account §12): two accounts
 *  signed in through the DEDICATED auth flow become instant, credential-less
 *  switch targets in the account switcher (GitHub-style); sign-out forgets
 *  only the active account and lands on the "Choose an account" picker, from
 *  which the remaining account hops back in — again without a credential. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

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
  test.setTimeout(ms(120_000))
  await page.goto('/')

  // ── Account A signs up through the wizard ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await completeWizard(page, A)
  await expect(page.getByTestId('account-chip')).toContainText(A.name, { timeout: ms(5_000) })

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
  await expect(page.getByTestId('account-chip')).toContainText(B.name, { timeout: ms(5_000) })

  // ── Both remembered; the hop to A is one click, no credential ──
  await page.getByTestId('account-chip').click()
  const rows = page.getByTestId('account-stack-option')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: B.name })).toContainText('Active')
  await rows.filter({ hasText: A.name }).click()
  await expect(page.getByTestId('account-chip')).toContainText(A.name, { timeout: ms(5_000) })
  await expect(page.getByTestId('auth-screen')).toHaveCount(0) // no sign-in surface involved

  // ── SIGN-IN ORDER holds after the hop: A signed in first, so A lists
  //    first even now that she's active (the rows never shuffle) ──
  await page.getByTestId('account-chip').click()
  const stackedRows = page.getByTestId('account-stack-option')
  await expect(stackedRows.first()).toContainText(A.name)
  await expect(stackedRows.first()).toContainText('Active')

  // ── Sign out (of A) — the hover control on HER row: the picker offers the
  //    REMAINING account (B) ──
  await page.getByTestId('auth-signout').click()
  await expect(page.getByTestId('auth-screen')).toBeVisible({ timeout: ms(5_000) })
  await expect(page.locator('h1')).toContainText('Choose an account')
  const picker = page.getByTestId('auth-picker-account')
  await expect(picker).toHaveCount(1)
  await expect(picker).toContainText(B.name)

  // ── The hop back in from the picker — again, no credential ──
  await picker.click()
  await expect(page.getByTestId('account-chip')).toContainText(B.name, { timeout: ms(5_000) })

  // A was forgotten by ITS sign-out (GitHub semantics): only B remains stacked.
  await page.getByTestId('account-chip').click()
  await expect(page.getByTestId('account-stack-option')).toHaveCount(1)
  await expect(page.getByTestId('account-stack-option')).toContainText(B.name)
})

const C = { name: `Stack Cyd ${STAMP}`, email: `cyd-${STAMP}@example.test`, password: `cyds-password-${STAMP}` }
const D = { name: `Stack Dot ${STAMP}`, email: `dot-${STAMP}@example.test`, password: `dots-password-${STAMP}` }

test('the hover sign-out on a NON-active row forgets just that account, in place', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await completeWizard(page, C)
  await expect(page.getByTestId('account-chip')).toContainText(C.name, { timeout: ms(5_000) })
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-add-account').click()
  await page.getByTestId('auth-open-signup').click()
  await completeWizard(page, D)
  await expect(page.getByTestId('account-chip')).toContainText(D.name, { timeout: ms(5_000) })

  // D is active; C signed in first and lists first (sign-in order, stable).
  await page.getByTestId('account-chip').click()
  const rows = page.getByTestId('account-stack-option')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText(C.name)

  // Forget C from HER row's hover control: the row drops in place — no
  // navigation, no identity change, the menu stays open (D is untouched).
  const rowC = page.getByTestId('account-stack-row').filter({ hasText: C.name })
  await rowC.hover()
  await rowC.getByTestId('account-stack-signout').click()
  await expect(page.getByTestId('account-stack-option')).toHaveCount(1, { timeout: ms(5_000) })
  await expect(page.getByTestId('account-stack-option')).toContainText(D.name)
  await expect(page.getByTestId('account-chip')).toContainText(D.name)
  await expect(page.getByTestId('auth-screen')).toHaveCount(0)
})
