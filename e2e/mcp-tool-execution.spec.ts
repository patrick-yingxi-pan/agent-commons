import { test, expect, type Locator, type Page } from '@playwright/test'
import type { Session } from '../contract/index.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { tierFor } from '../src/lib/viewport.ts'
import { proxyMcpApi, startMcpFixture, startMcpRouterStack, type McpRouterStack } from './mcp-fixture.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function settleResponsiveView(page: Page) {
  // Responsive shell changes can remount the thread. Let the 280ms entrance
  // animation begin before polling so an empty between-layout frame cannot
  // satisfy the visual-settle condition vacuously.
  await page.waitForTimeout(350)
  await expect.poll(() => page.evaluate(() => {
    const animatedTurns = [...document.querySelectorAll<HTMLElement>('[data-turn]')]
    return animatedTurns.length >= 2
      && animatedTurns.every(turn => Number.parseFloat(getComputedStyle(turn).opacity) >= 0.99)
  })).toBe(true)
}

async function inspectExecutionFixture(page: Page, fixtureUrl: string, label: string) {
  await page.goto('/contexts')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true })
    .getByRole('button', { name: 'Add an MCP server' }).click()
  const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
  await create.getByLabel('Name').fill(label)
  await create.getByLabel('Server URL').fill(fixtureUrl)
  await create.getByRole('button', { name: 'Save server', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
  await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true })
    .getByRole('button', { name: 'Inspect catalog', exact: true }).click()
  await expect(page.getByText('Available with approval', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  const connectionId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('button', { name: 'Close pane', exact: true }).click()
  return connectionId
}

async function attachExternalMcp(page: Page, sessionId: string, label: string, expectOverflow = false) {
  await page.goto(`/s/${sessionId}`)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^MCP server/ }).click()
  const externalButton = (within: Locator) => within.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  const inlineExternal = externalButton(picker)
  const more = picker.getByRole('button', { name: /^More available\b/ })
  await expect.poll(async () => await inlineExternal.isVisible() || await more.isVisible()).toBe(true)
  if (expectOverflow) {
    await expect(more).toBeVisible()
    await expect(inlineExternal).toHaveCount(0)
  }
  let external = inlineExternal
  if (!await inlineExternal.isVisible()) {
    await more.hover()
    // RecentOverflowList portals its one-level tail to document.body, outside
    // the Add-context dialog. Select the named flyout rather than assuming it
    // is a descendant of the picker.
    const overflow = page.getByRole('dialog', { name: 'More available', exact: true })
    await expect(overflow).toBeVisible()
    const overflowExternal = externalButton(overflow)
    await expect.poll(async () => await inlineExternal.isVisible() || await overflowExternal.isVisible()).toBe(true)
    external = await inlineExternal.isVisible() ? inlineExternal : overflowExternal
  }
  await expect(external).toBeVisible()
  await expect(external).toContainText('Approval required for every call')
  await external.click()
  await expect(page.getByTitle('Open in sidebar').filter({ hasText: label })).toBeVisible({ timeout: ms(20_000) })
  // The atomic context acknowledgement can remount the composer/picker host.
  // Close the settled instance when it remains open; the attached chip above,
  // not a transient popover node, is the authority that the mutation landed.
  const settledPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
  if (await settledPicker.isVisible()) await settledPicker.getByRole('button', { name: 'Done', exact: true }).click()
}

async function seedPickerOverflowConnections(page: Page, stack: McpRouterStack, stamp: string, count: number) {
  for (let index = 0; index < count; index++) {
    const fixture = await startMcpFixture({ label: `Overflow fixture ${stamp} ${index}` })
    try {
      const created = await page.request.post(`${stack.url}/api/v1/mcp-connections`, {
        data: {
          creationId: `picker-overflow-${stamp}-${index}`,
          label: `Overflow fixture ${stamp} ${index}`,
          endpoint: fixture.url,
          authentication: 'none',
        },
      })
      expect(created.ok()).toBe(true)
      const { connection } = await created.json() as { connection: { id: string; revision: number } }
      const inspected = await page.request.post(`${stack.url}/api/v1/mcp-connections/${connection.id}/inspect`, {
        data: { operationId: `picker-overflow-inspect-${stamp}-${index}`, expectedRevision: connection.revision },
      })
      expect(inspected.ok()).toBe(true)
      await inspected.body()
    } finally {
      await fixture.close()
    }
  }
}

