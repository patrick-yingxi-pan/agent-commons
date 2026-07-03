/** Real-account onboarding in the browser (multi-account P7): create an account
 *  through the chip menu → signed in immediately (server-minted cookie, chip
 *  label from /v1/me); the account's world is its own (invisible to the seeded
 *  default tenant); a RELOAD stays signed in (the cookie is the persistence);
 *  sign out returns to the backend default; sign back in with the credential —
 *  and a wrong password is a visible error that leaves identity unchanged. */
import { test, expect, type Page } from '@playwright/test'

const STAMP = Date.now().toString(36)
const NAME = `Onboard Olive ${STAMP}`
const EMAIL = `olive-${STAMP}@example.test`
const PASSWORD = `olives-password-${STAMP}`
const MESSAGE = `hello from my new account ${STAMP}`

async function dismissIntro(page: Page, timeout = 2_500) {
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout }).catch(() => {})
}

test('create account → own world → reload stays signed in → sign out → sign back in', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await dismissIntro(page)
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace') // the remote default

  // ── Create the account through the chip menu ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await page.getByTestId('auth-name').fill(NAME)
  await page.getByTestId('auth-email').fill(EMAIL)
  await page.getByTestId('auth-password').fill(PASSWORD)
  await page.getByTestId('auth-submit').click()

  // Signed in immediately — the chip re-labels from /v1/me (server truth).
  await expect(page.getByTestId('account-chip')).toContainText(NAME, { timeout: 5_000 })
  await expect(page.getByTestId('account-chip')).toContainText('personal')

  // The new account's world: fresh sidebar (none of Ada's sessions), own thread.
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()
  await page.getByPlaceholder('Reply to Claude…').fill(MESSAGE)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/This is a static/).first()).toBeVisible({ timeout: 15_000 })

  // ── Reload: the cookie is the persistence — still the new account ──
  await page.reload()
  await dismissIntro(page)
  await expect(page.getByTestId('account-chip')).toContainText(NAME)
  await expect(page.locator('aside').getByText(new RegExp(MESSAGE.slice(0, 20))).first()).toBeVisible({ timeout: 5_000 })

  // ── Isolation: a fresh context (the seeded default) sees none of it ──
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto('/')
  await dismissIntro(otherPage)
  await expect(otherPage.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await expect(otherPage.getByText(MESSAGE)).toHaveCount(0)
  await other.close()

  // ── Sign out: back to the backend default ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signout').click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace', { timeout: 5_000 })

  // ── Wrong password: a visible error, identity unchanged ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signin').click()
  await page.getByTestId('auth-email').fill(EMAIL)
  await page.getByTestId('auth-password').fill('not-the-password')
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('auth-error')).toContainText('Invalid email or password')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')

  // ── The real credential signs back in; the world is still there ──
  await page.getByTestId('auth-password').fill(PASSWORD)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('account-chip')).toContainText(NAME, { timeout: 5_000 })
  await expect(page.locator('aside').getByText(new RegExp(MESSAGE.slice(0, 20))).first()).toBeVisible({ timeout: 5_000 })
})

test('a new workspace: create through the chip, switch into it, and it lists as owner', async ({ page }) => {
  await page.goto('/')
  await dismissIntro(page)
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await page.getByTestId('auth-name').fill(`Wsp Wren ${STAMP}`)
  await page.getByTestId('auth-email').fill(`wren-${STAMP}@example.test`)
  await page.getByTestId('auth-password').fill(`wrens-password-${STAMP}`)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('account-chip')).toContainText('Wren')

  await page.getByTestId('account-chip').click()
  await page.getByTestId('workspace-new').click()
  await page.getByTestId('auth-name').fill(`Wren Lab ${STAMP}`)
  await page.getByTestId('auth-submit').click()

  // createWorkspace switches into it — the chip shows the new workspace.
  await expect(page.getByTestId('account-chip')).toContainText('Wren Lab', { timeout: 5_000 })
  await page.getByTestId('account-chip').click()
  const rows = page.getByTestId('workspace-option')
  await expect(rows).toHaveCount(2) // personal + the lab
  await expect(rows.filter({ hasText: 'Wren Lab' })).toContainText('owner')
})
