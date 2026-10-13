import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { McpStdioSetupStartRequest } from '../contract/mcpStdioSetup.ts'
import type { McpStdioConnection } from '../server/mcpStdioClient.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'

const VIEWPORTS = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]
const LABEL = `Local fixture ${Date.now().toString(36)}`
const SECRET = 'generated-fixture-env-never-HTTP'
test.describe.configure({ mode: 'serial' })

/** A failing assertion must not be replaced by teardown's closed-page error.
 * Bound route draining, then always close this fixture's sockets and runtime. */
async function cleanup(dispose: () => Promise<void>, stack: { close(): Promise<void> }, failed: boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cleanupError: unknown
  try {
    await Promise.race([dispose(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('MCP browser fixture route cleanup did not drain.')), ms(5_000))
    })])
  } catch (error) { cleanupError = error }
  finally {
    clearTimeout(timer)
    try { await stack.close() } catch (error) { cleanupError ??= error }
  }
  if (cleanupError) {
    if (!failed) throw cleanupError
    test.info().annotations.push({ type: 'cleanup', description: 'Fixture cleanup also failed; the original browser assertion is preserved and owned sockets were closed.' })
  }
}

// Repository-owned in-memory protocol peer only: no subprocess, real credential,
// custody, owner profile or live development service is used in this browser lane.
function nativePeer(methods: string[]): McpStdioConnection {
  return {
    request: async method => {
      methods.push(method)
      return { jsonrpc: '2.0', id: method, result: method === 'server/discover'
        ? { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
        : { resultType: 'complete', tools: [{ name: 'fixture_search', description: 'Search the isolated fixture.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }] } }
    },
    initialized: async () => undefined, close: async () => ({ code: 'released' }), closed: Promise.resolve({ code: 'released' }),
  }
}

async function signIn(page: Page, person = 'ada') {
  await page.goto('/contexts')
  const domain = person === 'maya' ? 'growthworks' : 'acme'
  const response = await page.evaluate(async ({ person, domain }) => {
    const result = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${person}@${domain}.example`, password: `${person}-demo-password` }) })
    return { status: result.status, identity: await result.json() }
  }, { person, domain })
  expect(response.status).toBe(200)
  expect(response.identity.via).toBe('session')
  expect(response.identity.user.id).toBe(`user-${person}`)
  await page.reload()
}

async function seedAccountStack(page: Page) {
  await page.goto('/contexts')
  const statuses = await page.evaluate(async () => {
    const roster = [['grace', 'acme'], ['maya', 'growthworks'], ['noor', 'northlight'], ['omar', 'harborsupport'], ['rei', 'reislab'], ['ada', 'acme']]
    const statuses: number[] = []
    for (const [person, domain] of roster) statuses.push((await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${person}@${domain}.example`, password: `${person}-demo-password` }),
    })).status)
    return statuses
  })
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200])
  await page.reload()
  await page.getByTestId('account-chip').click()
  await expect(page.getByTestId('account-stack-option')).toHaveCount(6)
  await page.keyboard.press('Escape')
}

async function postJson(page: Page, path: string, body?: Record<string, unknown>) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body })
}

async function signedTenant(page: Page, userId: string, tenantId: string) {
  await page.context().addCookies([{ name: SESSION_COOKIE, value: signSession({ userId, tenantId, iat: Date.now() }),
    url: new URL(page.url()).origin, httpOnly: true, sameSite: 'Lax' }])
  await page.reload()
  expect(await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).tenant.id)).toBe(tenantId)
}

