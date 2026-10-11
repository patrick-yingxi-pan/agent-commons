import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'

const LABEL = `OAuth fixture ${Date.now().toString(36)}`
const LONG_ISSUER = `https://issuer.fixture.example/${'authorization-server-segment-'.repeat(5)}`
const LONG_SCOPE_READ = `records:read:${'resource-boundary/'.repeat(6)}`
const LONG_SCOPE_PROFILE = `profile:basic:${'identity-boundary/'.repeat(6)}`
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
test.describe.configure({ mode: 'serial' })

async function installSessionAccount(page: Page) {
  // OAuth is owner-bound, so the UI and in-memory router must agree on a
  // verified principal. Sign in through the real isolated router; do not fake
  // `via: session` on /me while leaving the server request unsigned.
  await page.goto('/contexts')
  const login = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@acme.example', password: 'ada-demo-password' }),
    })
    return { status: response.status, identity: await response.json() as { via?: string; user?: { id?: string } } }
  })
  expect(login.status).toBe(200)
  expect(login.identity.via).toBe('session')
  expect(login.identity.user?.id).toBe('user-ada')
  await page.reload()
  const identity = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me')
    return await response.json() as { via?: string; user?: { id?: string } }
  })
  expect(identity.via).toBe('session')
  expect(identity.user?.id).toBe('user-ada')
}

async function installOAuthBridge(page: Page, options: { cancelPending?: boolean; holdStart?: boolean; longReview?: boolean } = {}) {
  const calls: Array<{ method: string; request: Record<string, unknown> }> = []
  let connectionId = ''
  let releaseStart: (() => void) | undefined
  let startEntered!: () => void
  const entered = new Promise<void>(resolve => { startEntered = resolve })
  await page.exposeFunction('mcpOAuthFixtureCall', async (method: string, request: Record<string, unknown>) => {
    calls.push({ method, request: structuredClone(request) })
    const flowId = 'mcp-oauth-flow-fixture'
    if (method === 'start') {
      connectionId = String(request.connectionId)
      startEntered()
      if (options.holdStart) await new Promise<void>(resolve => { releaseStart = resolve })
      return { flowId, connectionId: request.connectionId, revision: request.expectedRevision, authorizationServers: [options.longReview ? LONG_ISSUER : 'https://issuer.fixture.example'] }
    }
    if (method === 'review') return { ...request,
      scopesSupported: options.longReview ? [LONG_SCOPE_READ, LONG_SCOPE_PROFILE] : ['records:read', 'profile:basic'],
      suggestedScopes: [options.longReview ? LONG_SCOPE_READ : 'records:read'] }
    if (method === 'authorize') return { status: 'inspection-pending', flowId: request.flowId }
    if (method === 'reconcile') return { status: 'complete', connection: { id: connectionId, revision: 1, status: 'connected' }, credentialCleanup: 'complete' }
    if (method === 'cancel') return options.cancelPending ? { status: 'inspection-pending', flowId: request.flowId } : { status: 'cancelled' }
    throw new Error('unexpected fixture bridge call')
  })
  await page.addInitScript(() => {
    const scope = window as typeof window & { mcpOAuthFixtureCall: (method: string, request: Record<string, unknown>) => Promise<unknown>; agentCommonsDesktop?: Record<string, unknown> }
    scope.agentCommonsDesktop = {
      ...(scope.agentCommonsDesktop ?? {}),
      mcpOAuth: Object.fromEntries(['start', 'review', 'authorize', 'reconcile', 'cancel'].map(method => [method,
        (request: Record<string, unknown>) => scope.mcpOAuthFixtureCall(method, request)])),
    }
  })
  return { calls, entered, release: () => releaseStart?.() }
}

