/** Rendered recovery for the hosted account's one-time MCP credential reveal. */
import { test, expect, type Page } from '@playwright/test'
import type { ApiToken, BearerSession } from '../contract/index.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

async function signInAndOpen(page: Page) {
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/contexts')
  await expect(page.getByRole('heading', { name: 'Contexts', exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
}

async function leaveAndReturn(page: Page) {
  const sections = page.locator('nav[aria-label="Sections"]')
  await sections.getByText('Models', { exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await sections.getByText('Contexts', { exact: true }).click()
  await expect(page).toHaveURL(/\/contexts$/)
}

const labelInput = (page: Page) => page.getByRole('textbox', { name: 'Token label (optional)', exact: true })

test('token label and optional guidance stay visible while typing at every viewport', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  await signInAndOpen(page)
  const field = page.locator('label').filter({ has: labelInput(page) })
  const caption = field.locator('span').first()
  const mint = page.getByRole('button', { name: 'Mint access token', exact: true })
  await expect(mint).toBeEnabled()
  await labelInput(page).fill('Desktop MCP')
  for (const viewport of [
    { width: 320, height: 700 }, { width: 375, height: 812 },
    { width: 768, height: 1024 }, { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await labelInput(page).scrollIntoViewIfNeeded()
    await expect(caption).toHaveText('Token label (optional)')
    await expect(caption).toBeVisible()
    await expect.poll(() => caption.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await labelInput(page).click()
    await labelInput(page).press('Tab')
    await expect(mint).toBeFocused()
    await expect(mint).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`token-label-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `Token label ${viewport.width}x${viewport.height}`)
  }
})

test('a failed token mint keeps its label and Retry reuses one key', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `held mint ${Date.now().toString(36)}`
  const keys: string[] = []
  let postAttempts = 0
  await page.route('**/api/v1/auth/token', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      postAttempts += 1
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      if (postAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
        })
        return
      }
    }
    await route.continue()
  })

  await signInAndOpen(page)
  await labelInput(page).fill(label)
  await page.getByRole('button', { name: 'Mint access token', exact: true }).click()
  const failed = page.locator('[data-api-token-mint="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the access token was created')
  await expect(labelInput(page)).toHaveValue(label)
  await expect(labelInput(page)).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await leaveAndReturn(page)
  await expect(labelInput(page)).toHaveValue(label)
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copy the access token', exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const rows = await (await page.request.get('/api/v1/auth/tokens')).json() as ApiToken[]
  expect(rows.filter((row) => row.label === label)).toHaveLength(1)
})

test('a lost mint response recovers one exact reveal after navigation and reload without another POST', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `lost mint ${Date.now().toString(36)}`
  const keys: string[] = []
  let committed: BearerSession | null = null
  let recoveryAttempts = 0
  await page.route('**/api/v1/auth/token', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      committed = await response.json() as BearerSession
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (method === 'GET') {
      recoveryAttempts += 1
      if (recoveryAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Recovery connection lost.' } }),
        })
        return
      }
    }
    await route.continue()
  })

  await signInAndOpen(page)
  await labelInput(page).fill(label)
  await page.getByRole('button', { name: 'Mint access token', exact: true }).click()
  await expect(page.locator('[data-api-token-mint="failed"]')).toBeVisible()
  await expect(labelInput(page)).toHaveValue(label)

  await leaveAndReturn(page)
  await expect(labelInput(page)).toHaveValue(label)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Copy the access token', exact: true })).toBeVisible()
  expect(keys).toHaveLength(1)
  expect(recoveryAttempts).toBe(2)
  const rows = await (await page.request.get('/api/v1/auth/tokens')).json() as ApiToken[]
  expect(rows.filter((row) => row.id === committed?.tokenId)).toHaveLength(1)
})

test('Cancel request acknowledges a tombstone so an ambiguous mint cannot create later', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const label = `cancelled mint ${Date.now().toString(36)}`
  let logicalKey = ''
  let cancelledWith = ''
  await page.route('**/api/v1/auth/token', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      logicalKey = route.request().headers()['idempotency-key'] ?? ''
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    if (method === 'DELETE') cancelledWith = route.request().headers()['idempotency-key'] ?? ''
    await route.continue()
  })

  await signInAndOpen(page)
  await labelInput(page).fill(label)
  await page.getByRole('button', { name: 'Mint access token', exact: true }).click()
  const failed = page.locator('[data-api-token-mint="failed"]')
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: 'Cancel request', exact: true }).click()
  await expect(failed).toHaveCount(0)
  expect(logicalKey).not.toBe('')
  expect(cancelledWith).toBe(logicalKey)

  const late = await page.request.post('/api/v1/auth/token', {
    headers: { 'Idempotency-Key': logicalKey },
    data: { label },
  })
  expect(late.status()).toBe(409)
  const rows = await (await page.request.get('/api/v1/auth/tokens')).json() as ApiToken[]
  expect(rows.some((row) => row.label === label)).toBe(false)
})
