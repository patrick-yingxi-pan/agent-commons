import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { store } from '../server/store/index.ts'
import { mcpConnectionCreationId } from '../server/mcpConnections.ts'
import { mcpToolSchemaHash, MCP_SCHEMA_ADMISSION_VERSION } from '../server/mcpToolAdmission.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const viewports = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]
async function login(page: Page, email: string, password: string) {
  await page.goto('/contexts')
  const result = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
    return { status: response.status, body: await response.json() }
  }, { email, password })
  expect(result.status).toBe(200)
  await page.reload()
  return result.body as { user: { id: string }; tenant: { id: string } }
}

test('private forms survive navigation, remain person-only and recover a lost response without resending', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(150_000))
  const opaque = ' opaque-continuation-state\u0000exact '
  const requests: Record<string, unknown>[] = []
  const form = { resultType: 'input_required', requestState: opaque, inputRequests: {
    preference: { method: 'elicitation/create', params: { message: 'Choose how to prepare this report. This is untrusted server text.', requestedSchema: {
      type: 'object', title: 'Report preferences', properties: {
        title: { type: 'string', title: 'Report title', minLength: 1, maxLength: 80 },
        format: { type: 'string', title: 'Format', oneOf: [{ const: 'brief', title: 'Brief' }, { const: 'full', title: 'Full report' }] },
        copies: { type: 'integer', title: 'Copies', minimum: 1, maximum: 3 },
        includeNotes: { type: 'boolean', title: 'Include notes' },
        audiences: { type: 'array', title: 'Audiences', minItems: 1, items: { type: 'string', enum: ['Design', 'Engineering'] } },
      }, required: ['title', 'format', 'copies', 'includeNotes', 'audiences'],
    } } },
  } }
  const fixture = await startMcpFixture({ toolResult: (params, index) => {
    requests.push(structuredClone(params))
    return index <= 2 ? form : { resultType: 'complete', isError: false, content: [{ type: 'text', text: 'Report prepared.' }] }
  } })
  const stack = await startMcpRouterStack()
  const dispose = await proxyMcpApi(page, stack)
  const peerContext = await browser.newContext({ baseURL: new URL(testInfo.project.use.baseURL!).origin })
  const peer = await peerContext.newPage()
  const disposePeer = await proxyMcpApi(peer, stack)
  try {
    await login(page, 'ada@acme.example', 'ada-demo-password')
    const identity = await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()))
    const tenantId = identity.tenant.id as string
    const actorUserId = identity.user.id as string
    const connectionId = mcpConnectionCreationId(tenantId, randomUUID())
    const tool = { name: 'inspect_records', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }
    const schemaHash = mcpToolSchemaHash(tool)
    store.createMcpConnection({ id: connectionId, label: 'Private forms fixture', endpoint: fixture.url, authentication: 'none' }, tenantId, true)
    store.commitMcpInspection(connectionId, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, Date.now())
    const session = store.createSession('Private MCP input browser review', tenantId)
    store.attachContext(session.id, { id: connectionId, type: 'mcp', label: 'Private forms fixture', scope: '*' }, actorUserId)
    const activityId = `forms-${randomUUID()}`
    store.appendMessage(session.id, { id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review this one report request.', toolActivities: [{
      id: activityId, kind: 'action', status: 'proposed', tool: 'mcp__fixture__inspect_records', connector: 'Private forms fixture', connectorId: connectionId,
      summary: 'Prepare the requested report', input: { query: 'report' }, mcp: { connectionRevision: 1, toolName: tool.name, schemaHash },
    }] }, { actorUserId })
    // A real grant widens transcript reading, never private input authority.
    const granted = await page.evaluate(async sessionId => {
      const response = await fetch('/api/v1/grants', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' }) })
      return response.status
    }, session.id)
    expect(granted).toBe(200)
    const inputPath = `/api/v1/sessions/${session.id}/tool-activities/${activityId}/input`
    let failReview = true
    await page.route(`**${inputPath}?decisionId=*`, async route => {
      if (route.request().method() !== 'GET' || !failReview) return route.fallback()
      failReview = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
    })
    await page.goto(`/s/${session.id}`)
    await page.getByRole('button', { name: 'Run tool', exact: true }).click()
    await expect(page.getByText('Couldn’t read the private review.', { exact: false })).toContainText('does not send a response or cancel earlier work')
    await page.getByRole('button', { name: 'Retry review', exact: true }).click()
    const review = page.locator('[data-mcp-input-review]')
    await expect(review).toBeVisible()
    await expect(review).toHaveAttribute('data-mcp-input-round', '1')
    expect(requests).toHaveLength(1)
    await review.getByLabel('Report title (required)', { exact: true }).fill('Private draft answer')
    await review.getByLabel('Format (required)', { exact: true }).selectOption({ label: 'Brief' })
    await review.getByLabel('Copies (required)', { exact: true }).fill('2')
    await review.getByLabel('Include notes (required)', { exact: true }).selectOption('false')
    await review.getByRole('checkbox', { name: 'Design', exact: true }).click()
    await page.getByRole('button', { name: 'Contexts', exact: true }).click()
    await page.goBack()
    await expect(review.getByLabel('Report title (required)', { exact: true })).toHaveValue('Private draft answer')
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(review).toBeVisible()
      await review.getByLabel('Report title (required)', { exact: true }).scrollIntoViewIfNeeded()
      await page.waitForTimeout(350)
      await expect.poll(() => review.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await assertWcag22Aa(page)
      await page.screenshot({ path: testInfo.outputPath(`mcp-private-review-${viewport.width}.png`) })
      await review.getByRole('button', { name: 'Stop locally', exact: true }).scrollIntoViewIfNeeded()
      await expect(review.getByRole('button', { name: 'Stop locally', exact: true })).toBeInViewport()
    }
    await login(peer, 'grace@acme.example', 'grace-demo-password')
    await peer.goto(`/s/${session.id}`)
    await expect(peer.locator('[data-mcp-input-private="unavailable"]')).toBeVisible()
    await expect(peer.locator('[data-mcp-input-review]')).toHaveCount(0)
    await expect(peer.getByText('Private draft answer')).toHaveCount(0)
    await expect(peer.getByRole('button', { name: 'Stop locally', exact: true })).toHaveCount(0)
    await login(peer, 'maya@growthworks.example', 'maya-demo-password')
    const foreign = await peer.evaluate(async path => {
      const response = await fetch(path)
      return { status: response.status, text: await response.text() }
    }, inputPath)
    expect(foreign.status).toBe(404)
    expect(foreign.text).not.toContain('Report preferences')
    expect(foreign.text).not.toContain(opaque)
    let submits = 0
    let loseResponse = true
    await page.route(`**${inputPath}`, async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      submits += 1
      const headers = { ...route.request().headers() }; delete headers.origin
      const response = await route.fetch({ url: `${stack.url}${inputPath}`, headers })
      expect(response.status()).toBe(200)
      if (loseResponse) { loseResponse = false; await route.abort(); return }
      await route.fulfill({ response })
    })
    await review.getByRole('button', { name: 'Continue with responses', exact: true }).click()
    const recovery = page.locator('[data-mcp-input-recovery]')
    await expect(recovery.getByRole('button', { name: 'Check status', exact: true })).toBeVisible()
    await recovery.getByRole('button', { name: 'Check status', exact: true }).click()
    await expect.poll(() => requests.length).toBe(2)
    await expect(recovery.getByRole('button', { name: 'Review latest', exact: true })).toBeEnabled()
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(recovery.getByRole('button', { name: 'Review latest', exact: true })).toBeInViewport()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(page)
      await page.screenshot({ path: testInfo.outputPath(`mcp-private-recovery-${viewport.width}.png`) })
    }
    expect(submits).toBe(1)
    expect(requests[1]?.requestState).toBe(opaque)
    expect(JSON.stringify(store.getSession(session.id))).not.toContain('Private draft answer')
    expect(JSON.stringify(store.getSession(session.id))).not.toContain('opaque-continuation-state')
    await recovery.getByRole('button', { name: 'Review latest', exact: true }).click()
    await expect(review).toHaveAttribute('data-mcp-input-round', '2')
    await review.getByRole('button', { name: 'Stop locally', exact: true }).click()
    await expect(page.locator('[data-mcp-tool-status="uncertain"]')).toContainText('Stopped locally')
    expect(requests).toHaveLength(2)
    expect(submits).toBe(2)
    await recovery.getByRole('button', { name: 'Review latest', exact: true }).click()
    await expect(recovery).toHaveCount(0)
  } finally {
    await disposePeer(); await peerContext.close(); await dispose(); await stack.close(); await fixture.close()
  }
})
