import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { MyInviteReceipt, MyOrg, OrgInviteRow, Tenant } from '../contract/index.ts'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
let sequence = 0

function account(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const suffix = `${STAMP}-${slug}-${sequence += 1}`
  return {
    name: `${label} ${suffix}`,
    email: `${slug}-${suffix}@example.test`,
    password: `invite-password-${suffix}`,
  }
}

async function signUp(page: Page, who: ReturnType<typeof account>) {
  const response = await page.request.post('/api/v1/auth/signup', { data: who })
  expect(response.ok()).toBe(true)
}

async function setupInvitation(
  browser: Browser,
  ownerPage: Page,
  label: string,
): Promise<{
  inviteeContext: BrowserContext
  invitee: Page
  invitation: OrgInviteRow
  org: Tenant
}> {
  const owner = account(`${label} Owner`)
  const inviteeAccount = account(`${label} Invitee`)
  const orgName = `${label} Guild ${STAMP}-${sequence}`
  await signUp(ownerPage, owner)
  const created = await ownerPage.request.post('/api/v1/orgs', { data: { name: orgName } })
  expect(created.ok()).toBe(true)
  const org = await created.json() as Tenant

  const inviteeContext = await browser.newContext()
  const invitee = await inviteeContext.newPage()
  await signUp(invitee, inviteeAccount)

  const issued = await ownerPage.request.post(`/api/v1/orgs/${org.id}/invites`, {
    data: { email: inviteeAccount.email },
  })
  expect(issued.ok()).toBe(true)
  const invitation = await issued.json() as OrgInviteRow
  // Open only after the invitation exists; live invite delivery is a separate
  // account-event gap, while this walk owns the verdict's failure semantics.
  await invitee.goto('/')
  await expect(invitee.getByTestId('account-chip')).toContainText(inviteeAccount.name, { timeout: ms(5_000) })
  return { inviteeContext, invitee, invitation, org }
}

test('Accept holds the exact invitation across navigation and retries with one key', async ({ browser, page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await setupInvitation(browser, page, 'Held accept')
  const keys: string[] = []
  let attempts = 0
  await fixture.invitee.route(`**/api/v1/me/invites/${fixture.invitation.id}/accept`, async (route) => {
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

  await fixture.invitee.getByTestId('account-chip').click()
  const row = fixture.invitee.getByTestId('org-invite-row').filter({ hasText: fixture.org.name })
  await expect(row).toBeVisible()
  await row.getByTestId('org-invite-accept').click()

  const failed = fixture.invitee.locator('[data-org-invite-verdict-notice="failed"]')
  await expect(failed).toContainText('Couldn’t confirm that invitation decision')
  await expect(row).toHaveAttribute('data-org-invite-verdict', 'failed')
  await expect(row.getByTestId('org-invite-accept')).toHaveText('Accept held')
  await expect(row.getByTestId('org-invite-accept')).toBeDisabled()
  await expect(row.getByTestId('org-invite-decline')).toBeDisabled()

  await fixture.invitee.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await fixture.invitee.getByTestId('account-chip').click()
  const restored = fixture.invitee.getByTestId('org-invite-row').filter({ hasText: fixture.org.name })
  await expect(restored.getByTestId('org-invite-accept')).toHaveText('Accept held')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => attempts).toBe(2)
  await expect(failed).toHaveCount(0)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])

  await fixture.invitee.getByTestId('account-chip').click()
  await expect(fixture.invitee.getByTestId('org-option').filter({ hasText: fixture.org.name })).toBeVisible()
  const memberships = await fixture.invitee.request.get('/api/v1/me/orgs')
  const rows = await memberships.json() as MyOrg[]
  expect(rows.filter((membership) => membership.tenant.id === fixture.org.id)).toHaveLength(1)
  const receipt = await fixture.invitee.request.get(`/api/v1/me/invites/${fixture.invitation.id}`)
  expect((await receipt.json() as MyInviteReceipt).status).toBe('accepted')
  await fixture.inviteeContext.close()
})

test('a committed Decline with a lost response reconciles without another verdict POST', async ({ browser, page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await setupInvitation(browser, page, 'Recovered decline')
  let attempts = 0
  let receiptReads = 0
  await fixture.invitee.route(`**/api/v1/me/invites/${fixture.invitation.id}`, async (route) => {
    if (route.request().method() === 'GET') receiptReads += 1
    await route.continue()
  })
  await fixture.invitee.route(`**/api/v1/me/invites/${fixture.invitation.id}/decline`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  await fixture.invitee.getByTestId('account-chip').click()
  const row = fixture.invitee.getByTestId('org-invite-row').filter({ hasText: fixture.org.name })
  await expect(row).toBeVisible()
  await row.getByTestId('org-invite-decline').click()

  await expect.poll(() => receiptReads).toBeGreaterThan(0)
  await expect(row).toHaveCount(0)
  await expect(fixture.invitee.locator('[data-org-invite-verdict-notice]')).toHaveCount(0)
  expect(attempts).toBe(1)
  const memberships = await fixture.invitee.request.get('/api/v1/me/orgs')
  expect(await memberships.json() as MyOrg[]).toEqual([])
  const receipt = await fixture.invitee.request.get(`/api/v1/me/invites/${fixture.invitation.id}`)
  expect((await receipt.json() as MyInviteReceipt).status).toBe('declined')
  await fixture.inviteeContext.close()
})