async function requestExternalCall(page: Page, query: string) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(`Use the attached external MCP tool with query “${query}”.`)
  await composer.press('Enter')
  const row = page.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'inspect_records' }).last()
  await expect(row.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(row).toContainText(`"query": "${query}"`)
  await expect(row).toContainText('Approval applies only to this call')
  return row
}

async function closeMcpDetailPane(page: Page) {
  const detail = page.locator('[data-mcp-connection]:visible, [data-mcp-catalog]:visible').first()
  if (!await detail.isVisible()) return
  // A resize first changes browser geometry, then the React layout. Choose the
  // expected tier and await its chrome, never branch on the stale wide DOM.
  const tier = tierFor(page.viewportSize()!.width)
  const dock = page.locator('[data-overlay-dock]')
  if (tier !== 'wide') {
    await expect(dock).toHaveAttribute('data-overlay-dock', tier)
    await dock.getByTitle('Close', { exact: true }).click()
  } else {
    await expect(dock).toHaveCount(0)
    await detail.click({ position: { x: 8, y: 8 } })
    const strip = page.locator('[data-mini-rail]')
    const chrome = await strip.isVisible() ? strip : page.getByRole('complementary')
    await chrome.getByRole('button', { name: 'Close pane', exact: true }).click()
  }
  await expect(page.locator('[data-mcp-connection]:visible, [data-mcp-catalog]:visible')).toHaveCount(0)
}

async function captureMcpState(page: Page, row: Locator, suffix: string) {
  const card = row.locator('xpath=../..')
  for (const viewport of VIEWPORTS) {
    const focus = viewport.height <= 390 ? row : card
    await page.setViewportSize(viewport)
    await closeMcpDetailPane(page)
    await settleResponsiveView(page)
    await focus.scrollIntoViewIfNeeded()
    if (viewport.height > 390) {
      await focus.evaluate((element) => {
        const box = element.getBoundingClientRect()
        if (box.top >= 88) return
        let scroller = element.parentElement
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
        scroller?.scrollBy({ top: box.top - 88 })
      })
    }
    await expect(focus).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `external MCP ${suffix} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/mcp-execution-review/${viewport.width}x${viewport.height}-${suffix}.png` })
  }
}

async function captureContextsGuidance(page: Page) {
  await page.goto('/contexts')
  const guidance = page.getByText('Inspect a server, attach its admitted tools to a conversation, then approve each call before it runs.', { exact: false })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(guidance).toBeVisible()
    await assertWcag22Aa(page, `external MCP Contexts guidance ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/mcp-execution-review/${viewport.width}x${viewport.height}-contexts.png` })
  }
}

async function proxyReadOnlySession(page: Page, stack: McpRouterStack, sessionId: string) {
  const pending = new Set<Promise<void>>()
  await page.route('**/api/v1/**', async route => {
    const work = (async () => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/v1/events') {
        await route.abort()
        return
      }
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
      if (route.request().method() === 'GET' && url.pathname === '/api/v1/sessions' && url.search === '') {
        const rows = await response.json() as Session[]
        await route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify(
          rows.map(session => session.id === sessionId ? { ...session, own: false } : session),
        ) })
        return
      }
      await route.fulfill({ response })
    })()
    pending.add(work)
    try { await work } finally { pending.delete(work) }
  })
  return async () => {
    await drainReadOnlyProxy(() => page.unroute('**/api/v1/**'), pending)
  }
}

async function drainReadOnlyProxy(unroute: () => Promise<void>, pending: ReadonlySet<Promise<void>>) {
  await unroute()
  await Promise.all([...pending])
}

test('read-only proxy disposal waits for an in-flight handler to release', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const pending = new Set<Promise<void>>([held])
  let unrouted = false
  let disposed = false
  const disposal = drainReadOnlyProxy(async () => { unrouted = true }, pending).then(() => { disposed = true })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(unrouted).toBe(true)
  expect(disposed).toBe(false)
  release()
  await disposal
  expect(disposed).toBe(true)
})

