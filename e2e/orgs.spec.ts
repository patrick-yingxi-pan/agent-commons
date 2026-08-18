/** FWD-6 O3 — orgs end to end through the rendered UI: found an org from the
 *  chip menu (its row is a DOOR to the org's namespace page, never a switch),
 *  invite by email from the member panel, accept from the invitee's menu, then
 *  create an ORG-OWNED project through the New-project owner picker and find it
 *  banded under "Your organizations" for both seats. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
const FOUNDER = { name: `Org Founder ${STAMP}`, email: `founder-${STAMP}@example.test`, password: `founders-password-${STAMP}` }
const ORG = `Meridian Labs ${STAMP}`
const PROJECT = `Org roadmap ${STAMP}`

async function signUp(page: Page, who: { name: string; email: string; password: string }) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await page.getByTestId('auth-name').fill(who.name)
  await page.getByTestId('auth-email').fill(who.email)
  await page.getByTestId('auth-continue').click()
  await page.getByTestId('auth-password').fill(who.password)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('account-chip')).toContainText(who.name, { timeout: ms(5_000) })
}

test('found an org → invite → accept → an org-owned project through the picker, banded for both seats', async ({ browser, page }) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')
  await signUp(page, FOUNDER)

  // ── Found the org from the chip menu; its door lands on the org page ──
  await page.getByTestId('account-chip').click()
  await page.getByTestId('org-new').click()
  await page.getByTestId('org-name').fill(ORG)
  await page.getByTestId('org-submit').click()
  // The door: the org's namespace page (D21) with the MEMBER PANEL — served for
  // seats even though the org shares nothing public yet.
  await expect(page.getByTestId('org-member-panel')).toBeVisible({ timeout: ms(5_000) })
  await expect(page.getByTestId('org-member-panel')).toContainText(FOUNDER.name)
  await expect(page.getByTestId('org-member-panel')).toContainText('owner')

  // ── Invite Grace (a seed with a documented credential) by email ──
  await page.getByLabel('Invite by email').fill('grace@acme.example')
  await page.getByLabel('Invite by email').press('Enter')
  await expect(page.getByTestId('org-member-panel')).toContainText('grace@acme.example', { timeout: ms(5_000) })

  // ── Grace accepts from HER chip menu (a second browser context) ──
  const graceCtx = await browser.newContext()
  const grace = await graceCtx.newPage()
  await grace.goto('/')
  const login = await grace.request.post('/api/v1/auth/login', {
    data: { email: 'grace@acme.example', password: 'grace-demo-password' },
  })
  expect(login.ok()).toBeTruthy()
  await grace.reload()
  await expect(grace.getByTestId('account-chip')).toContainText('Grace Hopper')
  await grace.getByTestId('account-chip').click()
  await expect(grace.getByTestId('org-invite-row')).toContainText(ORG)
  await grace.getByTestId('org-invite-accept').click()
  // The seat mints; the menu's Organizations section now carries the door.
  await expect(grace.getByTestId('org-option')).toContainText(ORG, { timeout: ms(5_000) })

  // ── Grace creates an ORG-OWNED project through the owner picker ──
  await grace.keyboard.press('Escape') // close the menu
  await grace.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await grace.getByRole('button', { name: 'New project' }).click()
  await grace.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await grace.getByLabel('Project owner').selectOption({ label: ORG })
  await grace.getByRole('button', { name: 'Create project' }).click()
  // The project page opens, owned by the ORG (the byline names it, not Grace).
  await expect(grace.getByRole('heading', { name: PROJECT })).toBeVisible()

  // Back on the list it bands under "Your organizations".
  await grace.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(grace.getByRole('main').getByRole('button', { name: 'Your organizations', exact: true })).toBeVisible()

  // ── The FOUNDER sees the same project through their seat (the union) ──
  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('main').getByRole('button', { name: 'Your organizations', exact: true })).toBeVisible({ timeout: ms(5_000) })
  // Scoped to the page — the rail lists the same project now (UI-19).
  await expect(page.getByRole('main').getByText(PROJECT)).toBeVisible()

  await graceCtx.close()
})
