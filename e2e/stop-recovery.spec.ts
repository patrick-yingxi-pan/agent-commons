/** Failure-first rendered coverage for the acknowledgement-owned Stop lifecycle.
 * The real model turn, session, and persistence remain server-owned. Only the
 * first browser cancellation response is held and rejected; Retry receives an
 * acknowledgement fixture so the requested-but-not-yet-settled state can be
 * inspected before the same real turn is cancelled through its route. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import { splitPane } from './pane-actions.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

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
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  const stamp = randomUUID()
  const message = `paced stop lifecycle recovery ${stamp}`
  const cancelPaths: string[] = []
  let sessionId: string | undefined
  let expectedCancelPath: string | undefined
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
    const created = await page.request.post('/api/v1/sessions', { data: {} })
    expect(created.ok(), 'a real fresh session is created for this viewport').toBe(true)
    sessionId = ((await created.json()) as { id: string }).id
    await page.goto(`/s/${sessionId}`)
    const composer = page.getByPlaceholder('Reply to Claude…')
    await expect(composer).toBeEnabled()
    await composer.fill(message)
    await composer.press('Enter')

    await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`), { timeout: ms(15_000) })
    await expect(page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })
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
      await expect(duplicatedPanes.getByText('Claude is writing…', { exact: true })).toHaveCount(2)
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
    await captureStopState(page, testInfo, 'pending', viewport)

    // The first real request remains unresolved until the pending state has
    // been captured and audited. Its transport rejection must surface exact
    // recovery.
    releaseFirstCancel()
    const failure = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm Stop. The reply may still be running.' })
    await expect(failure).toHaveCount(duplicatedPanes ? 2 : 1, { timeout: ms(10_000) })
    const retry = failure.getByRole('button', { name: 'Retry stop', exact: true })
    await expect(retry.first()).toBeVisible()
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
    await captureStopState(page, testInfo, 'requested', viewport)

    // The intercepted 204 is a UI fixture only. Now use the genuine endpoint so
    // the paced model stream ends and its partial is durably persisted.
    const settled = await page.request.post(expectedCancelPath!)
    expect(settled.ok(), 'the real cancellation settles the same server-owned turn').toBe(true)
    await expect(page.getByText('Claude is writing…', { exact: true })).toHaveCount(0, { timeout: ms(10_000) })
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
    expect(complete.messages[1]!.content, 'the saved reply is partial, not the full canned response').not.toContain('digest')
    expect(complete.activeTurnId ?? null).toBeNull()
    expect(cancelPaths).toEqual([expectedCancelPath, expectedCancelPath])
  } finally {
    // A failed assertion must release the held route and stop its real turn so
    // neither a browser request nor paced generation leaks into later tests.
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

test('a conversation viewer can follow its live reply but only the owner can send or stop', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  // The remote test header seam preserves known user-ada while synthesizing an
  // unknown tenant id as an org (server/identity.ts); this isolates turn usage.
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-stop-owner' })
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = randomUUID()
  const message = `paced owner turn while Grace watches ${stamp}`
  let sessionId: string | undefined

  try {
    const created = await owner.page.request.post('/api/v1/sessions', { data: {} })
    expect(created.ok(), 'Ada creates the conversation fixture through the real session route').toBe(true)
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
    await expect(owner.page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(owner.page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })
    const live = await (await owner.page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      activeTurnId?: string
    }
    expect(live.activeTurnId, 'the owner’s paced turn remains server-active before Grace attaches').toBeTruthy()

    // An open shared page does not automatically discover a turn that begins
    // later. Reload while the turn is active to exercise the documented GET +
    // live reattach path; this does not claim start-time auto-discovery.
    await grace.page.reload()
    await expect(grace.page.getByText('Claude is writing…', { exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(grace.page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })
    await expect(grace.page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(grace.page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
    await expect(grace.page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
    await expect.poll(() => grace.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(grace.page, 'Live shared conversation at 1280×800')
    await grace.page.screenshot({ path: testInfo.outputPath('shared-live-viewer-1280x800.png'), fullPage: true })

    await expect(owner.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(owner.page.getByText('Claude is writing…', { exact: true })).toHaveCount(0, { timeout: ms(10_000) })
    await expect(grace.page.getByText('Claude is writing…', { exact: true })).toHaveCount(0, { timeout: ms(10_000) })
    await expect.poll(async () => {
      const full = await (await owner.page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
        messages?: Array<{ role: string; content: string }>
        activeTurnId?: string | null
      }
      return { roles: (full.messages ?? []).map((row) => row.role), live: full.activeTurnId ?? null }
    }).toEqual({ roles: ['user', 'assistant'], live: null })
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
    await Promise.all([owner.context.close(), grace.context.close(), maya.context.close()])
  }
})