test('the in-process router restores ambient state when setup fails', async () => {
  const previousAuth = process.env.AUTH_GATE
  const previousModelBaseUrl = process.env.ANTHROPIC_BASE_URL
  const previousModelPort = process.env.MODEL_PORT
  process.env.AUTH_GATE = 'ambient-auth'
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
  process.env.MODEL_PORT = '1'
  try {
    await expect(startMcpRouterStack({ deviceBearerAvailable: true })).rejects.toThrow('configuration is invalid')
    expect(process.env.AUTH_GATE).toBe('ambient-auth')
    expect(process.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:1')
    expect(process.env.MODEL_PORT).toBe('1')
  } finally {
    if (previousAuth === undefined) delete process.env.AUTH_GATE
    else process.env.AUTH_GATE = previousAuth
    if (previousModelBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = previousModelBaseUrl
    if (previousModelPort === undefined) delete process.env.MODEL_PORT
    else process.env.MODEL_PORT = previousModelPort
  }
})

test('the in-process router owns one socket per exchange instead of racing idle pool expiry', async ({ request }) => {
  const stack = await startMcpRouterStack()
  let connections = 0
  stack.server.on('connection', () => { connections++ })
  try {
    for (let index = 0; index < 2; index++) {
      const response = await request.get(`${stack.url}/api/v1/capabilities`)
      expect(response.status()).toBe(200)
      expect(response.headers()['connection']).toBe('close')
    }
    expect(connections, 'each request uses a fresh socket, without retries or an idle timer race').toBe(2)
  } finally { await stack.close() }
})

test('an attached HTTPS MCP tool requires owner approval and persists its inert result', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const previousModelBaseUrl = process.env.ANTHROPIC_BASE_URL
  const previousModelPort = process.env.MODEL_PORT
  // The in-process router must use Playwright's shard-owned model even when a
  // caller supplies a dead ambient endpoint. This is the CI shape: webServer.env
  // is intentionally scoped to the child stack, not inherited by this worker.
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
  process.env.MODEL_PORT = '1'
  let fixture: Awaited<ReturnType<typeof startMcpFixture>> | undefined
  let stack: Awaited<ReturnType<typeof startMcpRouterStack>> | undefined
  let disposeProxy: (() => Promise<void>) | undefined
  try {
    fixture = await startMcpFixture({ label: 'Execution fixture' })
    stack = await startMcpRouterStack()
    disposeProxy = await proxyMcpApi(page, stack)
    const connectionId = await inspectExecutionFixture(page, fixture.url, 'Execution fixture')
    await captureContextsGuidance(page)
    const created = await page.request.post(`${stack.url}/api/v1/sessions`, { data: {} })
    expect(created.ok()).toBe(true)
    const session = await created.json() as Session
    await attachExternalMcp(page, session.id, 'Execution fixture')
    const contexts = await (await page.request.get(`${stack.url}/api/v1/sessions/${session.id}/contexts`)).json() as Array<{ id: string }>
    expect(contexts.map(context => context.id)).toContain(connectionId)

    const proposed = await requestExternalCall(page, 'approval-e2e')
    await closeMcpDetailPane(page)
    expect(fixture.calls).toEqual(['server/discover', 'tools/list'])
    await captureMcpState(page, proposed, 'owner-approval')

    const reader = await page.context().newPage()
    let disposeReaderProxy = async () => {}
    try {
      disposeReaderProxy = await proxyReadOnlySession(reader, stack, session.id)
      await reader.goto(`/s/${session.id}`)
      const readOnly = reader.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'inspect_records' }).last()
      await expect(readOnly).toContainText('Only the conversation owner can approve or decline this call.')
      await expect(readOnly.getByRole('button', { name: 'Run tool', exact: true })).toBeDisabled()
      await expect(readOnly.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled()
      await captureMcpState(reader, readOnly, 'read-only-approval')
    } finally {
      try { await disposeReaderProxy() } finally { await reader.close() }
    }

    await proposed.getByRole('button', { name: 'Run tool', exact: true }).click()
    const done = page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'inspect_records' }).last()
    await expect(done).toContainText('Fixture result for approval-e2e.', { timeout: ms(20_000) })
    await expect(done).toContainText('Media omitted · image · image/png')
    await expect(done).toContainText('Resource link omitted · Fixture report')
    await expect(done).toContainText('"matched": 1')
    await expect(done.locator('a[href], img, audio, video, iframe, object, embed')).toHaveCount(0)
    await captureMcpState(page, done, 'result')
    expect(fixture.toolCalls).toEqual([{ name: 'inspect_records', arguments: { query: 'approval-e2e' } }])
    await page.reload()
    await expect(page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'Fixture result for approval-e2e.' })).toBeVisible()

    const declined = await requestExternalCall(page, 'decline-e2e')
    await declined.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(page.locator('[data-mcp-tool-status="declined"]').filter({ hasText: 'inspect_records' }).last())
      .toContainText('the external tool was not run')
    expect(fixture.toolCalls).toHaveLength(1)
  } finally {
    try {
      await disposeProxy?.()
      await fixture?.close()
    } finally {
      try {
        await stack?.close()
        if (stack) {
          expect(process.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:1')
          expect(process.env.MODEL_PORT).toBe('1')
        }
      } finally {
        if (previousModelBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
        else process.env.ANTHROPIC_BASE_URL = previousModelBaseUrl
        if (previousModelPort === undefined) delete process.env.MODEL_PORT
        else process.env.MODEL_PORT = previousModelPort
      }
    }
  }
})

