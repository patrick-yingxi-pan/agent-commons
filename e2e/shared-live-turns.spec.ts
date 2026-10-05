/** A mounted owner, same-account owner window, and granted reader all discover
 *  server-started Session turns without a reload. The shard-owned mock endpoint
 *  paces each reply so the active, partial state is observable in every window. */
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import { tierFor } from '../src/lib/viewport.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const REPLY_MARKER = 'free-form chat is canned'

async function installHelloProbe(page: Page) {
  await page.addInitScript(() => {
    const Native = window.EventSource
    class Wrapped extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        this.addEventListener('message', (event) => {
          try {
            if ((JSON.parse(event.data) as { type?: string }).type === 'hello') {
              ;(window as Window & { __sharedLiveHello?: boolean }).__sharedLiveHello = true
            }
          } catch {
            // This probe only signals EventSource readiness; the app handles malformed frames.
          }
        })
      }
    }
    window.EventSource = Wrapped
  })
}

async function waitForHello(page: Page) {
  await page.waitForFunction(
    () => (window as Window & { __sharedLiveHello?: boolean }).__sharedLiveHello === true,
    undefined,
    { timeout: ms(15_000) },
  )
}

async function settledInitialRead(page: Page, sessionId: string) {
  const path = `/api/v1/sessions/${sessionId}`
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === path,
  )
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const response = await responsePromise
  expect(response.ok(), 'the mounted pane completed its initial authorized detail GET').toBe(true)
  const session = await response.json() as { messages?: Array<{ role: string }>; activeTurnId?: string | null }
  expect(session.messages ?? [], 'the initial GET settles before any owner starts a turn').toEqual([])
  expect(session.activeTurnId ?? null).toBeNull()
  await waitForHello(page)
}

async function activeTurn(page: Page, sessionId: string) {
  const response = await page.request.get(`/api/v1/sessions/${sessionId}`)
  expect(response.ok()).toBe(true)
  const session = await response.json() as { activeTurnId?: string | null }
  return session.activeTurnId ?? null
}

