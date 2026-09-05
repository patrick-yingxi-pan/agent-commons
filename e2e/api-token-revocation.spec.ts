/** Rendered recovery for the hosted account's personal MCP credentials. */
import { test, expect, type Page } from '@playwright/test'
import type { ApiToken, BearerSession } from '../contract/index.ts'
import { ms } from './budget.ts'

async function signInAndMint(page: Page, label: string): Promise<ApiToken> {
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBe(true)
  const minted = await page.request.post('/api/v1/auth/token', { data: { label } })
  expect(minted.ok()).toBe(true)
  const session = await minted.json() as BearerSession
  expect(session.tokenId).toBeTruthy()
  const rows = await (await page.request.get('/api/v1/auth/tokens')).json() as ApiToken[]
  const represented = rows.find((token) => token.id === session.tokenId)
  expect(represented, 'the minted bearer has one metadata row').toBeTruthy()
  return represented!
}

async function openRegistry(page: Page, token: ApiToken) {
  await page.goto('/contexts')
  await expect(page.getByRole('heading', { name: 'Contexts', exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  const row = page.locator(`[data-api-token-id="${token.id}"]`)
  await expect(row).toContainText(token.label!)
  return row
}

async function leaveAndReturn(page: Page) {
  const sections = page.locator('nav[aria-label="Sections"]')
  await sections.getByText('Models', { exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await sections.getByText('Contexts', { exact: true }).click()
  await expect(page).toHaveURL(/\/contexts$/)
}

test('a failed token revocation keeps its row and Retry reuses one key', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const token = await signInAndMint(page, `held token ${Date.now().toString(36)}`)
  const keys: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/auth/tokens/${token.id}`, async (route) => {
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

  const row = await openRegistry(page, token)
  await row.getByRole('button', { name: `Revoke ${token.label}`, exact: true }).click()
  const failed = page.locator('[data-api-token-revocation="failed"]').first()
  await expect(failed).toContainText('Couldn’t confirm whether that access token was revoked')
  await expect(row).toHaveAttribute('data-api-token-revocation', 'failed')
  await expect(row.getByRole('button', { name: `Revocation needs attention for ${token.label}`, exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await leaveAndReturn(page)
  const returned = page.locator(`[data-api-token-id="${token.id}"]`)
  await expect(returned).toHaveAttribute('data-api-token-revocation', 'failed')
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(returned).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const rows = await (await page.request.get('/api/v1/auth/tokens')).json() as ApiToken[]
  expect(rows.some((candidate) => candidate.id === token.id)).toBe(false)
})

test('a committed token revocation stays visible until exact absence reconciles', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const token = await signInAndMint(page, `lost token ${Date.now().toString(36)}`)
  const keys: string[] = []
  let committed = false
  let markReadStarted!: () => void
  let releaseRead!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`**/api/v1/auth/tokens/${token.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    await response.body()
    committed = true
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
    })
  })
  await page.route('**/api/v1/auth/tokens', async (route) => {
    if (committed && route.request().method() === 'GET') {
      markReadStarted()
      await readGate
    }
    await route.continue()
  })

  const row = await openRegistry(page, token)
  await row.getByRole('button', { name: `Revoke ${token.label}`, exact: true }).click()
  await readStarted
  await expect(row).toHaveAttribute('data-api-token-revocation', 'pending')
  await expect(row.getByRole('button', { name: `Revoking ${token.label}`, exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)

  await leaveAndReturn(page)
  const returned = page.locator(`[data-api-token-id="${token.id}"]`)
  await expect(returned).toHaveAttribute('data-api-token-revocation', 'pending')
  releaseRead()
  await expect(returned).toHaveCount(0)
  await expect(page.locator('[data-api-token-revocation="failed"]')).toHaveCount(0)
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
})