async function bridgeFixture(page: Page, url: string, options: { holdStart?: boolean; expired?: boolean; inspectionCleanupFailure?: boolean; nativeCancellation?: boolean } = {}) {
  const calls: Array<{ method: string; request: unknown }> = []
  const nativeHttp: string[] = []
  let prepared: McpStdioSetupStartRequest
  let resolveStart: (() => void) | undefined
  let flow = 0
  let flowId = ''
  let operationId = ''
  let grantReference = ''
  const receiptErrors: string[] = []
  const receipt = (check: () => void) => { try { check() } catch (error) { receiptErrors.push(String(error)); throw error } }
  await page.exposeFunction('mcpStdioFixtureCall', async (method: string, request: McpStdioSetupStartRequest | { flowId: string }) => {
    calls.push({ method, request: structuredClone(request) })
    if (method === 'start') {
      prepared = request as McpStdioSetupStartRequest
      flowId = `stdio-fixture-flow-${++flow}`; operationId = `stdio-fixture-operation-${flow}`
      grantReference = `MCP_STDIO_${randomUUID().replaceAll('-', '').toUpperCase()}`
      if (options.holdStart) await new Promise<void>(resolve => { resolveStart = resolve })
      return { flowId, connectionId: prepared.connectionId, revision: prepared.expectedRevision, status: 'ready' }
    }
    expect(request).toEqual({ flowId })
    const headers = { 'x-account-transition-source': `session:${prepared.source.userId}` }
    if (method === 'authorize') {
      if (options.nativeCancellation) return { flowId, connectionId: prepared.connectionId, revision: prepared.expectedRevision, status: 'cancelled' }
      nativeHttp.push('POST inspect')
      const response = await page.request.post(`${url}/api/v1/mcp-connections/${prepared.connectionId}/inspect`, {
        headers, data: { operationId, expectedRevision: prepared.expectedRevision, grantReference },
      })
      if (options.inspectionCleanupFailure) {
        const body = await response.json()
        receipt(() => { expect(response.status(), JSON.stringify(body)).toBe(409); expect(body.error.code).toBe('capability_unavailable') })
        return { flowId, connectionId: prepared.connectionId, revision: prepared.expectedRevision, status: 'uncertain' }
      }
      const body = await response.json()
      receipt(() => { expect(response.status(), JSON.stringify(body)).toBe(200) })
      // Deliberately lose the IPC acknowledgement AFTER the real backend commit.
      throw new Error('test-owned lost native acknowledgement')
    }
    if (method === 'cancel') return { flowId, connectionId: prepared.connectionId, revision: prepared.expectedRevision, status: options.holdStart ? 'cancelled' : 'uncertain' }
    nativeHttp.push('GET exact receipt')
    const response = await page.request.get(`${url}/api/v1/mcp-connections/${prepared.connectionId}/stdio-source`, { headers })
    const body = await response.json()
    receipt(() => { expect(response.status(), JSON.stringify(body)).toBe(200); expect(body.connection.inspectionOperationId).toBe(operationId) })
    return { flowId, connectionId: prepared.connectionId, revision: body.connection.revision, status: body.connection.status }
  })
  await page.addInitScript(({ expired }) => {
    const scope = window as typeof window & { mcpStdioFixtureCall: (method: string, request: unknown) => Promise<unknown>; agentCommonsDesktop?: Record<string, unknown> }
    scope.agentCommonsDesktop = { ...scope.agentCommonsDesktop, mcpStdio: Object.fromEntries(['start', 'authorize', 'reconcile', 'cancel'].map(method => [method,
      (request: unknown) => {
        if (expired && method === 'reconcile') return Promise.reject(Object.assign(new Error('test-owned expired handle'), { code: 'expired' }))
        return scope.mcpStdioFixtureCall(method, request)
      }])) }
  }, { expired: options.expired ?? false })
  return { calls, nativeHttp, assertHealthy: () => expect(receiptErrors).toEqual([]), release: () => resolveStart?.() }
}

