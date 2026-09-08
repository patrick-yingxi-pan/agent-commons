/** Deterministically represent the server GET → stream handoff race seen in
 * hosted account-switch CI. Detail reads before reattachment are stale; the
 * persisted answer, missing-stream 404 and recovery read remain real. */
import { test, expect } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

test('a retired live-turn handle recovers its saved reply without another send at every viewport', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  // Own a non-default usage partition; this walk spends exactly one turn.
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const stamp = Date.now().toString(36)
  const createdResponse = await page.request.post('/api/v1/sessions', { data: { firstMessage: `reattach recovery ${stamp}` } })
  expect(createdResponse.ok()).toBe(true)
  const { id } = await createdResponse.json() as { id: string }
  const sent = await page.request.post(`/api/v1/sessions/${id}/messages`, {
    data: { text: `hello recovery ${stamp}` }, headers: { 'Idempotency-Key': `reattach-${stamp}` },
  })
  expect(sent.ok()).toBe(true)
  const complete = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
  expect(complete.activeTurnId).toBeUndefined()
  expect(complete.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])
  expect(complete.messages[1].content).toContain('free-form chat is canned')

  // Ambient invalidations cannot do the recovery on behalf of the handoff.
  await page.route('**/api/v1/events*', route => route.abort('connectionrefused'))
  let detailReads = 0
  let missingStreams = 0
  let additionalSends = 0
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/sessions/${id}/messages`) additionalSends++
  })
  page.on('response', response => {
    if (new URL(response.url()).pathname.includes(`/sessions/${id}/turns/`) && response.status() === 404) missingStreams++
  })
  await page.route(new RegExp(`/api/v1/sessions/${id}(?:\\?.*)?$`), async route => {
    if (route.request().method() !== 'GET') return route.continue()
    detailReads++
    const response = await route.fetch()
    // StrictMode can issue more than one mount read. Keep the stale server
    // snapshot until the real stream endpoint has demonstrated the missing
    // handle; otherwise a second mount read could accidentally heal the race.
    if (missingStreams > 0) return route.fulfill({ response })
    const body = await response.json()
    expect(body.messages.some((message: { role: string }) => message.role === 'assistant')).toBe(true)
    await route.fulfill({ response, json: {
      ...body, activeTurnId: 'retired-before-reattach', messages: body.messages.filter((message: { role: string }) => message.role === 'user'),
    } })
  })

  for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
    detailReads = 0
    missingStreams = 0
    await page.setViewportSize({ width, height })
    await page.goto(`/s/${id}`)
    await expect(page.locator('[data-turn]').filter({ hasText: 'free-form chat is canned' })).toBeVisible({ timeout: ms(12_000) })
    await expect.poll(() => missingStreams).toBe(1)
    expect(detailReads).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('Generation was interrupted.', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Claude is writing…')).toHaveCount(0)
    await expect(page.locator('[data-turn]')).toHaveCount(2)
    expect(additionalSends).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await assertWcag22Aa(page, `Recovered reply ${width}×${height}`)
    await page.screenshot({ path: testInfo.outputPath(`reattach-recovered-${width}.png`), fullPage: true })
  }
  const final = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
  expect(final.messages).toEqual(complete.messages)
})
