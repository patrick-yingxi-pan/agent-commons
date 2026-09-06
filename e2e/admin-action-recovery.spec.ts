/** Rendered acknowledgement recovery for maintainer security actions. */
import { test, expect, type Page } from '@playwright/test'
import type { BearerSession, OrgInviteRow, Tenant } from '../contract/index.ts'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)

async function signIn(page: Page, email: string, password: string): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', { data: { email, password } })
  expect(response.ok()).toBe(true)
}

async function openAdminPanel(page: Page, name: 'Credentials' | 'Organizations' | 'Ops'): Promise<void> {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: /^Maintain · / })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click()
}

test('a failed admin token revoke remains held across navigation for same-key Retry', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await signIn(page, 'grace@acme.example', 'grace-demo-password')
  const label = `admin held token ${STAMP}`
  const minted = await page.request.post('/api/v1/auth/token', { data: { label } })
  expect(minted.ok()).toBe(true)
  const token = await minted.json() as BearerSession
  expect(token.tokenId).toBeTruthy()

  await signIn(page, 'ada@acme.example', 'ada-demo-password')
  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/admin/tokens/user-grace/${token.tokenId}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
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

  await openAdminPanel(page, 'Credentials')
  const row = page.locator(`[data-admin-token-id="${token.tokenId}"]`)
  await expect(row).toContainText(label)
  await row.getByRole('button', { name: 'Revoke', exact: true }).click()
  await row.getByRole('button', { name: 'Revoke token', exact: true }).click()

  const failed = page.locator('[data-admin-action-notice="failed"]')
  await expect(failed).toContainText('Couldn’t confirm that maintainer action', { timeout: ms(20_000) })
  await expect(row.getByRole('button', { name: 'Waiting for Retry', exact: true })).toBeDisabled()
  await expect(row.getByRole('button', { name: 'Waiting for Retry', exact: true })).toHaveAttribute('data-admin-action', 'failed')

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Ops', exact: true }).click()
  await expect(failed).toBeVisible()
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Credentials', exact: true }).click()
  const returned = page.locator(`[data-admin-token-id="${token.tokenId}"]`)
  await expect(returned.getByRole('button', { name: 'Waiting for Retry', exact: true })).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(returned).toHaveCount(0, { timeout: ms(20_000) })
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
})

test('a lost admin invite-revoke acknowledgement reconciles once from exact terminal state', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await signIn(page, 'ada@acme.example', 'ada-demo-password')
  const created = await page.request.post('/api/v1/orgs', {
    data: { name: `Admin recovery org ${STAMP}` },
    headers: { 'idempotency-key': `admin-recovery-org-${STAMP}` },
  })
  expect(created.ok()).toBe(true)
  const org = await created.json() as Tenant
  const issued = await page.request.post(`/api/v1/orgs/${org.id}/invites`, {
    data: { email: `admin-recovery-${STAMP}@example.test` },
    headers: { 'idempotency-key': `admin-recovery-invite-${STAMP}` },
  })
  expect(issued.ok()).toBe(true)
  const invite = await issued.json() as OrgInviteRow

  let attempts = 0
  let requestKey = ''
  await page.route(`**/api/v1/admin/invites/${invite.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    requestKey = route.request().headers()['idempotency-key'] ?? ''
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  await openAdminPanel(page, 'Organizations')
  const row = page.locator(`[data-admin-invite-id="${invite.id}"]`)
  await expect(row).toContainText(invite.email)
  await row.getByRole('button', { name: 'Revoke', exact: true }).click()
  await row.getByRole('button', { name: 'Revoke invite', exact: true }).click()

  await expect(row).toContainText('revoked', { timeout: ms(20_000) })
  await expect(row.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-admin-action-notice]')).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(requestKey).not.toBe('')
})
