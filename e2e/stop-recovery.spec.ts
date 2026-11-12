/** Failure-first rendered coverage for the acknowledgement-owned Stop lifecycle.
 * The real model turn, session, and persistence remain server-owned. Only the
 * first browser cancellation response is held and rejected; Retry receives an
 * acknowledgement fixture so the requested-but-not-yet-settled state can be
 * inspected before the same real turn is cancelled through its route. A
 * test-owned Messages peer holds its terminal so audits cannot outlast the turn. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import { splitPane } from './pane-actions.ts'
import type { AuthAccount, ModelProvider, UsageSnapshot } from '../contract/index.ts'
import { startProviderRoutinePeer } from './provider-routine-peer.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

async function stopModelFixture(page: Page, stamp: string) {
  // A real signed-in owner keeps both the usage meter and provider registry
  // private to this case; no shared demo budget is reset or bypassed.
  const beforeResponse = await page.request.get('/api/v1/auth/accounts')
  expect(beforeResponse.ok()).toBe(true)
  const before = await beforeResponse.json() as AuthAccount[]
  const signup = await page.request.post('/api/v1/auth/signup', { data: {
    name: `Stop fixture ${stamp}`, email: `stop-${stamp}@example.test`, password: 'stop-fixture-password',
  } })
  expect(signup.ok(), await signup.text()).toBe(true)
  const owner = await signup.json() as { via: string; user: { id: string }; tenant: { id: string } }
  expect(owner.via).toBe('session')
  expect(owner.user.id).not.toBe('user-ada')
  expect(owner.user.id).not.toBe('user-grace')
  const afterResponse = await page.request.get('/api/v1/auth/accounts')
  expect(afterResponse.ok()).toBe(true)
  const after = await afterResponse.json() as AuthAccount[]
  for (const remembered of before) expect(after.some(row => row.user.id === remembered.user.id)).toBe(true)
  expect(after.filter(row => row.current).map(row => row.user.id)).toEqual([owner.user.id])
  const usageResponse = await page.request.get('/api/v1/usage')
  expect(usageResponse.ok()).toBe(true)
  const usage = await usageResponse.json() as UsageSnapshot
  const budget = usage.limits.find(window => window.key === 'fiveHour')
  expect(budget, 'the fixture owner has an ordinary account budget').toBeDefined()
  expect(budget!.usedTokens).toBe(0)
  expect(budget!.limitTokens).toBeGreaterThan(0)

  const peer = await startProviderRoutinePeer('anthropic', stamp, {
    holdMessagesOpen: true, reply: `Partial reply for the held Stop fixture ${stamp}.`,
  })
  try {
    const response = await page.request.post('/api/v1/providers', {
      headers: { 'Idempotency-Key': `stop-provider-${stamp}` },
      data: { label: `Stop endpoint ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'],
        models: [{ id: peer.modelId, label: 'Held Stop fixture' }], config: { baseURL: peer.baseURL, model: peer.modelId } },
    })
    expect(response.ok(), await response.text()).toBe(true)
    const provider = await response.json() as ModelProvider
    return { ...peer, providerId: provider.id }
  } catch (error) {
    await peer.close()
    throw error
  }
}

async function expectHeldModel(peer: Awaited<ReturnType<typeof stopModelFixture>>) {
  await expect.poll(() => peer.heldMessageStreams(), { message: 'one real upstream reply remains open until genuine cancellation' })
    .toEqual({ open: 1, aborted: 0 })
  expect(peer.generationRequests()).toHaveLength(1)
}

async function captureStopState(
  page: Page,
  testInfo: TestInfo,
  state: 'pending' | 'failed' | 'requested',
  viewport: { width: number; height: number },
) {
  const size = `${viewport.width}x${viewport.height}`
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
    message: `${size}: Stop ${state} state has no horizontal overflow`,
  }).toBe(true)
  await assertWcag22Aa(page, `Stop ${state} ${size}`)
  await page.screenshot({ path: testInfo.outputPath(`stop-${state}-${size}.png`), fullPage: true })
}

async function exerciseStopRecovery(
  page: Page,
  testInfo: TestInfo,
  viewport: typeof VIEWPORTS[number],
) {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(viewport)
  const stamp = randomUUID()
  const message = `Stop lifecycle recovery ${stamp}`
  const cancelPaths: string[] = []
  let sessionId: string | undefined
  let expectedCancelPath: string | undefined
  let peer: Awaited<ReturnType<typeof stopModelFixture>> | undefined
  let releaseFirstCancel!: () => void
  let firstCancelHeld!: () => void
  const firstCancelStarted = new Promise<void>((resolve) => { firstCancelHeld = resolve })
  const releaseGate = new Promise<void>((resolve) => { releaseFirstCancel = resolve })

  await page.route('**/api/v1/sessions/*/turns/*/cancel', async (route) => {
    const request = route.request()
    expect(request.method()).toBe('POST')
    cancelPaths.push(new URL(request.url()).pathname)
    if (cancelPaths.length === 1) {
      firstCancelHeld()
      await releaseGate
      await route.abort('failed')
      return
    }
    await route.fulfill({ status: 204 })
  })

  try {
    peer = await stopModelFixture(page, stamp)
    const created = await page.request.post('/api/v1/sessions', { data: { providerId: peer.providerId, modelId: peer.modelId } })
    expect(created.ok(), 'a real fresh session is created for this viewport').toBe(true)
    sessionId = ((await created.json()) as { id: string }).id
    await page.goto(`/s/${sessionId}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeEnabled()
    await composer.fill(message)
    await composer.press('Enter')

    await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`), { timeout: ms(15_000) })
    await expect(page.getByText('Generating a reply…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(page.getByText(peer.reply, { exact: true }).first()).toBeVisible({ timeout: ms(15_000) })
    await expectHeldModel(peer)
    const session = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      activeTurnId?: string
    }
    expect(session.activeTurnId, 'the real session exposes its active server turn').toBeTruthy()
    expectedCancelPath = `/api/v1/sessions/${sessionId}/turns/${session.activeTurnId}/cancel`

    let duplicatedPanes: ReturnType<Page['locator']> | undefined
    if (viewport.width === 1280) {
      // The split is another live view of this exact server turn. Its Stop
      // lifecycle is session-scoped, so both panes must announce it together.
      await splitPane(page, 'right')
      duplicatedPanes = page.locator(`[data-conversation-pane="${sessionId}"]`)
      await expect(duplicatedPanes).toHaveCount(2)
      await expect(duplicatedPanes.getByText('Generating a reply…', { exact: true })).toHaveCount(2)
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(2)
      await duplicatedPanes.last().getByRole('button', { name: 'Stop', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Stop', exact: true }).click()
    }
    await firstCancelStarted
    const pending = page.getByRole('status').filter({ hasText: 'Stopping…' })
    await expect(pending).toHaveCount(duplicatedPanes ? 2 : 1)
    await expect(pending.first()).toBeVisible()
    await expect(pending.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expectHeldModel(peer)
    await captureStopState(page, testInfo, 'pending', viewport)

    // The first real request remains unresolved until the pending state has
    // been captured and audited. Its transport rejection must surface exact
    // recovery.
    releaseFirstCancel()
    const failure = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm Stop. The reply may still be running.' })
    await expect(failure).toHaveCount(duplicatedPanes ? 2 : 1, { timeout: ms(10_000) })
    const retry = failure.getByRole('button', { name: 'Retry stop', exact: true })
    await expect(retry.first()).toBeVisible()
    await expectHeldModel(peer)
    await captureStopState(page, testInfo, 'failed', viewport)

    await retry.last().click()
    const requested = page.getByRole('status').filter({ hasText: 'Stop requested. Waiting for the reply to finish…' })
    await expect(requested).toHaveCount(duplicatedPanes ? 2 : 1, { timeout: ms(10_000) })
    await expect(requested.first()).toBeVisible()
    await expect(requested.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retry stop', exact: true })).toHaveCount(0)
    expect(cancelPaths, 'Retry uses only the exact same session and turn cancellation route').toEqual([
      expectedCancelPath,
      expectedCancelPath,
    ])
    await expectHeldModel(peer)
    await captureStopState(page, testInfo, 'requested', viewport)

    // The intercepted 204 is a UI fixture only. Now use the genuine endpoint so
    // the held model stream aborts and its partial is durably persisted.
    await expectHeldModel(peer)
    const settled = await page.request.post(expectedCancelPath!)
    expect(settled.ok(), 'the real cancellation settles the same server-owned turn').toBe(true)
    await expect.poll(() => peer!.heldMessageStreams(), { message: 'the genuine cancel closes the upstream connection before fixture teardown' })
      .toEqual({ open: 0, aborted: 1 })
    await expect(page.getByText('Generating a reply…', { exact: true })).toHaveCount(0, { timeout: ms(10_000) })
    await expect(page.getByText('Stop requested. Waiting for the reply to finish…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t confirm Stop. The reply may still be running.' })).toHaveCount(0)
    await expect.poll(async () => {
      const full = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
        messages?: Array<{ role: string; content: string }>
        activeTurnId?: string | null
      }
      return {
        roles: (full.messages ?? []).map((row) => row.role),
        activeTurnId: full.activeTurnId ?? null,
      }
    }).toMatchObject({ roles: ['user', 'assistant'], activeTurnId: null })
    const complete = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      messages: Array<{ role: string; content: string }>
      activeTurnId?: string | null
    }
    expect(complete.messages[1]!.content.length, 'the persisted partial contains generated text').toBeGreaterThan(0)
    expect(complete.messages[1]!.content, 'the exact held partial is persisted without a model terminal').toBe(peer.reply)
    expect(complete.activeTurnId ?? null).toBeNull()
    expect(cancelPaths).toEqual([expectedCancelPath, expectedCancelPath])
    expect(peer.generationRequests()).toHaveLength(1)
  } finally {
    // A failed assertion must release the held route and stop its real turn so
    // neither a browser request nor held generation leaks into later tests.
    releaseFirstCancel()
    if (sessionId) {
      try {
        const response = await page.request.get(`/api/v1/sessions/${sessionId}`)
        if (response.ok()) {
          const current = await response.json() as { activeTurnId?: string }
          if (current.activeTurnId) {
            await page.request.post(`/api/v1/sessions/${sessionId}/turns/${current.activeTurnId}/cancel`)
          }
        }
      } catch {
        // Context teardown can race cleanup after an earlier browser failure.
      }
    }
    await peer?.close()
  }
}