async function createOAuthConnection(page: Page, label = LABEL) {
  await page.goto('/contexts')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
  const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
  await create.getByLabel('Name').fill(label)
  await create.getByLabel('Server URL').fill('https://oauth-fixture.example/mcp')
  await expect(create.getByRole('option', { name: 'OAuth sign-in on this Mac' })).toHaveJSProperty('disabled', false)
  await create.getByLabel('Authentication').selectOption('device-oauth')
  await create.getByRole('button', { name: 'Save server', exact: true }).click()
  const row = page.getByRole('main').getByRole('button', { name: label, exact: true })
  await expect(row).toBeVisible({ timeout: ms(15_000) })
  await row.click()
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  return new URL(page.url()).pathname.split('/').at(-1)!
}

async function startReview(page: Page, issuer = 'https://issuer.fixture.example') {
  await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Sign in to / })
  await dialog.getByRole('button', { name: 'Find sign-in options', exact: true }).click()
  await dialog.getByLabel('Authorization server').selectOption(issuer)
  await dialog.getByRole('button', { name: 'Review access request', exact: true }).click()
  await expect(dialog.getByText('Available permissions', { exact: true })).toBeVisible()
  return dialog
}

async function assertOAuthDialogGeometry(page: Page) {
  const panel = page.locator('[data-bounded-dialog="mcp-oauth-review"]')
  // setViewportSize can resolve before the resize observer updates the shared
  // dialog bound. Do not decide whether scrolling is required from the prior
  // viewport's capped body height.
  await expect.poll(() => panel.evaluate(element => {
    const layer = element.parentElement!
    const workspace = document.querySelector<HTMLElement>('[data-popover-viewport]')
    const bounds = workspace?.getBoundingClientRect()
    const top = Math.max(0, bounds?.top ?? 0)
    const bottom = Math.min(innerHeight, bounds?.bottom ?? innerHeight)
    return Number.parseFloat(layer.style.getPropertyValue('--dialog-viewport-height')) === Math.max(0, bottom - top)
  })).toBe(true)
  const metrics = await panel.evaluate(element => {
    const body = element.querySelector<HTMLElement>('[data-dialog-read-region]')!
    const actions = element.querySelector<HTMLElement>('[data-mcp-oauth-actions]')!
    const panelRect = element.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    return {
      panelTop: panelRect.top, panelBottom: panelRect.bottom, bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom, actionsTop: actionsRect.top, actionsBottom: actionsRect.bottom,
      height: innerHeight, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
      role: body.getAttribute('role'), label: body.getAttribute('aria-label'), tabIndex: body.tabIndex,
    }
  })
  expect(metrics.panelTop).toBeGreaterThanOrEqual(0)
  expect(metrics.panelBottom).toBeLessThanOrEqual(metrics.height + 1)
  expect(metrics.actionsBottom).toBeLessThanOrEqual(metrics.height + 1)
  expect(metrics.actionsTop).toBeGreaterThan(metrics.bodyTop)
  expect(metrics.role).toBe('region')
  expect(metrics.label).toBe('OAuth sign-in review')
  expect(metrics.tabIndex).toBe(0)
  if (metrics.scrollHeight > metrics.clientHeight) {
    const body = panel.locator('[data-dialog-read-region]')
    await body.focus()
    await body.press('End')
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await body.evaluate(element => { element.scrollTop = 0 })
  }
}