test('known MCP errors and post-submission uncertainty stay durable without replay', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const fixture = await startMcpFixture({ label: 'Outcome fixture', toolBehavior: 'error' })
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    await inspectExecutionFixture(page, fixture.url, 'Outcome fixture')
    const created = await page.request.post(`${stack.url}/api/v1/sessions`, { data: {} })
    const session = await created.json() as Session
    await attachExternalMcp(page, session.id, 'Outcome fixture')

    const knownError = await requestExternalCall(page, 'known-error')
    await knownError.getByRole('button', { name: 'Run tool', exact: true }).click()
    const failed = page.locator('[data-mcp-tool-status="failed"]').filter({ hasText: 'inspect_records' }).last()
    await expect(failed).toContainText('Server-reported error', { timeout: ms(20_000) })
    await expect(failed).toContainText('No successful effect is claimed.')
    await captureMcpState(page, failed, 'server-error')
    expect(fixture.toolCalls).toHaveLength(1)

    fixture.setToolBehavior('uncertain')
    const proposed = await requestExternalCall(page, 'uncertain')
    await proposed.getByRole('button', { name: 'Run tool', exact: true }).click()
    const uncertain = page.locator('[data-mcp-tool-status="uncertain"]').filter({ hasText: 'inspect_records' }).last()
    await expect(uncertain).toContainText('may have run, but no result was confirmed', { timeout: ms(30_000) })
    await expect(uncertain).toContainText('won’t be retried automatically')
    await expect(uncertain.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    await captureMcpState(page, uncertain, 'uncertain')
    expect(fixture.toolCalls).toHaveLength(2)
    await page.reload()
    const persisted = page.locator('[data-mcp-tool-status="uncertain"]').filter({ hasText: 'inspect_records' }).last()
    await expect(persisted).toContainText('won’t be retried automatically')
    await expect(persisted.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    expect(fixture.toolCalls).toHaveLength(2)
  } finally { await disposeProxy(); await fixture.close(); await stack.close() }
})

