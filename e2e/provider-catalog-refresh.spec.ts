import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

const MODEL_PORT = 8830 + Number(process.env.E2E_SHARD ?? 0)

test('a lost catalog-refresh acknowledgement survives navigation and retries one exact fetch', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.goto('/models')
  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(login.ok()).toBeTruthy()
  await page.reload()

  const created = await page.request.post('/api/v1/providers', {
    data: {
      label: `Recoverable catalog ${Date.now()}`,
      modelFamily: 'claude',
      effortLevels: ['High'],
      config: { baseURL: `http://127.0.0.1:${MODEL_PORT}` },
    },
  })
  expect(created.ok()).toBeTruthy()
  const provider = await created.json() as {
    id: string
    label: string
    connectionRevision?: number
    catalogSource?: string
  }
  expect(provider.catalogSource).toBe('listed')
  await page.goto(`/models/${encodeURIComponent(provider.id)}`)

  const requests: Array<{ body: unknown; key: string | undefined }> = []
  let loseFirstAcknowledgement = true
  await page.route(`**/api/v1/providers/${provider.id}/models/refresh`, async (route) => {
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

  await page.getByRole('button', { name: 'Refresh model catalog', exact: true }).click()
  const failed = page.locator('[data-provider-catalog-refresh="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the model catalog refreshed')

  const sections = page.getByRole('navigation', { name: 'Sections' })
  await sections.getByRole('button', { name: 'Models', exact: true }).click()
  await page.getByRole('main').getByText(provider.label, { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refreshing model catalog', exact: true })).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Refresh model catalog', exact: true })).toBeEnabled()

  expect(requests).toHaveLength(2)
  expect(requests[0]!.body).toEqual({ expectedRevision: provider.connectionRevision ?? 0 })
  expect(requests[1]!.body).toEqual(requests[0]!.body)
  expect(requests[0]!.key).toBeTruthy()
  expect(requests[1]!.key).toBe(requests[0]!.key)
  const represented = await page.request.get(`/api/v1/providers/${provider.id}`)
  expect(represented.ok()).toBeTruthy()
  expect(((await represented.json()) as { connectionRevision?: number }).connectionRevision)
    .toBe((provider.connectionRevision ?? 0) + 1)
})