test('Stop pending, failure, and acknowledgement recovery at 320×700', async ({ page }, testInfo) =>
  exerciseStopRecovery(page, testInfo, VIEWPORTS[0]))

test('Stop pending, failure, and acknowledgement recovery at 375×812', async ({ page }, testInfo) =>
  exerciseStopRecovery(page, testInfo, VIEWPORTS[1]))

test('Stop pending, failure, and acknowledgement recovery at 768×1024', async ({ page }, testInfo) =>
  exerciseStopRecovery(page, testInfo, VIEWPORTS[2]))

test('Stop pending, failure, and acknowledgement recovery at 844×390', async ({ page }, testInfo) =>
  exerciseStopRecovery(page, testInfo, VIEWPORTS[3]))

test('Stop pending, failure, and acknowledgement recovery at 1280×800', async ({ page }, testInfo) =>
  exerciseStopRecovery(page, testInfo, VIEWPORTS[4]))

test('Stop is available and Retry remains after cancellation before first assistant output', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const fixtureTurnId = `pre-output-${randomUUID()}`
  const fixtureUserMessageId = `persisted-user-${randomUUID()}`
  const message = `Stop before the first output ${randomUUID()}`
  const messagePaths: string[] = []
  const cancelPaths: string[] = []
  let streamResponse: ServerResponse | undefined
  let terminalReleased = false
  let fixturePort = 0
  let fixture!: Server

  fixture = createServer(async (request, response) => {
    const origin = request.headers.origin
    const cors = {
      'Access-Control-Allow-Origin': origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] ?? 'content-type,idempotency-key',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      Vary: 'Origin',
    }
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors)
      response.end()
      return
    }
    if (request.method === 'POST' && pathname.match(/^\/api\/v1\/sessions\/[^/]+\/messages$/)) {
      for await (const _chunk of request) { /* Consume the authored POST body. */ }
      messagePaths.push(pathname)
      response.writeHead(200, {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      response.flushHeaders()
      response.write(`data: ${JSON.stringify({ type: 'turn.start', sessionId: pathname.split('/')[4], turnId: fixtureTurnId })}\n\n`)
      streamResponse = response
      response.on('close', () => {
        if (streamResponse === response && !response.writableEnded) streamResponse = undefined
      })
      return
    }
    if (request.method === 'POST' && pathname.match(/^\/api\/v1\/sessions\/[^/]+\/turns\/[^/]+\/cancel$/)) {
      for await (const _chunk of request) { /* No cancellation body is expected. */ }
      cancelPaths.push(pathname)
      response.writeHead(204, cors)
      response.end()
      return
    }
    if (request.method === 'POST' && pathname === '/__complete') {
      const stream = streamResponse
      if (!stream || stream.writableEnded) {
        response.writeHead(409, cors)
        response.end('No held reply stream')
        return
      }
      terminalReleased = true
      stream.write(`data: ${JSON.stringify({ type: 'turn.cancelled', sessionId: messagePaths[0]!.split('/')[4], turnId: fixtureTurnId })}\n\n`)
      stream.end()
      streamResponse = undefined
      response.writeHead(204, cors)
      response.end()
      return
    }
    response.writeHead(404, cors)
    response.end('No test fixture route')
  })

  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', () => {
      const address = fixture.address()
      if (!address || typeof address === 'string') {
        reject(new Error('The test stream fixture did not bind a TCP port.'))
        return
      }
      fixturePort = address.port
      resolve()
    })
  })
  const fixtureOrigin = `http://127.0.0.1:${fixturePort}`
  let sessionId: string | undefined
  try {
    const created = await page.request.post('/api/v1/sessions', { data: {} })
    expect(created.ok(), 'the normal API creates a real conversation shell for the UI').toBe(true)
    sessionId = ((await created.json()) as { id: string }).id
    let authoritativeReads = 0
    await page.route('**/api/v1/sessions/*', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (request.method() === 'GET' && pathname === `/api/v1/sessions/${sessionId}` && terminalReleased) {
        authoritativeReads += 1
        const response = await route.fetch()
        const session = await response.json() as { messages?: unknown[]; [key: string]: unknown }
        await route.fulfill({
          response,
          json: {
            ...session,
            activeTurnId: null,
            messages: [{ id: fixtureUserMessageId, role: 'user', content: message }],
          },
        })
        return
      }
      await route.continue()
    })
    await page.route('**/api/v1/sessions/*/messages', (route) => {
      const pathname = new URL(route.request().url()).pathname
      return route.continue({ url: `${fixtureOrigin}${pathname}` })
    })
    await page.route('**/api/v1/sessions/*/turns/*/cancel', (route) => {
      const pathname = new URL(route.request().url()).pathname
      return route.continue({ url: `${fixtureOrigin}${pathname}` })
    })
    await page.goto(`/s/${sessionId}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeEnabled()
    await composer.fill(message)
    await composer.press('Enter')

    await expect.poll(() => messagePaths.length, { message: 'the authored SSE stream received exactly one send' }).toBe(1)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(page.getByText('Generating a reply…', { exact: true })).toBeVisible()
    const rowsBeforeStop = page.locator('[data-turn]')
    await expect(rowsBeforeStop).toHaveCount(1)
    await expect(rowsBeforeStop.first().locator('[data-turn-author]')).toHaveText('You')

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const size = `${viewport.width}x${viewport.height}`
      const stop = page.getByRole('button', { name: 'Stop', exact: true })
      await settledNarrowRail(page)
      await settledOpaquePaint(rowsBeforeStop.first())
      await settledOpaquePaint(stop)
      await expect(stop, `${size}: the admitted pre-output turn can be stopped`).toBeVisible()
      await expect.poll(
        () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        { message: `${size}: pre-output Stop has no horizontal overflow` },
      ).toBe(true)
      const box = await stop.boundingBox()
      expect(box, `${size}: Stop has rendered geometry`).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
      await assertWcag22Aa(page, `pre-output Stop ${size}`)
      await page.screenshot({ path: testInfo.outputPath(`pre-output-stop-${size}.png`), fullPage: true })
    }

    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Stop requested. Waiting for the reply to finish…' })).toBeVisible()
    expect(cancelPaths, 'Stop targets the exact session and admitted turn').toEqual([
      `/api/v1/sessions/${sessionId}/turns/${fixtureTurnId}/cancel`,
    ])

    const completed = await page.request.post(`${fixtureOrigin}/__complete`)
    expect(completed.status(), 'the fixture releases the terminal only after Stop acknowledgement').toBe(204)
    await expect(page.getByText('Generating a reply…', { exact: true })).toHaveCount(0)
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    await expect.poll(() => authoritativeReads, { message: 'the settled view reconciles its test-owned user-only row' }).toBeGreaterThan(0)
    await expect(rowsBeforeStop).toHaveCount(1)
    await expect(rowsBeforeStop.first()).toHaveAttribute('data-turn', fixtureUserMessageId)
    await expect(rowsBeforeStop.first().locator('[data-turn-author]')).toHaveText('You')
    const typingIndicator = page.locator('.thinking-dot')
    await expect(typingIndicator, 'the settled pre-output cancellation removes the in-flight typing indicator').toHaveCount(0)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const size = `${viewport.width}x${viewport.height}`
      await settledNarrowRail(page)
      await settledOpaquePaint(rowsBeforeStop.first())
      await settledOpaquePaint(retry)
      await expect(typingIndicator, `${size}: Retry is captured after the typing indicator exits`).toHaveCount(0)
      await expect(retry, `${size}: the submitted user row remains retryable`).toBeVisible()
      await expect.poll(
        () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        { message: `${size}: cancellation guidance and Retry fit without horizontal overflow` },
      ).toBe(true)
      const box = await retry.boundingBox()
      expect(box, `${size}: Retry has rendered geometry`).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
      await assertWcag22Aa(page, `pre-output Retry ${size}`)
      await page.screenshot({ path: testInfo.outputPath(`pre-output-cancel-retry-${size}.png`), fullPage: true })
    }
    expect(messagePaths).toEqual([`/api/v1/sessions/${sessionId}/messages`])
  } finally {
    if (streamResponse && !streamResponse.writableEnded) streamResponse.end()
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
  }
})

test('a conversation viewer can follow its live reply but only the owner can send or stop', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = randomUUID()
  const message = `Owner turn while Grace watches ${stamp}`
  let sessionId: string | undefined
  let peer: Awaited<ReturnType<typeof stopModelFixture>> | undefined

  try {
    peer = await stopModelFixture(owner.page, stamp)
    const created = await owner.page.request.post('/api/v1/sessions', { data: { providerId: peer.providerId, modelId: peer.modelId } })
    expect(created.ok(), 'the isolated owner creates the conversation through the real session route').toBe(true)
    sessionId = ((await created.json()) as { id: string }).id
    const path = `/s/${sessionId}`

    await owner.page.goto(path)
    await owner.page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
    await owner.page.getByLabel('Audience id').fill('tenant-beta')
    await owner.page.getByLabel('Tier').selectOption({ label: 'View' })
    await owner.page.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(owner.page.getByText('tenant-beta')).toBeVisible()

    const foreign = await maya.page.request.get(`/api/v1/sessions/${sessionId}`)
    expect(foreign.status(), 'an unrelated tenant cannot read the conversation').toBe(404)

    await grace.page.setViewportSize({ width: 1280, height: 800 })
    await grace.page.goto(path)
    await expect(grace.page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
    await expect(grace.page.getByRole('textbox', { name: 'Message', exact: true }))
      .toHaveAttribute('placeholder', 'Only the conversation owner can send messages.')
    await expect(grace.page.getByRole('button', { name: 'Share this conversation', exact: true })).toHaveCount(0)

    const ownerComposer = owner.page.getByRole('textbox', { name: 'Message', exact: true })
    await ownerComposer.fill(message)
    await ownerComposer.press('Enter')
    await expect(owner.page.getByText('Generating a reply…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(owner.page.getByText(peer.reply, { exact: true }).first()).toBeVisible({ timeout: ms(15_000) })
    await expectHeldModel(peer)
    const live = await (await owner.page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      activeTurnId?: string
    }
    expect(live.activeTurnId, 'the owner’s held turn remains server-active before Grace attaches').toBeTruthy()

    // An open shared page does not automatically discover a turn that begins
    // later. Reload while the turn is active to exercise the documented GET +
    // live reattach path; this does not claim start-time auto-discovery.
    await grace.page.reload()
    await expect(grace.page.getByText('Generating a reply…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(grace.page.getByText(peer.reply, { exact: true }).first()).toBeVisible({ timeout: ms(15_000) })
    await expect(grace.page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(grace.page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
    await expect(grace.page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
    await expect.poll(() => grace.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(grace.page, 'Live shared conversation at 1280×800')
    await grace.page.screenshot({ path: testInfo.outputPath('shared-live-viewer-1280x800.png'), fullPage: true })

    await expectHeldModel(peer)
    await expect(owner.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(() => peer!.heldMessageStreams(), { message: 'owner Stop aborts the real upstream before teardown' })
      .toEqual({ open: 0, aborted: 1 })
    await expect(owner.page.getByText('Generating a reply…', { exact: true })).toHaveCount(0, { timeout: ms(10_000) })
    await expect(grace.page.getByText('Generating a reply…', { exact: true })).toHaveCount(0, { timeout: ms(10_000) })
    await expect.poll(async () => {
      const full = await (await owner.page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
        messages?: Array<{ role: string; content: string }>
        activeTurnId?: string | null
      }
      return { roles: (full.messages ?? []).map((row) => row.role), live: full.activeTurnId ?? null }
    }).toEqual({ roles: ['user', 'assistant'], live: null })
    expect(peer.generationRequests()).toHaveLength(1)
  } finally {
    if (sessionId) {
      try {
        const full = await (await owner.page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { activeTurnId?: string }
        if (full.activeTurnId) {
          await owner.page.request.post(`/api/v1/sessions/${sessionId}/turns/${full.activeTurnId}/cancel`)
        }
      } catch {
        // Browser context teardown can race cleanup after an earlier failure.
      }
    }
    await peer?.close()
    await Promise.all([owner.context.close(), grace.context.close(), maya.context.close()])
  }
})
