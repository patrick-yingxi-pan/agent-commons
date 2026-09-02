/** PORT-12 / MODEL-28 — the native credential face is a renderer capability,
 * not a second provider workflow. Package smoke proves the real preload/main/
 * utility path; this browser lane injects that exact narrow face so the shared
 * dialog can be exhaustively measured at every canonical viewport. */
import { test, expect } from '@playwright/test'
import { providerCreationId } from '../server/providerCreationIdentity.ts'
import { ms } from './budget.ts'

const MODEL_PORT = 8830 + Number(process.env.E2E_SHARD ?? 0)

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

test('desktop provider setup keeps its OS-encrypted key face reachable at every viewport', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        credentials: {
          provision: async () => `PROVIDER_DESKTOP_${'A'.repeat(32)}`,
          bind: async () => undefined,
          discard: async () => undefined,
          removeProvider: async () => undefined,
        },
      },
    })
  })
  await page.goto('/models')
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBeTruthy()
  await page.reload()
  await page.getByRole('button', { name: 'New provider', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'New provider' })
  const panel = dialog.locator(':scope > div').nth(1)
  const body = panel.locator(':scope > div').nth(1)
  const footer = panel.locator(':scope > div').nth(2)
  const key = page.getByPlaceholder('Paste API key', { exact: true })
  await expect(key).toHaveAttribute('type', 'password')
  await expect(page.getByPlaceholder('PROVIDER_TEAM_KEY', { exact: true })).toHaveCount(0)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await body.evaluate((element) => { element.scrollTop = 0 })
    const [panelBox, footerBox] = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    expect(panelBox, `${viewport.width}x${viewport.height} panel`).not.toBeNull()
    expect(footerBox, `${viewport.width}x${viewport.height} footer`).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(7)
    expect(panelBox!.y).toBeGreaterThanOrEqual(7)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    await body.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(key, `${viewport.width}x${viewport.height} API key after body scroll`).toBeVisible()
    await expect(page.getByText('Encrypted for your OS account', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible()
  }
})

test('a lost rotation acknowledgement retries the exact request and device key once', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.addInitScript(() => {
    ;(window as any).__desktopCredentialCalls = []
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        credentials: {
          provision: async (secret: string) => {
            ;(window as any).__desktopCredentialCalls.push(['provision', secret])
            return `PROVIDER_DESKTOP_${'E'.repeat(32)}`
          },
          bind: async (reference: string, providerId: string) => {
            ;(window as any).__desktopCredentialCalls.push(['bind', reference, providerId])
          },
          discard: async () => undefined,
          removeProvider: async () => undefined,
        },
      },
    })
  })
  await page.goto('/models')
  const created = await page.request.post('/api/v1/providers', {
    data: {
      label: `Desktop rotation ${Date.now()}`,
      modelFamily: 'claude',
      effortLevels: ['High'],
    },
  })
  expect(created.ok()).toBeTruthy()
  const provider = await created.json()
  await page.goto(`/models/${encodeURIComponent(provider.id)}`)

  await page.getByRole('button', { name: 'Update connection', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Update connection' })
  const replacement = 'replacement-key-that-must-not-enter-http'
  const requests: Array<{ body: unknown; key: string | undefined }> = []
  let loseFirstAcknowledgement = true
  await page.route(`**/api/v1/providers/${provider.id}/connection`, async (route) => {
    const request = route.request()
    requests.push({
      body: request.postDataJSON(),
      key: request.headers()['idempotency-key'],
    })
    if (loseFirstAcknowledgement) {
      loseFirstAcknowledgement = false
      const response = await route.fetch()
      expect(response.ok()).toBeTruthy()
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.getByPlaceholder('Paste replacement API key', { exact: true }).fill(replacement)
  await page.getByRole('button', { name: 'Verify & update', exact: true }).click()
  await expect(dialog.getByText('Couldn’t confirm whether this connection changed', { exact: false })).toBeVisible()
  await expect(dialog.getByText('The result is uncertain', { exact: false })).toBeVisible()
  await expect(page.getByPlaceholder('Paste replacement API key', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Retry update', exact: true }).click()
  await expect(dialog).toBeHidden()

  expect(requests).toHaveLength(2)
  expect(requests[0]!.body).toEqual({
    apiKeyEnv: `PROVIDER_DESKTOP_${'E'.repeat(32)}`,
    expectedRevision: 0,
  })
  expect(requests[1]!.body).toEqual(requests[0]!.body)
  expect(requests[0]!.key).toBeTruthy()
  expect(requests[1]!.key).toBe(requests[0]!.key)
  expect(JSON.stringify(requests)).not.toContain(replacement)
  expect(await page.evaluate(() => (window as any).__desktopCredentialCalls)).toEqual([
    ['provision', replacement],
    ['bind', `PROVIDER_DESKTOP_${'E'.repeat(32)}`, provider.id],
  ])
})

test('a committed provider with a lost acknowledgement keeps and binds its device key', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const reference = `PROVIDER_DESKTOP_${'F'.repeat(32)}`
  await page.addInitScript((credentialReference) => {
    ;(window as any).__desktopCredentialCalls = []
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        credentials: {
          provision: async (secret: string) => {
            ;(window as any).__desktopCredentialCalls.push(['provision', secret])
            return credentialReference
          },
          bind: async (boundReference: string, providerId: string) => {
            ;(window as any).__desktopCredentialCalls.push(['bind', boundReference, providerId])
          },
          discard: async (discardedReference: string) => {
            ;(window as any).__desktopCredentialCalls.push(['discard', discardedReference])
          },
          removeProvider: async () => undefined,
        },
      },
    })
  }, reference)
  await page.goto('/models')
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBeTruthy()
  await page.reload()

  const me = await page.request.get('/api/v1/me')
  expect(me.ok()).toBeTruthy()
  const tenantId = ((await me.json()) as { tenant: { id: string } }).tenant.id
  const requests: Array<{ body: unknown; key: string }> = []
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const request = route.request()
    requests.push({
      body: request.postDataJSON(),
      key: request.headers()['idempotency-key'] ?? '',
    })
    const committed = await route.fetch()
    expect(committed.ok()).toBeTruthy()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  const label = `Recovered desktop provider ${Date.now().toString(36)}`
  const rawKey = 'provider-key-that-must-never-enter-http'
  await page.getByRole('button', { name: 'New provider', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New provider' })
  await dialog.getByLabel('Name').fill(label)
  await page.getByPlaceholder('https://models.example.com/v1', { exact: true }).fill(`http://127.0.0.1:${MODEL_PORT}`)
  await page.getByPlaceholder('Paste API key', { exact: true }).fill(rawKey)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()

  expect(requests).toHaveLength(1)
  expect(requests[0]!.key).not.toBe('')
  expect(requests[0]!.body).toMatchObject({
    label,
    config: {
      baseURL: `http://127.0.0.1:${MODEL_PORT}`,
      apiKeyEnv: reference,
    },
  })
  expect(JSON.stringify(requests)).not.toContain(rawKey)
  const expectedId = providerCreationId(tenantId, requests[0]!.key)
  expect(await page.evaluate(() => (window as any).__desktopCredentialCalls)).toEqual([
    ['provision', rawKey],
    ['bind', reference, expectedId],
  ])
  const registry = await page.request.get('/api/v1/providers')
  expect(registry.ok()).toBeTruthy()
  expect(((await registry.json()) as Array<{ id: string }>).filter((provider) => provider.id === expectedId)).toHaveLength(1)
})