test('long external labels and result descriptors stay contained at 320px', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const longLabel = `Long external connection ${'identity-'.repeat(20)}`
  const longResource = `Resource ${'descriptor-'.repeat(24)}`
  const longMime = `application/vnd.agent-commons.${'schema-'.repeat(20)}+json`
  const fixture = await startMcpFixture({
    label: longLabel,
    resultResourceName: longResource,
    resultMimeType: longMime,
  })
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    // The inline picker is capped at nine rows; nine earlier connected rows
    // force this target into its "More available" flyout even in an otherwise
    // empty worker store. This exercises the real collapsed-list path rather
    // than depending on accumulated state from preceding specs.
    await seedPickerOverflowConnections(page, stack, stamp, 9)
    const longConnectionId = await inspectExecutionFixture(page, fixture.url, longLabel)
    const listed = await page.request.get(`${stack.url}/api/v1/mcp-connections`)
    expect(listed.ok()).toBe(true)
    const { connections } = await listed.json() as { connections: Array<{ id: string }> }
    expect(connections.findIndex(connection => connection.id === longConnectionId)).toBeGreaterThanOrEqual(9)
    const created = await page.request.post(`${stack.url}/api/v1/sessions`, { data: {} })
    const session = await created.json() as Session
    await attachExternalMcp(page, session.id, longLabel, true)
    const proposed = await requestExternalCall(page, 'long-content')
    await proposed.getByRole('button', { name: 'Run tool', exact: true }).click()
    const done = page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'inspect_records' }).last()
    await expect(done).toContainText(longResource, { timeout: ms(20_000) })
    await closeMcpDetailPane(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await settleResponsiveView(page)
    await done.scrollIntoViewIfNeeded()
    const geometry = await done.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, 'long external MCP result 320x700')
    await page.screenshot({ path: '.data/mcp-execution-review/320x700-long-result.png' })
  } finally { await disposeProxy(); await fixture.close(); await stack.close() }
})

test('withheld and rejected tool-card chunks stay local and reload recovers truth', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = `deferred-${Date.now().toString(36)}`
  const targetResponse = await page.request.post('/api/v1/sessions', { data: { firstMessage: `Deferred target ${stamp}` } })
  const target = await targetResponse.json() as Session
  const driverResponse = await page.request.post('/api/v1/sessions', { data: { firstMessage: `Deferred driver ${stamp}` } })
  const driver = await driverResponse.json() as Session
  const proposed = await page.request.post(`/api/v1/sessions/${driver.id}/messages`, {
    data: { text: `Please archive session ${target.id}.` },
    headers: { 'Idempotency-Key': `deferred-tool-${stamp}` },
  })
  expect(proposed.ok()).toBe(true)
  await proposed.body()

  let rejectChunk!: () => Promise<void>
  await page.route(/\/src\/components\/ToolActivityCard\.tsx(?:\?.*)?$/, async route => {
    await new Promise<void>((resolve) => {
      rejectChunk = async () => {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'withheld test chunk' })
        resolve()
      }
    })
  })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto(`/s/${driver.id}`)
  const loading = page.locator('[data-tool-activity-loading]')
  await expect(loading).toHaveAccessibleName('')
  await expect(loading).toContainText('Loading tool activity…')
  await settleResponsiveView(page)
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Workspace remains usable while the tool card loads')
  await expect(composer).toHaveValue('Workspace remains usable while the tool card loads')
  await assertWcag22Aa(page, 'deferred tool activity loading 320x700')
  await page.screenshot({ path: '.data/mcp-execution-review/320x700-tool-chunk-loading.png' })

  await rejectChunk()
  const failed = page.locator('[data-tool-activity-load-error]')
  await expect(failed).toContainText('Couldn’t load tool activity. Reload to review its latest status.')
  await expect(failed).not.toContainText(/approved|declined|proposed/i)
  await expect(composer).toHaveValue('Workspace remains usable while the tool card loads')
  await assertWcag22Aa(page, 'deferred tool activity load error 320x700')
  await page.screenshot({ path: '.data/mcp-execution-review/320x700-tool-chunk-error.png' })

  await page.unroute(/\/src\/components\/ToolActivityCard\.tsx(?:\?.*)?$/)
  await failed.getByRole('button', { name: 'Reload to review', exact: true }).click()
  await expect(page.locator('[data-tool-activity-decision]').filter({ hasText: target.id })).toBeVisible({ timeout: ms(20_000) })
  await expect(page.locator('[data-tool-activity-loading]')).toHaveCount(0)
  await expect(page.locator('[data-tool-activity-load-error]')).toHaveCount(0)
})
