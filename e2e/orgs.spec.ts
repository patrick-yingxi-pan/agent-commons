/** FWD-6 O3 — orgs end to end through the rendered UI: found an org from the
 *  chip menu (its row is a DOOR to the org's namespace page, never a switch),
 *  invite by email from the member panel, accept from the invitee's menu, then
 *  create an ORG-OWNED project through the New-project owner picker and find it
 *  banded under "Your organizations" for both seats. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Identity, MyOrg } from '../contract/index.ts'
import { orgCreationId } from '../server/orgCreationIdentity.ts'
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

function testAccount(label: string) {
  const suffix = `${Date.now().toString(36)}-${label}`
  return {
    name: `Org ${label} ${suffix}`,
    email: `org-${suffix}@example.test`,
    password: `org-password-${suffix}`,
  }
}

async function identity(page: Page): Promise<Identity> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Identity>
}

async function myOrgs(page: Page): Promise<MyOrg[]> {
  const response = await page.request.get('/api/v1/me/orgs')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<MyOrg[]>
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

test('organization founding holds its exact name across failure, navigation, and same-key Retry', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const founder = testAccount('Held')
  const name = `Held Collective ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/orgs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await signUp(page, founder)
  const tenantId = (await identity(page)).tenant.id
  await page.getByTestId('account-chip').click()
  await page.getByTestId('org-new').click()
  await page.getByTestId('org-name').fill(name)
  await page.getByTestId('org-submit').click()

  const failed = page.locator('[data-org-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the organization was created')
  await expect(page.getByTestId('org-name')).toHaveValue(name)
  await expect(page.getByTestId('org-name')).toBeDisabled()
  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByTestId('org-name')).toHaveValue(name)

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByTestId('org-member-panel')).toBeVisible()
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = orgCreationId(tenantId, keys[0]!)
  expect((await myOrgs(page)).filter((row) => row.tenant.id === expectedId)).toHaveLength(1)
})

test('a committed organization with a lost response reconciles without a second POST', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const founder = testAccount('Recovered')
  const name = `Recovered Collective ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/orgs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await signUp(page, founder)
  const tenantId = (await identity(page)).tenant.id
  await page.getByTestId('account-chip').click()
  await page.getByTestId('org-new').click()
  await page.getByTestId('org-name').fill(name)
  await page.getByTestId('org-submit').click()

  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByTestId('org-member-panel')).toBeVisible()
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = orgCreationId(tenantId, keys[0]!)
  const stored = await myOrgs(page)
  expect(stored.filter((row) => row.tenant.id === expectedId)).toHaveLength(1)
  expect(stored.find((row) => row.tenant.id === expectedId)?.tenant.name).toBe(name)
  await expect(page.locator('[data-org-creation="failed"]')).toHaveCount(0)
})
