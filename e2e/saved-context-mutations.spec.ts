/** Rendered cross-device recovery for saved Context connection changes. */
import { test, expect } from '@playwright/test'
import type { SavedContext, SavedContextsSnapshot } from '../contract/index.ts'
import { ms } from './budget.ts'

test('a stale Context toggle loads the latest status and retries one held intent', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const id = `context-conflict-${stamp}`
  const label = `Conflict context ${stamp}`
  const queuedId = `context-queued-${stamp}`
  const queuedLabel = `Queued context ${stamp}`
  const createdResponse = await page.request.post('/api/v1/saved-contexts', {
    data: {
      context: {
        id,
        label,
        kind: 'connector',
        status: 'connected',
        detail: 'Two-device connection test',
        lastUsedAt: null,
        sessions: 0,
      },
    },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as SavedContext
  expect(created.connectionRevision).toBe(0)
  const queuedResponse = await page.request.post('/api/v1/saved-contexts', {
    data: {
      context: {
        id: queuedId,
        label: queuedLabel,
        kind: 'connector',
        status: 'connected',
        detail: 'Queued connection test',
        lastUsedAt: null,
        sessions: 0,
      },
    },
  })
  expect(queuedResponse.ok()).toBe(true)

  let attempts = 0
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let releaseFirst!: () => void
  let markFirstIntercepted!: () => void
  const firstIntercepted = new Promise<void>((resolve) => { markFirstIntercepted = resolve })
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve })
  await page.route(`**/api/v1/saved-contexts/${id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const disconnected = await page.request.patch(`/api/v1/saved-contexts/${id}`, {
        data: { status: 'needs-auth', expectedRevision: 0 },
      })
      expect(disconnected.status()).toBe(200)
      const reconnected = await page.request.patch(`/api/v1/saved-contexts/${id}`, {
        data: { status: 'connected', expectedRevision: 1 },
      })
      expect(reconnected.status()).toBe(200)
      markFirstIntercepted()
      await firstRelease
    }
    await route.continue()
  })

  await page.goto(`/contexts/${id}`)
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true })
  await disconnect.click()
  await firstIntercepted

  await page.getByRole('button', { name: 'Contexts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Contexts', exact: true })).toBeVisible()
  const queuedDisconnect = page.getByRole('button', { name: `Disconnect ${queuedLabel}`, exact: true })
  await queuedDisconnect.click()
  await expect(queuedDisconnect).toBeDisabled()
  await expect(page.getByRole('button', { name: `Remove ${queuedLabel} from contexts`, exact: true })).toBeDisabled()
  releaseFirst()

  const failed = page.locator('[data-saved-context-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  await expect(disconnect).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(bodies[0]).toMatchObject({ status: 'needs-auth', expectedRevision: 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ status: 'needs-auth', expectedRevision: 2 })

  await expect.poll(async () => {
    const current = await (await page.request.get('/api/v1/saved-contexts')).json() as SavedContextsSnapshot
    return current.contexts.find((context) => context.id === queuedId)?.status
  }).toBe('needs-auth')
  const snapshot = await (await page.request.get('/api/v1/saved-contexts')).json() as SavedContextsSnapshot
  const landed = snapshot.contexts.find((context) => context.id === id)
  expect(landed?.status).toBe('needs-auth')
  expect(landed?.connectionRevision).toBe(3)
  expect(snapshot.contexts.find((context) => context.id === queuedId)?.connectionRevision).toBe(1)
  await page.request.delete(`/api/v1/saved-contexts/${id}`)
  await page.request.delete(`/api/v1/saved-contexts/${queuedId}`)
})