async function createConnection(page: Page, label: string, reviewCreate?: () => Promise<void>) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
  const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
  await create.getByLabel('Name', { exact: true }).fill(label)
  await expect(create.getByRole('option', { name: 'Local process (this desktop)', exact: true })).toHaveJSProperty('disabled', false)
  await create.getByLabel('Transport').selectOption('stdio')
  await expect(create.getByLabel('Server URL')).toHaveCount(0)
  await expect(create.getByLabel('Authentication')).toHaveCount(0)
  await reviewCreate?.()
  await create.getByRole('button', { name: 'Save server', exact: true }).click()
  const row = page.getByRole('main').getByRole('button', { name: label, exact: true })
  await expect(row).toBeVisible({ timeout: ms(15_000) })
  await expect(row.locator('..').locator('..').getByText('Local MCP process · connection required', { exact: true })).toBeVisible()
  await row.click()
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  return new URL(page.url()).pathname
}

async function openSettings(page: Page, label: string) {
  await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Configure ${label}`, exact: true })
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await dialog.getByLabel('Executable path', { exact: true }).fill('/fixture/no-real-program')
  await dialog.getByLabel('Working directory', { exact: true }).fill('/fixture/work')
  await dialog.getByRole('textbox', { name: 'Arguments (JSON array)', exact: true }).fill('["literal ; $(not-a-shell)","--read-only"]')
  await dialog.getByRole('textbox', { name: 'Environment (JSON object)', exact: true }).fill(JSON.stringify({ FIXTURE: SECRET }))
  return dialog
}

async function geometry(page: Page) {
  const panel = page.locator('[data-bounded-dialog="mcp-stdio-setup"]')
  await expect.poll(() => panel.evaluate(element => {
    const workspace = document.querySelector<HTMLElement>('[data-popover-viewport]')?.getBoundingClientRect()
    const height = Math.max(0, Math.min(innerHeight, workspace?.bottom ?? innerHeight) - Math.max(0, workspace?.top ?? 0))
    return Number.parseFloat(element.parentElement!.style.getPropertyValue('--dialog-viewport-height')) === height
  })).toBe(true)
  const metrics = await panel.evaluate(element => {
    const body = element.querySelector<HTMLElement>('[data-dialog-read-region]')!
    const actions = element.querySelector<HTMLElement>('[data-mcp-stdio-actions]')!
    return { top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom,
      actionBottom: actions.getBoundingClientRect().bottom, height: innerHeight, label: body.getAttribute('aria-label'),
      role: body.getAttribute('role'), tabIndex: body.tabIndex, scrollable: body.scrollHeight > body.clientHeight }
  })
  expect(metrics.top).toBeGreaterThanOrEqual(0); expect(metrics.bottom).toBeLessThanOrEqual(metrics.height + 1)
  expect(metrics.actionBottom).toBeLessThanOrEqual(metrics.height + 1)
  expect(metrics.role).toBe('region'); expect(metrics.label).toBe('Local MCP setup review'); expect(metrics.tabIndex).toBe(0)
  if (metrics.scrollable) {
    const reader = panel.locator('[data-dialog-read-region]'); await reader.focus(); await reader.press('End')
    await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await reader.evaluate(element => { element.scrollTop = 0 })
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function noticeGeometry(page: Page) {
  const notice = page.locator('[data-mcp-stdio-recovery]')
  await expect(notice).toHaveAttribute('role', 'region')
  await expect(notice).toHaveAttribute('aria-label', 'Local server setup recovery')
  await expect(notice).toHaveAttribute('tabindex', '0')
  await expect.poll(() => notice.evaluate(element => {
    const box = element.getBoundingClientRect()
    return box.height <= innerHeight * .35 + 1 && element.scrollWidth <= element.clientWidth
  })).toBe(true)
  const widths = await notice.locator('[data-recovery-notice-message]').evaluateAll(elements => elements.map(element => ({
    text: element.getBoundingClientRect().width, row: element.parentElement!.getBoundingClientRect().width,
  })))
  expect(widths.length).toBeGreaterThan(0)
  for (const width of widths) expect(width.text, 'actions wrap before the recovery text collapses into a narrow strip').toBeGreaterThanOrEqual(Math.min(256, width.row) - 1)
}

test('local setup is explicit native-only, recovers lost acknowledgement by reading and remains bounded at five sizes', async ({ page }, testInfo) => {
  test.setTimeout(ms(150_000))
  const methods: string[] = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer(methods), synchronizeStdioBindings: async () => ({ available: true }) })
  const dispose = await proxyMcpApi(page, stack), bridge = await bridgeFixture(page, stack.url)
  const rendererBodies: string[] = []
  let failed = false
  let createdId = '', createPosts = 0, exactCreationReads = 0
  page.on('request', request => {
    if (request.url().includes('/api/v1/') && request.postData()) rendererBodies.push(request.postData()!)
    if (createdId && request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/mcp-connections/${createdId}`) exactCreationReads++
  })
  await page.route('**/api/v1/mcp-connections', async route => {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    createPosts++
    const { origin: _origin, ...headers } = route.request().headers()
    const response = await route.fetch({ url: `${stack.url}/api/v1/mcp-connections`, headers })
    expect(response.status()).toBe(200)
    createdId = (await response.json()).connection.id
    // Drop only the acknowledgement, after the same real person-owned create.
    // With no SSE, only exact read recovery can materialize this saved row.
    await route.abort('failed')
  })
  try {
    await seedAccountStack(page)
    const path = await createConnection(page, LABEL, async () => {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
        await create.getByRole('button', { name: 'Save server', exact: true }).scrollIntoViewIfNeeded()
        await expect(create.getByRole('button', { name: 'Save server', exact: true })).toBeInViewport()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await assertWcag22Aa(page, `Local MCP creation ${viewport.width}x${viewport.height}`)
        await page.screenshot({ path: testInfo.outputPath(`create-${viewport.width}x${viewport.height}.png`) })
      }
    })
    expect(path.endsWith(createdId)).toBe(true)
    expect(createPosts).toBe(1)
    expect(exactCreationReads).toBeGreaterThan(0)
    const approvalCopy = 'Conversation and Contribution tool calls each require their own explicit approval. Local setup does not approve unattended work; local Routines and Commissions each require their own separate approval.'
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(page.getByText(approvalCopy, { exact: false })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    const dialog = await openSettings(page, LABEL)
    expect(bridge.calls).toEqual([]); expect(methods).toEqual([])
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await geometry(page)
      await expect(dialog).toContainText(approvalCopy)
      await assertWcag22Aa(page, `Local MCP settings ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`settings-${viewport.width}x${viewport.height}.png`) })
    }
    await dialog.getByRole('button', { name: 'Review & inspect', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="uncertain"]')).toBeVisible()
    bridge.assertHealthy()
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'authorize'])
    expect(bridge.nativeHttp).toEqual(['POST inspect'])
    expect(methods).toEqual(['server/discover', 'tools/list'])
    expect(bridge.calls[0]!.request).toMatchObject({ expectedRevision: 0, source: { tenantId: 'tenant-acme', userId: 'user-ada' },
      launch: { executable: '/fixture/no-real-program', cwd: '/fixture/work', args: ['literal ; $(not-a-shell)', '--read-only'], env: { FIXTURE: SECRET } } })
    await expect(dialog.getByRole('textbox', { name: 'Environment (JSON object)', exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await geometry(page); await noticeGeometry(page)
      await assertWcag22Aa(page, `Local MCP uncertain ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`uncertain-${viewport.width}x${viewport.height}.png`) })
    }
    await dialog.getByRole('button', { name: 'Close and keep recovery', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
    await page.goBack(); await expect(page).toHaveURL(/\/contexts$/)
    await expect(page.locator('[data-mcp-stdio-recovery]')).toContainText('Check status reads only')
    await page.getByRole('main').getByRole('button', { name: LABEL, exact: true }).click()
    await page.getByRole('button', { name: 'Review local setup', exact: true }).click()
    await dialog.getByRole('button', { name: 'Stop setup', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="uncertain"]')).toBeVisible()
    bridge.assertHealthy()
    await dialog.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="connected"]')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Review & inspect', exact: true })).toHaveCount(0)
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'authorize', 'cancel', 'reconcile'])
    expect(bridge.nativeHttp).toEqual(['POST inspect', 'GET exact receipt'])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
    await expect(dialog.getByLabel('Executable path', { exact: true })).toHaveValue('')
    await expect(dialog.getByRole('textbox', { name: 'Environment (JSON object)', exact: true })).toHaveValue('{}')
    await expect(dialog).toContainText('Reloading clears in-memory recovery')
    await page.reload(); await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    expect(bridge.calls.filter(call => call.method === 'authorize')).toHaveLength(1)
    expect(methods).toEqual(['server/discover', 'tools/list'])
    expect(rendererBodies.join('\n')).not.toContain(SECRET)
    expect(rendererBodies.join('\n')).not.toContain('/fixture/no-real-program')
    expect(createPosts).toBe(1)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(SECRET)
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    const removal = page.getByRole('dialog', { name: `Remove ${LABEL}?`, exact: true })
    await expect(removal).toContainText('earlier program effects are not undone')
    await removal.getByRole('button', { name: 'Remove server', exact: true }).click()
    await expect(page).toHaveURL(/\/contexts$/)
  } catch (error) { failed = true; throw error }
  finally { bridge.release(); await cleanup(dispose, stack, failed) }
})

