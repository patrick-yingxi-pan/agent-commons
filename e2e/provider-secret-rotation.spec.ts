/** Rendered recovery and safe cancellation for Session-provider secret rotation. */
import { test, expect, type Page } from '@playwright/test'
import type { CreatedProvider, Identity, ModelProvider } from '../contract/index.ts'
import { providerSecretRotationId } from '../server/providerSecretRotationIdentity.ts'
import { ms } from './budget.ts'

async function signIn(page: Page): Promise<Identity> {
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBe(true)
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Identity>
}

async function createSessionProvider(page: Page, label: string): Promise<CreatedProvider> {
  const response = await page.request.post('/api/v1/providers', {
    data: {
      label,
      modelFamily: 'claude',
      effortLevels: ['Default'],
      kind: 'session',
    },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<CreatedProvider>
}

async function readProvider(page: Page, providerId: string): Promise<ModelProvider> {
  const response = await page.request.get(`/api/v1/providers/${providerId}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ModelProvider>
}

test('failed rotation stays held across navigation and Retry reuses one exact request', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const identity = await signIn(page)
  const created = await createSessionProvider(page, `Held rotation ${Date.now().toString(36)}`)
  await page.goto(`/models/${created.id}`)
  const rotate = page.getByRole('button', { name: 'Rotate relay secret', exact: true })
  await expect(rotate).toBeVisible()

  const keys: string[] = []
  const bodies: string[] = []
  let attempts = 0
  await page.route(`**/api/v1/providers/${created.id}/rotate`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postData() ?? '')
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

  await rotate.click()
  const failed = page.locator('[data-provider-secret-rotation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the relay secret changed')
  await expect(rotate).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Edit provider', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove provider', exact: true })).toBeDisabled()

  await page.getByRole('navigation', { name: 'Sections' }).getByText('Models', { exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect your session' })).toBeVisible()

  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toBe(bodies[0])
  const current = await readProvider(page, created.id)
  expect(current.connectionRevision).toBe((created.connectionRevision ?? 0) + 1)
  expect(current.secretRotationReceipt).toEqual({
    id: providerSecretRotationId(identity.tenant.id, created.id, keys[0]!),
    state: 'applied',
  })
})

test('a committed rotation with lost response recovers the same secret after navigation and reload', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const identity = await signIn(page)
  const created = await createSessionProvider(page, `Reloaded rotation ${Date.now().toString(36)}`)
  await page.goto(`/models/${created.id}`)
  await expect(page.getByRole('button', { name: 'Rotate relay secret', exact: true })).toBeVisible()

  const keys: string[] = []
  let postAttempts = 0
  let blockFirstRecoveryRead = true
  let committed: CreatedProvider | null = null
  await page.route(`**/api/v1/providers/${created.id}`, async (route) => {
    if (route.request().method() === 'GET' && blockFirstRecoveryRead) {
      blockFirstRecoveryRead = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Recovery connection lost.' } }),
      })
      return
    }
    await route.continue()
  })
  await page.route(`**/api/v1/providers/${created.id}/rotate`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    postAttempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (postAttempts === 1) {
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = await response.json() as CreatedProvider
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Rotate relay secret', exact: true }).click()
  await expect(page.locator('[data-provider-secret-rotation="failed"]')).toBeVisible()
  await page.getByRole('navigation', { name: 'Sections' }).getByText('Models', { exact: true }).click()
  await expect(page.locator('[data-provider-secret-rotation="failed"]')).toBeVisible()
  await page.reload()

  const dialog = page.getByRole('dialog', { name: 'Connect your session' })
  await expect(dialog).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(committed?.secret).toMatch(/^rv_live_/)
  await expect(dialog.locator('code')).toContainText(committed!.secret!)
  const current = await readProvider(page, created.id)
  expect(current.connectionRevision).toBe((created.connectionRevision ?? 0) + 1)
  expect(current.secretRotationReceipt).toEqual({
    id: providerSecretRotationId(identity.tenant.id, created.id, keys[0]!),
    state: 'applied',
  })
})

test('Cancel request durably fences a late rotation without changing the active secret', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const identity = await signIn(page)
  const created = await createSessionProvider(page, `Cancelled rotation ${Date.now().toString(36)}`)
  await page.goto(`/models/${created.id}`)
  let logicalKey = ''
  let cancelledWith = ''
  await page.route(`**/api/v1/providers/${created.id}/rotate`, async (route) => {
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

  await page.getByRole('button', { name: 'Rotate relay secret', exact: true }).click()
  const failed = page.locator('[data-provider-secret-rotation="failed"]')
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: 'Cancel request', exact: true }).click()
  await expect(failed).toHaveCount(0)
  expect(logicalKey).not.toBe('')
  expect(cancelledWith).toBe(logicalKey)

  await page.unrouteAll({ behavior: 'wait' })
  const late = await page.request.post(`/api/v1/providers/${created.id}/rotate`, {
    headers: { 'Idempotency-Key': logicalKey },
    data: { expectedRevision: created.connectionRevision ?? 0 },
  })
  expect(late.status()).toBe(409)
  const current = await readProvider(page, created.id)
  expect(current.connectionRevision).toBe((created.connectionRevision ?? 0) + 1)
  expect(current.secretHint).toBe(created.secretHint)
  expect(current.secretRotationReceipt).toEqual({
    id: providerSecretRotationId(identity.tenant.id, created.id, logicalKey),
    state: 'cancelled',
  })
})