test('OAuth review requires explicit scopes before browser authorization and recovers the same pending flow', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page, { cancelPending: true, longReview: true })
  try {
    await installSessionAccount(page)
    const connectionId = await createOAuthConnection(page)
    const dialog = await startReview(page, LONG_ISSUER)
    await expect(dialog.getByRole('checkbox', { name: new RegExp(LONG_SCOPE_READ) })).toHaveAttribute('aria-checked', 'false')
    await expect(dialog.getByRole('checkbox', { name: new RegExp(LONG_SCOPE_PROFILE) })).toHaveAttribute('aria-checked', 'false')
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'review'])

    const selectedProfile = dialog.getByRole('checkbox', { name: new RegExp(LONG_SCOPE_PROFILE) })
    await selectedProfile.click()
    await expect(selectedProfile).toHaveAttribute('aria-checked', 'true')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertOAuthDialogGeometry(page)
      await assertWcag22Aa(page, `MCP OAuth review ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`scope-review-${viewport.width}x${viewport.height}.png`) })
    }
    await dialog.getByRole('button', { name: 'Continue to browser sign-in', exact: true }).click()
    await expect(dialog.getByText(/inspection may have reached the server/i)).toBeVisible()
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'review', 'authorize'])
    expect(bridge.calls[2]).toEqual({ method: 'authorize', request: { flowId: 'mcp-oauth-flow-fixture', scopes: [LONG_SCOPE_PROFILE] } })
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertOAuthDialogGeometry(page)
      await assertWcag22Aa(page, `MCP OAuth pending ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`pending-${viewport.width}x${viewport.height}.png`) })
    }

    // SPA Back unmounts the dialog without erasing its account-scoped recovery
    // handle. Returning to the same detail must check the exact same flow.
    await page.goBack()
    await expect(page).toHaveURL(/\/contexts$/)
    await page.getByRole('main').getByRole('button', { name: LABEL, exact: true }).click()
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    const recovered = page.getByRole('dialog', { name: /Sign in to / })
    await expect(recovered.getByText(/previous sign-in may have submitted inspection/i)).toBeVisible()
    await recovered.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(recovered).toHaveCount(0)
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'review', 'authorize', 'cancel', 'reconcile'])
    expect(bridge.calls.at(-1)).toEqual({ method: 'reconcile', request: { flowId: 'mcp-oauth-flow-fixture' } })
    expect(connectionId).toMatch(/^mcp-connection-/)
  } finally { await disposeProxy(); await stack.close() }
})

test('OAuth Cancel ends discovery before review or authorization', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page)
  try {
    await installSessionAccount(page)
    await createOAuthConnection(page, `${LABEL} cancel`)
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /Sign in to / })
    await dialog.getByRole('button', { name: 'Find sign-in options', exact: true }).click()
    await expect(dialog.getByLabel('Authorization server')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'cancel'])
  } finally { await disposeProxy(); await stack.close() }
})

test('Close and keep recovery closes a submitted-flow dialog and reopens its same pending handle', async ({ page }) => {
  test.setTimeout(ms(50_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page, { cancelPending: true })
  try {
    await installSessionAccount(page)
    await createOAuthConnection(page, `${LABEL} close recovery`)
    const dialog = await startReview(page)
    await dialog.getByRole('button', { name: 'Continue to browser sign-in', exact: true }).click()
    await expect(dialog.getByText(/inspection may have reached the server/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close and keep recovery', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'review', 'authorize', 'cancel'])

    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    const recovered = page.getByRole('dialog', { name: /Sign in to / })
    await expect(recovered.getByText(/previous sign-in may have submitted inspection/i)).toBeVisible()
    await recovered.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect(recovered).toHaveCount(0)
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'review', 'authorize', 'cancel', 'reconcile'])
    expect(bridge.calls.at(-1)).toEqual({ method: 'reconcile', request: { flowId: 'mcp-oauth-flow-fixture' } })
  } finally { await disposeProxy(); await stack.close() }
})

test('account changes dismiss review before authorization can be requested', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page)
  try {
    await installSessionAccount(page)
    await createOAuthConnection(page, `${LABEL} request fence`)
    const dialog = await startReview(page)
    await page.evaluate(async () => {
      const account = await import('/src/api/account.ts')
      account.refreshAccount({ userId: 'user-oauth-other', tenantId: 'tenant-oauth-other' })
    })
    // Account reset unmounts the old workspace and its dialog. There must be
    // no old-account action left to click, and unmount cancels the native flow.
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => bridge.calls.map(call => call.method)).toEqual(['start', 'review', 'cancel'])
  } finally { await disposeProxy(); await stack.close() }
})