test('account changes fence a held preparation and foreign accounts cannot review the private local connection', async ({ page }, testInfo) => {
  test.setTimeout(ms(150_000))
  const methods: string[] = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer(methods), synchronizeStdioBindings: async () => ({ available: true }) })
  const dispose = await proxyMcpApi(page, stack), bridge = await bridgeFixture(page, stack.url, { holdStart: true })
  const label = `${LABEL} source fence`
  let failed = false
  try {
    await seedAccountStack(page)
    const org = await postJson(page, '/api/v1/orgs', { name: `${LABEL} peer organization` })
    expect(org.status).toBe(201)
    const tenantId = org.body.id as string
    await signedTenant(page, 'user-ada', tenantId)
    const invite = await postJson(page, `/api/v1/orgs/${tenantId}/invites`, { email: 'grace@acme.example' })
    expect(invite.status).toBe(201)
    const path = await createConnection(page, label)
    const id = path.split('/').at(-1)!
    const dialog = await openSettings(page, label)
    await dialog.getByRole('button', { name: 'Review & inspect', exact: true }).click()
    await expect.poll(() => bridge.calls.length).toBe(1)
    await page.evaluate(async () => { const account = await import('/src/api/account.ts'); account.refreshAccount({ userId: 'user-grace', tenantId: 'tenant-beta' }) })
    await expect(dialog).toHaveCount(0)
    bridge.release()
    await expect.poll(() => bridge.calls.map(call => call.method)).toEqual(['start', 'cancel'])
    await signIn(page, 'grace')
    expect((await postJson(page, `/api/v1/me/invites/${invite.body.id}/accept`)).status).toBe(200)
    await signedTenant(page, 'user-grace', tenantId)
    for (const person of ['same-org-grace', 'grace', 'maya']) {
      if (person !== 'same-org-grace') await signIn(page, person)
      await page.goto(path)
      const sourceStatus = await page.evaluate(async id => (await fetch(`/api/v1/mcp-connections/${id}/stdio-source`, {
        headers: { 'x-account-transition-source': `session:${(await (await fetch('/api/v1/me')).json()).user.id}` },
      })).status, id)
      expect(sourceStatus).toBe(404)
      await expect(page.getByRole('button', { name: 'Configure local server', exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: label, exact: true })).toHaveCount(0)
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await assertWcag22Aa(page, `Local MCP private wall ${person} ${viewport.width}x${viewport.height}`)
        await page.screenshot({ path: testInfo.outputPath(`private-${person}-${viewport.width}x${viewport.height}.png`) })
      }
    }
    await signIn(page); await signedTenant(page, 'user-ada', tenantId); await page.goto(path)
    await expect(page.getByRole('button', { name: 'Configure local server', exact: true })).toBeEnabled()
    expect(methods).toEqual([])
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'cancel'])
  } catch (error) { failed = true; throw error }
  finally { bridge.release(); await cleanup(dispose, stack, failed) }
})

