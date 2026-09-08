import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers'
import { ms } from './budget.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi as proxyApi } from './mcp-fixture'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

test('MCP create, inspect, refresh, disconnect, reconnect, and remove use the real route lifecycle', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const fixture = await startMcpFixture({ label: 'Untrusted <fixture>', description: 'Read-only catalog fixture. ' + 'plain-untrusted-text '.repeat(120) })
  const stack = await startMcpRouterStack()
  try {
    await proxyApi(page, stack)
    await page.goto('/contexts')
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name').fill('Untrusted <fixture>')
    await create.getByLabel('Server URL').fill(fixture.url)
    await create.getByRole('button', { name: 'Save server', exact: true }).click()

    const row = page.getByRole('main').getByRole('button', { name: 'Untrusted <fixture>', exact: true })
    await expect(row).toBeVisible({ timeout: ms(20_000) })
    await row.click()
    await expect(page).toHaveURL(/\/contexts\/mcp-connection-[a-f0-9]+$/)
    await expect(page.getByRole('heading', { name: 'Untrusted <fixture>', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(page.getByText('inspect_records', { exact: true })).toBeVisible()
    await expect(page.getByText('plain-untrusted-text', { exact: false })).toBeVisible()
    expect(fixture.calls).toEqual(['server/discover', 'tools/list'])

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertWcag22Aa(page, `MCP catalog ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: `.data/mcp-review/${viewport.width}x${viewport.height}-catalog.png` })
    }

    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect.poll(() => fixture.calls.length).toBe(4)
    expect(fixture.calls.slice(0, 4)).toEqual(['server/discover', 'tools/list', 'server/discover', 'tools/list'])
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Reconnect and inspect', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await page.getByRole('button', { name: 'Reconnect and inspect', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect.poll(() => fixture.calls.length).toBe(6)
    expect(fixture.calls).toEqual(['server/discover', 'tools/list', 'server/discover', 'tools/list', 'server/discover', 'tools/list'])

    const id = new URL(page.url()).pathname.split('/').at(-1)!
    const foreign = await playwrightRequest.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' } })
    try { expect((await foreign.get(`${stack.url}/api/v1/mcp-connections/${id}`)).status()).toBe(404) } finally { await foreign.dispose() }

    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('dialog', { name: /Remove Untrusted/ }).getByRole('button', { name: 'Remove server', exact: true }).click()
    await expect(page).toHaveURL(/\/contexts$/)
    await expect(page.getByRole('main').getByRole('button', { name: 'Untrusted <fixture>', exact: true })).toHaveCount(0)
  } finally { await fixture.close(); await stack.close() }
})

test('a lost inspect acknowledgement retains the exact operation and Retry does not rediscover', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await startMcpFixture()
  const stack = await startMcpRouterStack()
  let loseAcknowledgement = true
  const inspections: Array<{ body: unknown; key: string | undefined }> = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/inspect')) {
      inspections.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] })
    }
  })
  try {
    await proxyApi(page, stack)
    await page.route('**/api/v1/mcp-connections/*/inspect', async (route) => {
      if (route.request().method() !== 'POST' || !loseAcknowledgement) return route.fallback()
      loseAcknowledgement = false
      const requestUrl = new URL(route.request().url())
      const { origin: _origin, ...forwardedHeaders } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${requestUrl.pathname}${requestUrl.search}`, headers: forwardedHeaders })
      expect(response.ok()).toBe(true)
      await response.body()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'ack lost' } }) })
    })
    await page.goto('/contexts')
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name').fill('Retry fixture')
    await create.getByLabel('Server URL').fill(fixture.url)
    await create.getByRole('button', { name: 'Save server', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: 'Retry fixture', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="mcp-connection"]')
    await expect(notice).toBeVisible({ timeout: ms(20_000) })
    await page.getByRole('button', { name: 'Back to Contexts', exact: true }).click()
    await expect(page).toHaveURL(/\/contexts$/)
    await expect(notice).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: 'Retry fixture', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Refresh catalog', exact: true })).toBeDisabled()
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(notice).toHaveCount(0, { timeout: ms(20_000) })
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible()
    expect(fixture.calls).toEqual(['server/discover', 'tools/list'])
    expect(inspections).toHaveLength(2)
    expect(inspections[1]).toEqual(inspections[0])
  } finally { await fixture.close(); await stack.close() }
})

