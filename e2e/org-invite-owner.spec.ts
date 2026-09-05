/** Rendered acknowledgement and live-device recovery for owner invitation actions. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Identity, OrgInviteRow, Tenant } from '../contract/index.ts'
import { orgInviteCreationId } from '../server/orgInviteCreationIdentity.ts'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
let sequence = 0

function account(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const suffix = `${STAMP}-${sequence += 1}`
  return {
    name: `${label} ${suffix}`,
    email: `${slug}-${suffix}@example.test`,
    password: `owner-invite-password-${suffix}`,
  }
}

async function signUp(page: Page, who: ReturnType<typeof account>): Promise<Identity> {
  const response = await page.request.post('/api/v1/auth/signup', { data: who })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Identity>
}

async function openOrganization(page: Page, org: Tenant, ownerName: string) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText(ownerName, { timeout: ms(5_000) })
  await page.getByTestId('account-chip').click()
  await page.getByTestId('org-option').filter({ hasText: org.name }).click()
  await expect(page.getByTestId('org-member-panel')).toBeVisible()
}

async function setupOwner(page: Page, label: string) {
  const owner = account(`${label} Owner`)
  const identity = await signUp(page, owner)
  const created = await page.request.post('/api/v1/orgs', {
    data: { name: `${label} Guild ${STAMP}-${sequence}` },
  })
  expect(created.ok()).toBe(true)
  const org = await created.json() as Tenant
  await openOrganization(page, org, owner.name)
  return { owner, identity, org }
}

async function setupInvitee(browser: Browser, label: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const accountRow = account(`${label} Invitee`)
  await signUp(page, accountRow)
  return { context, page, account: accountRow }
}

async function returnToOrganization(page: Page, org: Tenant) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('org-option').filter({ hasText: org.name }).click()
  await expect(page.getByTestId('org-member-panel')).toBeVisible()
}

test('a lost issue response reconciles once and reaches an already-open invitee menu live', async ({ browser, page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await setupOwner(page, 'Live issue')
  const invitee = await setupInvitee(browser, 'Live issue')
  let inviteReads = 0
  await invitee.page.route('**/api/v1/me/invites', async (route) => {
    if (route.request().method() === 'GET') inviteReads += 1
    await route.continue()
  })
  await invitee.page.goto('/')
  await invitee.page.getByTestId('account-chip').click()
  await expect.poll(() => inviteReads).toBeGreaterThan(0)

  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/orgs/${fixture.org.id}/invites`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  await page.getByLabel('Invite by email').fill(invitee.account.email)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(page.getByTestId('org-member-panel')).toContainText(invitee.account.email)
  await expect(page.getByLabel('Invite by email')).toHaveValue('')
  await expect(page.locator('[data-org-invite-owner-notice]')).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')

  const ledgerResponse = await page.request.get(`/api/v1/orgs/${fixture.org.id}/invites`)
  const ledger = await ledgerResponse.json() as OrgInviteRow[]
  const expectedId = orgInviteCreationId(fixture.org.id, fixture.identity.user.id, keys[0]!)
  expect(ledger.filter((invitation) => invitation.id === expectedId)).toHaveLength(1)
  await expect.poll(() => inviteReads).toBeGreaterThan(1)
  await expect(invitee.page.getByTestId('org-invite-row').filter({ hasText: fixture.org.name })).toBeVisible()
  await invitee.context.close()
})

test('a failed issue keeps its exact email across navigation and same-key Retry', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await setupOwner(page, 'Held issue')
  const email = `held-issue-${STAMP}-${sequence}@example.test`
  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/orgs/${fixture.org.id}/invites`, async (route) => {
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

  await page.getByLabel('Invite by email').fill(email)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const failed = page.locator('[data-org-invite-owner-notice="failed"]')
  await expect(failed).toContainText('Couldn’t confirm that organization invitation action')
  await expect(page.getByLabel('Invite by email')).toHaveValue(email)
  await expect(page.getByLabel('Invite by email')).toBeDisabled()

  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await returnToOrganization(page, fixture.org)
  await expect(page.getByLabel('Invite by email')).toHaveValue(email)
  await expect(page.getByRole('button', { name: 'Invite held', exact: true })).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('org-member-panel')).toContainText(email)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
})

test('a failed revoke holds its row across navigation, then removes both devices live on Retry', async ({ browser, page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await setupOwner(page, 'Held revoke')
  const invitee = await setupInvitee(browser, 'Held revoke')
  const issued = await page.request.post(`/api/v1/orgs/${fixture.org.id}/invites`, {
    data: { email: invitee.account.email },
  })
  expect(issued.ok()).toBe(true)
  const invitation = await issued.json() as OrgInviteRow
  await expect(page.getByTestId('org-member-panel')).toContainText(invitee.account.email)

  await invitee.page.goto('/')
  await invitee.page.getByTestId('account-chip').click()
  const inviteeRow = invitee.page.getByTestId('org-invite-row').filter({ hasText: fixture.org.name })
  await expect(inviteeRow).toBeVisible()

  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/orgs/${fixture.org.id}/invites/${invitation.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated revoke outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const ownerRow = page.getByTestId('org-invite-owner-row').filter({ hasText: invitee.account.email })
  await ownerRow.getByRole('button', { name: 'Revoke', exact: true }).click()
  const failed = page.locator('[data-org-invite-owner-notice="failed"]')
  await expect(failed).toBeVisible()
  await expect(ownerRow).toHaveAttribute('data-org-invite-owner-row', 'failed')
  await expect(ownerRow.getByRole('button', { name: 'Revoke held', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Invite by email')).toBeDisabled()

  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await returnToOrganization(page, fixture.org)
  const restored = page.getByTestId('org-invite-owner-row').filter({ hasText: invitee.account.email })
  await expect(restored.getByRole('button', { name: 'Revoke held', exact: true })).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(restored).toHaveCount(0)
  await expect(inviteeRow).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const ledgerResponse = await page.request.get(`/api/v1/orgs/${fixture.org.id}/invites`)
  const ledger = await ledgerResponse.json() as OrgInviteRow[]
  expect(ledger.find((row) => row.id === invitation.id)?.status).toBe('revoked')
  await invitee.context.close()
})