test('expired handles end recovery without replay and reload reads current truth without retaining launch settings', async ({ page }) => {
  const methods: string[] = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer(methods), synchronizeStdioBindings: async () => ({ available: true }) })
  const dispose = await proxyMcpApi(page, stack), bridge = await bridgeFixture(page, stack.url, { expired: true })
  const label = `${LABEL} expired`
  let failed = false
  try {
    await seedAccountStack(page); await createConnection(page, label)
    const dialog = await openSettings(page, label)
    await dialog.getByRole('button', { name: 'Review & inspect', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="uncertain"]')).toBeVisible()
    bridge.assertHealthy()
    await dialog.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="failed"]')).toContainText('recovery handle expired')
    await expect(dialog.getByRole('button', { name: 'Check status', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Review & inspect', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    await page.reload()
    await expect(page.locator('[data-mcp-stdio-recovery]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'authorize'])
    expect(methods).toEqual(['server/discover', 'tools/list'])
  } catch (error) { failed = true; throw error }
  finally { await cleanup(dispose, stack, failed) }
})

test('local transport remains unavailable without native bridge and a refused editor chunk never authorizes', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer([]), synchronizeStdioBindings: async () => ({ available: true }) })
  const dispose = await proxyMcpApi(page, stack)
  let failed = false
  try {
    await seedAccountStack(page)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await expect(create.getByRole('option', { name: 'Local process (this desktop)', exact: true })).toHaveJSProperty('disabled', true)
    const bridge = await bridgeFixture(page, stack.url)
    await page.reload(); const label = `${LABEL} module failure`; await createConnection(page, label)
    await page.route('**/src/components/McpStdioSetupDialog.tsx*', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'test-owned refused optional module' }))
    await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Local MCP setup', exact: true })
    await expect(dialog.getByRole('alert')).toHaveText('Couldn’t load local server setup.')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await expect(dialog).toContainText('does not undo an inspection')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Reload app', exact: true })).toBeInViewport()
      const region = dialog.getByRole('region', { name: 'Local server setup loading', exact: true })
      await expect(region).toHaveAttribute('tabindex', '0')
      await assertWcag22Aa(page, `Local MCP refused lazy editor ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`local-module-failure-${viewport.width}x${viewport.height}.png`) })
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
    expect(bridge.calls).toEqual([])
  } catch (error) { failed = true; throw error }
  finally { await cleanup(dispose, stack, failed) }
})

test('a full renderer reload after a lost acknowledgement reads saved truth and never replays setup', async ({ page }) => {
  const methods: string[] = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer(methods), synchronizeStdioBindings: async () => ({ available: true }) })
  const dispose = await proxyMcpApi(page, stack), bridge = await bridgeFixture(page, stack.url)
  const label = `${LABEL} reload uncertain`
  let failed = false
  try {
    await seedAccountStack(page); await createConnection(page, label)
    const dialog = await openSettings(page, label)
    await dialog.getByRole('button', { name: 'Review & inspect', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="uncertain"]')).toBeVisible()
    bridge.assertHealthy()
    await page.reload()
    await expect(page.locator('[data-mcp-stdio-recovery]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
    await expect(dialog.getByLabel('Executable path', { exact: true })).toHaveValue('')
    await expect(dialog.getByRole('textbox', { name: 'Environment (JSON object)', exact: true })).toHaveValue('{}')
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'authorize'])
    expect(bridge.nativeHttp).toEqual(['POST inspect'])
    expect(methods).toEqual(['server/discover', 'tools/list'])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  } catch (error) { failed = true; throw error }
  finally { await cleanup(dispose, stack, failed) }
})

test('explicit credential cleanup remains available while native setup is uncertain and never reinspects', async ({ page }) => {
  const methods: string[] = []
  let custodyAvailable = true
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer(methods),
    synchronizeStdioBindings: async () => ({ available: custodyAvailable }) })
  const dispose = await proxyMcpApi(page, stack)
  const bridge = await bridgeFixture(page, stack.url, { inspectionCleanupFailure: true })
  let failed = false, cleanupPosts = 0
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/credential-cleanup')) cleanupPosts++ })
  const label = `${LABEL} cleanup recovery`
  try {
    await seedAccountStack(page); await createConnection(page, label)
    const dialog = await openSettings(page, label)
    custodyAvailable = false
    await dialog.getByRole('button', { name: 'Review & inspect', exact: true }).click()
    await expect(dialog.locator('[data-mcp-stdio-phase="uncertain"]')).toBeVisible()
    bridge.assertHealthy()
    await dialog.getByRole('button', { name: 'Close and keep recovery', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled()
    const cleanupButton = page.getByRole('button', { name: 'Retry credential cleanup', exact: true })
    await expect(cleanupButton).toBeEnabled()
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'authorize'])
    custodyAvailable = true
    await cleanupButton.click()
    await expect(cleanupButton).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
    const recovery = page.locator('[data-mcp-stdio-recovery]')
    await recovery.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(recovery.locator('[data-mcp-stdio-phase="connected"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    expect(cleanupPosts).toBe(1)
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'authorize', 'reconcile'])
    expect(bridge.nativeHttp).toEqual(['POST inspect', 'GET exact receipt'])
    expect(methods).toEqual(['server/discover', 'tools/list'])
  } catch (error) { failed = true; throw error }
  finally { await cleanup(dispose, stack, failed) }
})

test('retained local setup notices stay readable and keyboard-scroll within a bounded part of the workspace', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const methods: string[] = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true, openStdio: () => nativePeer(methods), synchronizeStdioBindings: async () => ({ available: true }) })
  const dispose = await proxyMcpApi(page, stack), bridge = await bridgeFixture(page, stack.url, { nativeCancellation: true })
  let failed = false
  try {
    await seedAccountStack(page)
    // Seed real private rows and drive the actual controller through the inert
    // native-Cancel fixture. This exercises retained notice layout, not consent.
    await page.evaluate(async label => {
      const { mcpStdioSetup } = await import('/src/controller/mcpStdioSetup.ts')
      const identity = await (await fetch('/api/v1/me')).json()
      for (let index = 0; index < 8; index++) {
        const response = await fetch('/api/v1/mcp-connections', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-account-transition-source': `session:${identity.user.id}` },
          body: JSON.stringify({ transport: 'stdio', creationId: crypto.randomUUID(), label: `${label} retained review ${index}` }) })
        if (!response.ok) throw new Error(`Fixture create refused: ${response.status}`)
        const { connection } = await response.json()
        await mcpStdioSetup.begin(connection, { tenantId: identity.tenant.id, userId: identity.user.id },
          { executable: '/fixture/no-real-program', cwd: '/fixture/work', args: [], env: {} })
      }
    }, LABEL)
    const notice = page.getByRole('region', { name: 'Local server setup recovery', exact: true })
    await expect(notice.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(8)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await noticeGeometry(page)
      await notice.focus(); await notice.press('End')
      await expect.poll(() => notice.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(notice.getByRole('button', { name: 'Dismiss', exact: true }).last()).toBeInViewport()
      await assertWcag22Aa(page, `Local MCP retained notices ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`retained-notices-${viewport.width}x${viewport.height}.png`) })
      await notice.evaluate(element => { element.scrollTop = 0 })
    }
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).last().click()
    await expect(notice.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(7)
    bridge.assertHealthy()
    expect(bridge.nativeHttp).toEqual([]); expect(methods).toEqual([])
    expect(bridge.calls.filter(call => call.method === 'authorize')).toHaveLength(8)
  } catch (error) { failed = true; throw error }
  finally { await cleanup(dispose, stack, failed) }
})
