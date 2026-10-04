/** Deterministically represent the server GET → stream handoff race seen in
 * hosted account-switch CI. Detail reads before reattachment are stale; the
 * persisted answer, missing-stream 404 and recovery read remain real. */
import { test, expect } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { revealSessionRow } from './session-rail-helpers.ts'

async function installHelloProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const Native = window.EventSource
    class Wrapped extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        this.addEventListener('message', (event) => {
          try {
            if ((JSON.parse(event.data) as { type?: string }).type === 'hello') {
              ;(window as Window & { __reattachHello?: boolean }).__reattachHello = true
            }
          } catch {
            // The application owns malformed-frame handling; this probe only waits for readiness.
          }
        })
      }
    }
    window.EventSource = Wrapped
  })
}

async function waitForHello(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as Window & { __reattachHello?: boolean }).__reattachHello === true,
    undefined,
    { timeout: ms(15_000) },
  )
}

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

test('a session push inherits the pending startup reattach obligation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const stamp = Date.now().toString(36)
  const createdResponse = await page.request.post('/api/v1/sessions', { data: { firstMessage: `reattach push race ${stamp}` } })
  expect(createdResponse.ok()).toBe(true)
  const { id } = await createdResponse.json() as { id: string }
  const sent = await page.request.post(`/api/v1/sessions/${id}/messages`, {
    data: { text: `hello reattach push ${stamp}` }, headers: { 'Idempotency-Key': `reattach-push-${stamp}` },
  })
  expect(sent.ok()).toBe(true)
  const complete = await (await page.request.get(`/api/v1/sessions/${id}`)).json() as {
    activeTurnId?: string
    metadataRevision?: number
    title: string
    messages: Array<{ role: string; content?: string }>
  }
  expect(complete.activeTurnId).toBeUndefined()
  expect(complete.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  expect(complete.messages[1]?.content).toContain('free-form chat is canned')
  expect(typeof complete.metadataRevision).toBe('number')

  let phase: 'mount' | 'push' | 'after-push' = 'mount'
  let pushReadDelivered = false
  let missingStreams = 0
  let additionalSends = 0
  const heldMountReads: Array<{ delivered: Promise<void>; body?: { messages?: Array<{ role: string }> } }> = []
  let releaseMountReads!: () => void
  const mountGate = new Promise<void>((resolve) => { releaseMountReads = resolve })
  let resolveFirstMountRead!: () => void
  const firstMountRead = new Promise<void>((resolve) => { resolveFirstMountRead = resolve })
  let resolveFirstMountBody!: () => void
  const firstMountBody = new Promise<void>((resolve) => { resolveFirstMountBody = resolve })

  const sessionPath = `/api/v1/sessions/${id}`
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${sessionPath}/messages`) additionalSends++
  })
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname.startsWith(`${sessionPath}/turns/`) &&
      response.status() === 404
    ) missingStreams++
  })

  try {
    await installHelloProbe(page)
    await page.goto('/')
    await waitForHello(page)
    await page.getByRole('button', { name: 'Expand Sessions', exact: true }).click()
    const sessionRow = await revealSessionRow(page, complete.title)

    await page.route(new RegExp(`/api/v1/sessions/${id}(?:\\?.*)?$`), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const startedDuringMount = phase === 'mount'
      let resolveDelivered!: () => void
      const delivered = new Promise<void>((resolve) => { resolveDelivered = resolve })
      const held = startedDuringMount ? { delivered, body: undefined as { messages?: Array<{ role: string }> } | undefined } : null
      if (held) {
        heldMountReads.push(held)
        if (heldMountReads.length === 1) resolveFirstMountRead()
      }

      const response = await route.fetch()
      const body = await response.json() as { messages?: Array<{ role: string }> }
      expect(body.messages?.some((message) => message.role === 'assistant'), 'every intercepted server detail starts with the persisted reply').toBe(true)
      const retiredFixture = {
        ...body,
        activeTurnId: 'retired-before-reattach',
        messages: body.messages?.filter((message) => message.role === 'user'),
      }
      if (held) {
        held.body = body
        resolveFirstMountBody()
        await mountGate
        await route.fulfill({ response, json: retiredFixture })
        resolveDelivered()
        return
      }

      if (phase === 'push' && !pushReadDelivered) {
        await route.fulfill({ response, json: retiredFixture })
        pushReadDelivered = true
        phase = 'after-push'
        return
      }
      // The only healing read allowed through is the exact one causally following
      // the real missing-stream response, matching the existing recovery walk.
      if (missingStreams > 0) {
        await route.fulfill({ response })
        return
      }
      await route.fulfill({ response, json: retiredFixture })
    })

    await sessionRow.click()
    await firstMountRead
    await firstMountBody
    expect(heldMountReads.length).toBeGreaterThan(0)
    expect(heldMountReads[0]?.body?.messages?.some((message) => message.role === 'assistant')).toBe(true)

    // A real title update emits session.updated over the already-open SSE
    // connection. Its newer detail read wins the race while every mount read is
    // still held behind the gate.
    phase = 'push'
    const renamed = await page.request.patch(sessionPath, {
      data: { title: `Reattach push ${stamp}`, expectedRevision: complete.metadataRevision },
    })
    expect(renamed.ok(), 'the real session patch emits its tenant-scoped push').toBe(true)
    await expect.poll(() => pushReadDelivered, { timeout: ms(12_000) }).toBe(true)

    releaseMountReads()
    await Promise.all(heldMountReads.map((read) => read.delivered))

    // A transferred obligation reattaches the retired handle, observes the
    // real 404, then performs the permitted real recovery read. Without it the
    // persisted reply stays absent and the visible transcript remains stale.
    await expect.poll(() => missingStreams, { timeout: ms(8_000) }).toBe(1)
    await expect(page.locator('[data-turn]').filter({ hasText: 'free-form chat is canned' })).toBeVisible({ timeout: ms(12_000) })
    await expect(page.locator('[data-turn]')).toHaveCount(2)
    expect(additionalSends).toBe(0)
    const final = await (await page.request.get(sessionPath)).json()
    expect(final.messages).toEqual(complete.messages)
  } finally {
    releaseMountReads()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