test('device bearer removal retains the reviewed row until exact retry acknowledges cleanup', async ({ page, request }) => {
  test.setTimeout(ms(60_000))
  const token = 'fixture-bearer-token'
  const fixture = await startMcpFixture({ expectedBearer: token })
  const reference = `MCP_DESKTOP_${'A'.repeat(32)}`
  let provisionedBinding: unknown
  const bindings: unknown[] = []
  const removals: Array<{ body: unknown; key: string | undefined }> = []
  const apiBodies: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiBodies.push(request.postData() ?? '')
    if (request.method() === 'DELETE' && new URL(request.url()).pathname.includes('/mcp-connections/')) {
      removals.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] })
    }
  })
  const stack = await startMcpRouterStack({
    deviceBearerAvailable: true,
    resolveCredential: async (requestedReference, binding) => {
      expect(requestedReference).toBe(reference)
      expect(binding).toEqual(provisionedBinding)
      bindings.push({ reference: requestedReference, binding })
      return token
    },
  })
  try {
    await page.exposeFunction('provisionMcpFixture', (binding: unknown, secret: string) => {
      expect(secret).toBe(token)
      provisionedBinding = binding
      return reference
    })
    await page.addInitScript(() => {
      const scope = window as typeof window & {
        agentCommonsDesktop?: Record<string, unknown>
        provisionMcpFixture: (binding: unknown, secret: string) => Promise<string>
      }
      scope.agentCommonsDesktop = {
        ...(scope.agentCommonsDesktop ?? {}),
        mcpCredentials: { provision: (binding: unknown, secret: string) => scope.provisionMcpFixture(binding, secret) },
      }
    })
    await proxyApi(page, stack)
    await page.goto('/contexts')
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name').fill('Bearer fixture')
    await create.getByLabel('Server URL').fill(fixture.url)
    await create.getByLabel('Authentication').selectOption('device-bearer')
    await create.getByRole('button', { name: 'Save server', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: 'Bearer fixture', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    const inspect = page.getByRole('dialog', { name: 'Inspect MCP server', exact: true })
    await inspect.getByLabel('Bearer token').fill(token)
    await inspect.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.authorization).toEqual([`Bearer ${token}`, `Bearer ${token}`])
    expect(bindings[0]).toMatchObject({ reference: `MCP_DESKTOP_${'A'.repeat(32)}` })
    expect(JSON.stringify(bindings)).not.toContain(token)
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    expect(provisionedBinding).toMatchObject({ connectionId: id, endpoint: fixture.url })
    const ordinary = await request.get(`${stack.url}/api/v1/mcp-connections/${id}`)
    expect(ordinary.ok()).toBe(true)
    const visible = await ordinary.text()
    for (const privateValue of [token, reference, fixture.url]) expect(visible).not.toContain(privateValue)
    stack.setCleanupAvailable(false)
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('dialog', { name: /Remove Bearer/ }).getByRole('button', { name: 'Remove server', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="mcp-connection"]')
    await expect(notice).toContainText('Server change saved; device credential cleanup remains pending.')
    expect((await request.get(`${stack.url}/api/v1/mcp-connections/${id}`)).status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Bearer fixture', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to Contexts', exact: true }).click()
    const heldRow = page.getByRole('main').getByRole('button', { name: 'Bearer fixture', exact: true })
    await expect(heldRow).toBeVisible()
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notice).toContainText('Server change saved; device credential cleanup remains pending.')
    await expect(heldRow).toBeVisible()
    expect(removals).toHaveLength(1)
    stack.setCleanupAvailable(true)
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(heldRow).toHaveCount(0)
    expect(removals).toHaveLength(2)
    expect(removals[1]).toEqual(removals[0])
    expect(removals[0]!.key).toBeTruthy()
    expect(apiBodies.join('\n')).not.toContain(token)
    expect((await (await request.get(`${stack.url}/api/v1/mcp-connections`)).json()).capabilities.credentialCleanupPending).toBe(false)
  } finally { await fixture.close(); await stack.close() }
})