test('account changes dismiss pending recovery before reconciliation can be requested', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page)
  try {
    await installSessionAccount(page)
    await createOAuthConnection(page, `${LABEL} reconcile fence`)
    const dialog = await startReview(page)
    await dialog.getByRole('button', { name: 'Continue to browser sign-in', exact: true }).click()
    await expect(dialog.getByText(/inspection may have reached the server/i)).toBeVisible()
    await page.evaluate(async () => {
      const account = await import('/src/api/account.ts')
      account.refreshAccount({ userId: 'user-oauth-other', tenantId: 'tenant-oauth-other' })
    })
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => bridge.calls.map(call => call.method)).toEqual(['start', 'review', 'authorize', 'cancel'])
  } finally { await disposeProxy(); await stack.close() }
})

test('account-generation change fences a late OAuth discovery result and cancels its returned flow', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page, { holdStart: true })
  try {
    await installSessionAccount(page)
    await createOAuthConnection(page, `${LABEL} account fence`)
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /Sign in to / })
    await dialog.getByRole('button', { name: 'Find sign-in options', exact: true }).click()
    await bridge.entered
    // This is the same account-transition primitive used by the account
    // switch controller, made deterministic while the native start is held.
    await page.evaluate(async () => {
      const account = await import('/src/api/account.ts')
      account.refreshAccount({ userId: 'user-oauth-other', tenantId: 'tenant-oauth-other' })
    })
    bridge.release()
    await expect.poll(() => bridge.calls.map(call => call.method)).toContain('cancel')
    expect(bridge.calls.map(call => call.method)).toEqual(['start', 'cancel'])
    expect(bridge.calls.some(call => call.method === 'review' || call.method === 'authorize')).toBe(false)
  } finally { bridge.release(); await disposeProxy(); await stack.close() }
})

test('the OAuth choice stays unavailable when native bridge methods are absent', async ({ page }) => {
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    await installSessionAccount(page)
    await page.goto('/contexts')
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    // toBeDisabled follows the enclosing label to its enabled select. Check
    // each native option itself, then prove keyboard selection skips them.
    await expect(create.getByRole('option', { name: 'OAuth sign-in on this Mac' })).toHaveJSProperty('disabled', true)
    await expect(create.getByRole('option', { name: 'Bearer token on this Mac' })).toHaveJSProperty('disabled', true)
    await create.getByLabel('Authentication').focus()
    await create.getByLabel('Authentication').press('End')
    await expect(create.getByLabel('Authentication')).toHaveValue('none')
  } finally { await disposeProxy(); await stack.close() }
})

test('a refused OAuth dialog chunk stays local, cancellable, and recovers through explicit reload', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-test-only-token' })
  const disposeProxy = await proxyMcpApi(page, stack)
  const bridge = await installOAuthBridge(page)
  let releaseModule!: () => void
  let markEntered!: () => void
  const heldModule = new Promise<void>(resolve => { releaseModule = resolve })
  const entered = new Promise<void>(resolve => { markEntered = resolve })
  try {
    await installSessionAccount(page)
    const label = `${LABEL} blocked module`
    await createOAuthConnection(page, label)
    await page.route('**/src/components/DeferredMcpOAuthSetupDialog.tsx*', async route => {
      markEntered()
      await heldModule
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'test-owned refused optional module' })
    })
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    await entered
    const dialog = page.getByRole('dialog', { name: 'MCP OAuth review' })
    await expect(dialog.getByRole('status')).toHaveText('Loading OAuth review…')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('oauth-module-loading.png') })
    releaseModule()
    await expect(dialog.getByRole('alert')).toContainText('Couldn’t load OAuth review.')
    await expect(dialog.getByRole('alert')).toContainText('Reloading closes this review')
    await expect(dialog.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('oauth-module-failure.png') })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Couldn’t load OAuth review.')
    await page.unroute('**/src/components/DeferredMcpOAuthSetupDialog.tsx*')
    await Promise.all([
      page.waitForEvent('load'),
      dialog.getByRole('button', { name: 'Reload app', exact: true }).click(),
    ])
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    await expect(page.getByRole('dialog', { name: `Sign in to ${label}` })
      .getByRole('button', { name: 'Find sign-in options', exact: true })).toBeVisible()
    expect(bridge.calls).toEqual([])
  } finally {
    releaseModule()
    await disposeProxy()
    await stack.close()
  }
})