async function completeTurns(page: Page, sessionId: string, expectedRoles: string[]) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/sessions/${sessionId}`)
    if (!response.ok()) return { roles: [], activeTurnId: 'unreadable' }
    const session = await response.json() as {
      messages?: Array<{ role: string }>
      activeTurnId?: string | null
    }
    return { roles: (session.messages ?? []).map((message) => message.role), activeTurnId: session.activeTurnId ?? null }
  }, { timeout: ms(25_000) }).toEqual({ roles: expectedRoles, activeTurnId: null })
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    { message: `${label} has no horizontal overflow` },
  ).toBe(true)
}

async function settleResponsiveRail(page: Page, width: number) {
  const tier = tierFor(width)
  await expect.poll(() => page.evaluate(async ({ tier: expectedTier, width: expectedWidth }: {
    tier: 'wide' | 'medium' | 'narrow'
    width: number
  }) => {
    const button = document.querySelector('button[aria-label="Collapse sidebar"]')
    const expectedPosition = expectedTier === 'narrow' ? 'absolute' : 'relative'
    let rail = button?.parentElement as HTMLElement | null
    while (rail && !(rail.style.width && getComputedStyle(rail).position === expectedPosition)) {
      rail = rail.parentElement
    }
    if (!rail || window.innerWidth !== expectedWidth || getComputedStyle(rail).position !== expectedPosition) return false

    const geometry = () => {
      const rect = rail!.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height]
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const before = geometry()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const after = geometry()
    const stable = before.every((value, index) => Math.abs(value - (after[index] ?? Infinity)) < 0.5)
    const closedNarrowRail = expectedTier !== 'narrow' || (rail.hasAttribute('inert') && after[2] === 0)
    return stable && closedNarrowRail
  }, { tier, width })).toBe(true)
}

async function sendPacedTurn(
  owner: Page,
  ownerMirrors: Page[],
  readers: Page[],
  sessionId: string,
  message: string,
  priorTurns: number,
) {
  const shareTrigger = owner.getByRole('button', { name: 'Share this conversation', exact: true })
  if ((await shareTrigger.getAttribute('aria-expanded')) === 'true') await shareTrigger.click()
  const composer = owner.getByRole('textbox', { name: 'Message', exact: true })
  await expect(composer).toBeEnabled()
  await composer.fill(message)
  await composer.press('Enter')

  // The test-shard model emits this early in its paced response. Each page must
  // observe a new assistant row while the server still owns the active turn.
  for (const page of [owner, ...ownerMirrors, ...readers]) {
    const replies = page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })
    await expect(replies).toHaveCount(priorTurns + 1, { timeout: ms(15_000) })
    await expect(page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    const partial = await replies.last().innerText()
    expect(partial, 'the rendered assistant reply is visibly partial while generation is active').not.toContain('digest')
  }

  await expect.poll(() => activeTurn(owner, sessionId), { timeout: ms(10_000) }).toBeTruthy()
  for (const page of [owner, ...ownerMirrors]) {
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  }
  for (const page of ownerMirrors) {
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
  }
  for (const page of readers) {
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
    const readerComposer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(readerComposer).toBeDisabled()
    await expect(readerComposer).toHaveAttribute('placeholder', 'Only the conversation owner can send messages.')
  }
}

async function captureViewport(
  owner: Page,
  reader: Page,
  testInfo: TestInfo,
  viewport: typeof VIEWPORTS[number],
) {
  await Promise.all([owner, reader].map((page) => page.setViewportSize(viewport)))
  const size = `${viewport.width}x${viewport.height}`
  await Promise.all([
    settleResponsiveRail(owner, viewport.width),
    settleResponsiveRail(reader, viewport.width),
    assertNoHorizontalOverflow(owner, `Owner ${size}`),
    assertNoHorizontalOverflow(reader, `Reader ${size}`),
  ])
  // Inspect the new reply, including at short heights where the transcript
  // deliberately scrolls independently of its fixed composer.
  for (const page of [owner, reader]) {
    const latest = page.locator('[data-turn]').last()
    await latest.scrollIntoViewIfNeeded()
    await expect(latest).toBeInViewport()
  }
  await owner.screenshot({ path: testInfo.outputPath(`shared-live-owner-${size}.png`), fullPage: true })
  await reader.screenshot({ path: testInfo.outputPath(`shared-live-reader-${size}.png`), fullPage: true })
}

test('mounted shared readers and another owner window follow two live turns without reload', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(150_000))
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-live-turn-owner' })
  const ownerMirror = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-live-turn-owner' })
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = randomUUID()
  const firstMessage = `paced shared live first turn ${stamp}`
  const secondMessage = `paced shared live second turn ${stamp}`
  const mirrorDraft = `owner mirror draft survives remote turns ${stamp}`
  let sessionId: string | undefined
  let ownerReloads = 0
  let mirrorReloads = 0
  let readerReloads = 0

  for (const page of [owner.page, ownerMirror.page, reader.page]) await installHelloProbe(page)
  try {
    const created = await owner.page.request.post('/api/v1/sessions', { data: {} })
    expect(created.ok(), 'Ada creates a fresh server-owned conversation').toBe(true)
    sessionId = ((await created.json()) as { id: string }).id

    await owner.page.setViewportSize({ width: 1280, height: 800 })
    await settledInitialRead(owner.page, sessionId)
    await expect(owner.page.getByRole('button', { name: 'Share this conversation', exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
    await owner.page.getByLabel('Audience id').fill('tenant-beta')
    await owner.page.getByLabel('Tier').selectOption({ label: 'View' })
    await owner.page.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(owner.page.getByText('tenant-beta')).toBeVisible()
    await owner.page.getByRole('button', { name: 'Share this conversation', exact: true }).click()

    const foreignRead = await foreign.page.request.get(`/api/v1/sessions/${sessionId}`)
    expect(foreignRead.status(), 'an unrelated tenant remains unable to read the conversation').toBe(404)

    await Promise.all([
      settledInitialRead(ownerMirror.page, sessionId),
      settledInitialRead(reader.page, sessionId),
    ])
    await expect(ownerMirror.page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    await expect(reader.page.getByRole('textbox', { name: 'Message', exact: true }))
      .toHaveAttribute('placeholder', 'Only the conversation owner can send messages.')
    await expect(reader.page.getByRole('button', { name: 'Share this conversation', exact: true })).toHaveCount(0)
    const mirrorComposer = ownerMirror.page.getByRole('textbox', { name: 'Message', exact: true })
    await mirrorComposer.fill(mirrorDraft)

    // From here onward all observer navigation is counted. A successful live
    // assertion must come from the mounted page, with its settled GET and SSE
    // hello already observed above.
    const watchReloads = (page: Page, increment: () => void) => page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) increment()
    })
    watchReloads(owner.page, () => { ownerReloads++ })
    watchReloads(ownerMirror.page, () => { mirrorReloads++ })
    watchReloads(reader.page, () => { readerReloads++ })

    await sendPacedTurn(owner.page, [ownerMirror.page], [reader.page], sessionId, firstMessage, 0)
    await expect(mirrorComposer).toHaveValue(mirrorDraft)
    await completeTurns(owner.page, sessionId, ['user', 'assistant'])
    for (const page of [owner.page, ownerMirror.page, reader.page]) {
      const replies = page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })
      await expect(replies).toHaveCount(1)
      await expect(replies.last()).toContainText('digest')
      await expect(page.getByText('Claude is writing…', { exact: true })).toHaveCount(0)
    }

    await sendPacedTurn(owner.page, [ownerMirror.page], [reader.page], sessionId, secondMessage, 1)
    await completeTurns(owner.page, sessionId, ['user', 'assistant', 'user', 'assistant'])
    for (const page of [owner.page, ownerMirror.page, reader.page]) {
      await expect(page.locator('[data-turn]')).toHaveCount(4)
      await expect(page.locator('[data-turn]').filter({ hasText: firstMessage })).toHaveCount(1)
      await expect(page.locator('[data-turn]').filter({ hasText: secondMessage })).toHaveCount(1)
      const replies = page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })
      await expect(replies).toHaveCount(2)
      await expect(replies.last()).toContainText('digest')
      await expect(page.getByText('Claude is writing…', { exact: true })).toHaveCount(0)
    }
    await expect(mirrorComposer).toHaveValue(mirrorDraft)
    expect({ ownerReloads, mirrorReloads, readerReloads }, 'all mounted windows observed both turns without reload').toEqual({
      ownerReloads: 0,
      mirrorReloads: 0,
      readerReloads: 0,
    })

    for (const viewport of VIEWPORTS) {
      await captureViewport(owner.page, reader.page, testInfo, viewport)
    }

    // Revocation removes the reader's authorization while the same-account
    // owner mirror retains it. Reopening the reader after revocation cannot
    // republish the transcript from stale browser state.
    await owner.page.setViewportSize({ width: 1280, height: 800 })
    await owner.page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Revoke the view grant', exact: true }).click()
    await expect(owner.page.getByText('tenant-beta')).toHaveCount(0)
    const revokedRead = await reader.page.request.get(`/api/v1/sessions/${sessionId}`)
    expect(revokedRead.status(), 'revocation removes the reader capability at the session boundary').toBe(404)
    const stillOwned = await ownerMirror.page.request.get(`/api/v1/sessions/${sessionId}`)
    expect(stillOwned.ok(), 'a same-account owner window retains its authorized read').toBe(true)
    await reader.page.reload()
    await expect(reader.page.getByText(firstMessage, { exact: true })).toHaveCount(0)
    await expect(reader.page.getByText(secondMessage, { exact: true })).toHaveCount(0)
  } finally {
    if (sessionId) {
      try {
        const response = await owner.page.request.get(`/api/v1/sessions/${sessionId}`)
        if (response.ok()) {
          const current = await response.json() as { activeTurnId?: string }
          if (current.activeTurnId) {
            await owner.page.request.post(`/api/v1/sessions/${sessionId}/turns/${current.activeTurnId}/cancel`)
          }
        }
      } catch {
        // Context teardown can race cleanup after an earlier browser failure.
      }
    }
    await Promise.all([owner.context.close(), ownerMirror.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('an owner mirror observes a next turn that starts before its prior reattach settles', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-live-turn-race' })
  const ownerMirror = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-live-turn-race' })
  const stamp = randomUUID()
  const firstMessage = `paced mirror first settling turn ${stamp}`
  const secondMessage = `paced mirror next turn arrives early ${stamp}`
  const mirrorDraft = `mirror draft held across settling turns ${stamp}`
  let sessionId: string | undefined
  let heldStreamRequests = 0
  let releaseFirstStream!: () => void
  const firstStreamGate = new Promise<void>((resolve) => { releaseFirstStream = resolve })
  let resolveFirstStreamStarted!: () => void
  const firstStreamStarted = new Promise<void>((resolve) => { resolveFirstStreamStarted = resolve })
  let resolveFirstStreamBuffered!: (response: { status: number; body: string }) => void
  const firstStreamBuffered = new Promise<{ status: number; body: string }>((resolve) => { resolveFirstStreamBuffered = resolve })
  let firstActiveRead: { activeTurnId?: string; messages?: Array<{ role: string; content: string }> } | undefined
  let secondActiveRead: { activeTurnId?: string; messages?: Array<{ role: string; content: string }> } | undefined
  let mirrorMessagePosts = 0

  await installHelloProbe(owner.page)
  await installHelloProbe(ownerMirror.page)
  try {
    const created = await owner.page.request.post('/api/v1/sessions', { data: {} })
    expect(created.ok(), 'Ada creates the real owner conversation').toBe(true)
    sessionId = ((await created.json()) as { id: string }).id
    const sessionPath = `/api/v1/sessions/${sessionId}`

    // Observe and pass through authoritative detail reads so the two active
    // snapshots below prove the server returned the exact new user turn and id.
    await ownerMirror.page.route(new RegExp(`${sessionPath}(?:\\?.*)?$`), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const snapshot = await response.json() as {
        activeTurnId?: string
        messages?: Array<{ role: string; content: string }>
      }
      if (snapshot.activeTurnId && snapshot.messages?.some((message) => message.content === firstMessage)) {
        firstActiveRead = snapshot
      }
      if (snapshot.activeTurnId && snapshot.messages?.some((message) => message.content === secondMessage)) {
        secondActiveRead = snapshot
      }
      await route.fulfill({ response, json: snapshot })
    })

    await settledInitialRead(owner.page, sessionId)
    await settledInitialRead(ownerMirror.page, sessionId)
    const mirrorComposer = ownerMirror.page.getByRole('textbox', { name: 'Message', exact: true })
    await mirrorComposer.fill(mirrorDraft)
    ownerMirror.page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `${sessionPath}/messages`) {
        mirrorMessagePosts++
      }
    })
    await ownerMirror.page.route(`**/api/v1/sessions/${sessionId}/turns/*/stream*`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      heldStreamRequests++
      if (heldStreamRequests !== 1) return route.continue()
      resolveFirstStreamStarted()
      const response = await route.fetch()
      const body = await response.text()
      resolveFirstStreamBuffered({ status: response.status(), body })
      await firstStreamGate
      await route.fulfill({ response, body })
    })

    const ownerComposer = owner.page.getByRole('textbox', { name: 'Message', exact: true })
    await ownerComposer.fill(firstMessage)
    await ownerComposer.press('Enter')
    await expect(owner.page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(owner.page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })).toBeVisible({ timeout: ms(15_000) })
    await expect.poll(() => !!firstActiveRead, { timeout: ms(15_000) }).toBe(true)
    await expect(ownerMirror.page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await firstStreamStarted

    // The first server stream is real and complete, but its browser response is
    // held. This keeps the mirror's prior observation busy after turn one ends.
    await expect(owner.page.getByText('Claude is writing…', { exact: true })).toHaveCount(0, { timeout: ms(20_000) })
    await completeTurns(owner.page, sessionId, ['user', 'assistant'])
    const buffered = await firstStreamBuffered
    expect(buffered.status, 'the mirror fetched the real first-turn SSE response').toBe(200)
    expect(buffered.body, 'the held response contains the complete first turn').toContain('"type":"message.end"')
    await expect(ownerMirror.page.getByText('Claude is writing…', { exact: true })).toBeVisible()

    await ownerComposer.fill(secondMessage)
    await ownerComposer.press('Enter')
    await expect(owner.page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(owner.page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })).toHaveCount(2, { timeout: ms(15_000) })
    await expect.poll(async () => activeTurn(owner.page, sessionId), { timeout: ms(10_000) }).toBeTruthy()
    const secondTurnId = await activeTurn(owner.page, sessionId)
    await expect.poll(() => !!secondActiveRead, { timeout: ms(15_000) }).toBe(true)
    expect(secondActiveRead?.activeTurnId, 'the mirror performed an authoritative read of the second active turn').toBe(secondTurnId)
    expect(secondActiveRead?.messages?.some((message) => message.role === 'user' && message.content === secondMessage))
      .toBe(true)
    await expect(ownerMirror.page.getByText('Claude is writing…', { exact: true })).toBeVisible()
    await expect(mirrorComposer).toBeDisabled()
    await expect(mirrorComposer).toHaveValue(mirrorDraft)

    releaseFirstStream()
    const mirrorReplies = ownerMirror.page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })
    await expect(mirrorReplies).toHaveCount(2, { timeout: ms(15_000) })
    await expect(ownerMirror.page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(10_000) })
    expect(await mirrorReplies.last().innerText(), 'the next reply appears before its server turn completes').not.toContain('digest')
    await expect.poll(() => activeTurn(owner.page, sessionId), { timeout: ms(10_000) }).toBeTruthy()

    await completeTurns(owner.page, sessionId, ['user', 'assistant', 'user', 'assistant'])
    for (const page of [owner.page, ownerMirror.page]) {
      await expect(page.locator('[data-turn]')).toHaveCount(4)
      await expect(page.locator('[data-turn]').filter({ hasText: firstMessage })).toHaveCount(1)
      await expect(page.locator('[data-turn]').filter({ hasText: secondMessage })).toHaveCount(1)
      const replies = page.locator('[data-turn]').filter({ hasText: REPLY_MARKER })
      await expect(replies).toHaveCount(2)
      await expect(replies.nth(0)).toContainText('digest')
      await expect(replies.nth(1)).toContainText('digest')
      await expect(page.getByText('Claude is writing…', { exact: true })).toHaveCount(0)
    }
    await expect(mirrorComposer).toBeEnabled()
    await expect(mirrorComposer).toHaveValue(mirrorDraft)
    expect(mirrorMessagePosts, 'the mirror observes without sending or retrying a message').toBe(0)
    expect(heldStreamRequests, 'the first stream was held; later reattach requests flowed through').toBeGreaterThanOrEqual(2)
  } finally {
    releaseFirstStream()
    if (sessionId) {
      try {
        const response = await owner.page.request.get(`/api/v1/sessions/${sessionId}`)
        if (response.ok()) {
          const current = await response.json() as { activeTurnId?: string }
          if (current.activeTurnId) {
            await owner.page.request.post(`/api/v1/sessions/${sessionId}/turns/${current.activeTurnId}/cancel`)
          }
        }
      } catch {
        // Context teardown can race cleanup after an earlier browser failure.
      }
    }
    await Promise.all([owner.context.close(), ownerMirror.context.close()])
  }
})
