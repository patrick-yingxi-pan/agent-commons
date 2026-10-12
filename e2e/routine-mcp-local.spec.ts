/** Local Routine MCP review uses an authored in-memory stdio host, never a
 * spawned program or real native credential. Packaged acceptance is separate. */
import { randomUUID } from 'node:crypto'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import type { ScheduleTemplate } from '../contract/index.ts'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { mcpStdioConnectionCreationId } from '../server/mcpConnections.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { synchronizeMcpCredentials } from '../server/mcpRuntime.ts'
import type { McpStdioConnection } from '../server/mcpStdioClient.ts'
import { store } from '../server/store/index.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const tool = { name: 'inspect_local_records', inputSchema: {
  type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
} }

async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/api/v1${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() as any }
  }, { method, path, body })
}

async function signIn(page: Page, email: string, password: string, userId: string) {
  await page.goto('/scheduled')
  const result = await api(page, 'POST', '/auth/login', { email, password })
  expect(result.status).toBe(200)
  expect(result.body.user.id).toBe(userId)
  await page.reload()
}

async function selectWorkspace(page: Page, userId: string, tenantId: string) {
  await page.context().addCookies([{ name: SESSION_COOKIE,
    value: signSession({ userId, tenantId, iat: Date.now() }), url: new URL(page.url()).origin,
    httpOnly: true, sameSite: 'Lax',
  }])
  await page.reload()
  const identity = await api(page, 'GET', '/me')
  expect(identity.body.via).toBe('session')
  expect(identity.body.user.id).toBe(userId)
  expect(identity.body.tenant.id).toBe(tenantId)
}

function localPeer(methods: string[], resultText = 'Local fixture result', failedToolCall: () => boolean = () => false): McpStdioConnection {
  return {
    request: async (method) => {
      methods.push(method)
      if (method === 'tools/call') return { jsonrpc: '2.0', id: method, result: {
        resultType: 'complete', content: [{ type: 'text', text: resultText }], isError: failedToolCall(),
      } }
      if (method === 'server/discover') return { jsonrpc: '2.0', id: method, result: {
        resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'authored-local-routine-peer', version: '1' } },
      } }
      if (method === 'tools/list') return { jsonrpc: '2.0', id: method, result: { resultType: 'complete', tools: [tool] } }
      return { jsonrpc: '2.0', id: method, result: { resultType: 'complete' } }
    },
    initialized: async () => undefined,
    close: async () => ({ code: 'released' }),
    closed: Promise.resolve({ code: 'released' }),
  }
}

function seedLocalConnection(tenantId: string, ownerUserId: string, label: string) {
  const suffix = randomUUID().replace(/-/g, '').toUpperCase()
  const id = mcpStdioConnectionCreationId(tenantId, suffix, ownerUserId)
  const grantReference = `MCP_STDIO_${suffix}`
  store.createMcpConnection({ transport: 'stdio', id, label }, tenantId, false, ownerUserId)
  store.commitMcpInspection(id, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), undefined, undefined, ownerUserId, grantReference)
  return { id, label }
}

async function createRoutine(page: Page, suffix: string, tenantId?: string) {
  const templates = (await api(page, 'GET', '/schedule-templates')).body as ScheduleTemplate[]
  const created = await api(page, 'POST', '/schedules', { seed: { ...templates[0]!.seed,
    name: `Local Routine ${suffix}`, enabled: false, prompt: 'Review the exact local tool before approving.', runs: [], steps: [],
    delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' },
  } })
  expect(created.status).toBe(200)
  expect(created.body.tenantId === undefined || created.body.tenantId === tenantId).toBe(true)
  return { id: created.body.id as string, name: created.body.name as string }
}

async function reviewLocalChoice(panel: ReturnType<Page['getByRole']>, label: string) {
  const card = panel.locator('article').filter({ hasText: label })
  await expect(card).toContainText('Local program')
  await card.getByRole('checkbox').check()
  await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
  return panel.locator('[aria-label="Approval review"]')
}

async function captureReview(page: Page, subject: ReturnType<Page['getByRole']>, label: string, entireSubject = false) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    if (entireSubject) {
      // Intersection geometry includes clipping ancestors. Allow only a CSS
      // pixel of rounding: Chromium can report 0.9995 for a fully painted edge.
      await expect.poll(() => subject.evaluate(element => new Promise<number>(resolve => {
        const observer = new IntersectionObserver(([entry]) => {
          observer.disconnect()
          const box = entry!.boundingClientRect
          const visible = entry!.intersectionRect
          resolve(Math.max(visible.top - box.top, box.bottom - visible.bottom,
            visible.left - box.left, box.right - visible.right))
        })
        observer.observe(element)
      }))).toBeLessThanOrEqual(1)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await subject.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `${label} ${viewport.width}`)
    await page.screenshot({ path: test.info().outputPath(`${label}-${viewport.width}.png`) })
  }
}

async function captureLocalAcknowledgementAndActions(
  page: Page,
  acknowledgment: ReturnType<Page['getByRole']>,
  approve: ReturnType<Page['getByRole']>,
  label: string,
) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await acknowledgment.scrollIntoViewIfNeeded()
    await expect(acknowledgment).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`${label}-acknowledgment-${viewport.width}.png`) })
    await approve.scrollIntoViewIfNeeded()
    await expect(approve).toBeInViewport()
    await assertWcag22Aa(page, `${label} actions ${viewport.width}`)
    await page.screenshot({ path: test.info().outputPath(`${label}-actions-${viewport.width}.png`) })
  }
}

test('local Routine consent is separate, resets on Back, and owner history stays person-private', async ({ page, browser }) => {
  test.setTimeout(ms(150_000))
  const methods: string[] = []
  const bindingsSeen: unknown[] = []
  let failToolCall = false
  const stack = await startMcpRouterStack({ localProcessesAvailable: true,
    openStdio: () => localPeer(methods, 'Local fixture result', () => failToolCall),
    synchronizeStdioBindings: async bindings => { bindingsSeen.push(bindings); return { available: true } },
  })
  const contexts: BrowserContext[] = []
  const disposers = [await proxyMcpApi(page, stack)]
  const connectionIds: string[] = []
  let taskId = ''
  let peerId = ''
  let tenantId = ''
  try {
    await signIn(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const suffix = randomUUID().slice(0, 8)
    const org = await api(page, 'POST', '/orgs', { name: `Local Routine ${suffix}` })
    expect(org.status).toBe(201)
    tenantId = org.body.id as string
    await selectWorkspace(page, 'user-ada', tenantId)

    const peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
    contexts.push(peerContext)
    const peer = await peerContext.newPage()
    disposers.push(await proxyMcpApi(peer, stack))
    await peer.goto('/scheduled')
    const email = `local-routine-${suffix}@example.test`
    const signup = await api(peer, 'POST', '/auth/signup', { name: 'Local Routine peer', email, password: `local-routine-${suffix}-password` })
    expect(signup.status).toBe(200)
    peerId = signup.body.user.id as string
    const invite = await api(page, 'POST', `/orgs/${tenantId}/invites`, { email })
    expect(invite.status).toBe(201)
    expect((await api(peer, 'POST', `/me/invites/${invite.body.id}/accept`)).status).toBe(200)
    await selectWorkspace(peer, peerId, tenantId)

    const ownerConnection = seedLocalConnection(tenantId, 'user-ada', `Ada local catalog ${suffix}`)
    const peerConnection = seedLocalConnection(tenantId, peerId, `Peer local catalog ${suffix}`)
    connectionIds.push(ownerConnection.id, peerConnection.id)
    expect(await synchronizeMcpCredentials(store.mcpCredentialBindings(), store.mcpStdioBindings())).toBe('complete')
    expect(bindingsSeen.length).toBeGreaterThan(0)

    const routine = await createRoutine(page, suffix, tenantId)
    taskId = routine.id
    const path = `/scheduled/${taskId}/external-mcp`
    const sharedGrant = await api(page, 'POST', '/grants', { subject: { kind: 'schedule', id: taskId },
      audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' })
    expect(sharedGrant.status).toBe(200)
    await page.goto(path)
    const panel = page.getByRole('region', { name: 'External MCP', exact: true })
    await expect(panel.getByText('No unattended MCP tools', { exact: true })).toBeVisible()
    const review = await reviewLocalChoice(panel, ownerConnection.label)
    const acknowledgment = review.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })
    await expect(acknowledgment).toHaveAttribute('aria-checked', 'false')
    await expect(review).toContainText('This approval may launch the selected local program unattended')
    await expect(review).toContainText('normal access to this computer')
    await expect(review).toContainText('possible startup effects')
    await expect(review).toContainText('Agent Commons does not sandbox this program')
    const approve = review.getByRole('button', { name: 'Approve these tools', exact: true })
    await expect(approve).toBeDisabled()

    // Space is the native keyboard activation path for the independently
    // unchecked launch disclosure; Back starts a fresh review with no carryover.
    await acknowledgment.focus()
    await page.keyboard.press('Space')
    await expect(acknowledgment).toHaveAttribute('aria-checked', 'true')
    await expect(approve).toBeEnabled()
    await captureReview(page, review, 'routine-local-owner-review')
    await captureLocalAcknowledgementAndActions(page, acknowledgment, approve, 'routine-local-owner-review')
    await review.getByRole('button', { name: 'Back to choices', exact: true }).click()
    const freshReview = await reviewLocalChoice(panel, ownerConnection.label)
    const freshAcknowledgment = freshReview.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })
    await expect(freshAcknowledgment).toHaveAttribute('aria-checked', 'false')
    await expect(freshReview.getByRole('button', { name: 'Approve these tools', exact: true })).toBeDisabled()
    await freshAcknowledgment.check()
    await freshReview.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(panel.getByText('Approval active', { exact: true })).toBeVisible()
    await expect(panel).toContainText('includes local-program launch')
    const ownerReview = await api(page, 'GET', `/schedules/${taskId}/mcp-permission`)
    expect(ownerReview.status).toBe(200)
    expect(ownerReview.body.policy.approval.localPrograms).toBe(true)
    expect(ownerReview.body.tools).toContainEqual(expect.objectContaining({ connectionId: ownerConnection.id, transport: 'stdio' }))

    // The browser spec uses the store's bounded host execution seam against an
    // in-memory stdio peer. It never starts a user-selected program.
    const query = `owner-local-query-${suffix}`
    const run = store.runSchedule(taskId)!
    const receipt = await store.executeRoutineMcpCall(taskId, run.id, {
      connectionId: ownerConnection.id, connectionRevision: 1, toolName: tool.name,
      schemaHash: mcpToolSchemaHash(tool), arguments: { query },
    }, `local-browser-receipt-${suffix}`)
    expect(receipt.status).toBe('done')
    expect(receipt.transport).toBe('stdio')
    expect(methods).toContain('tools/call')
    store.failScheduleRun(taskId, run.id, 'execution_error', 'The browser receipt fixture has ended.')
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(panel.getByText(/Local program · inspect_local_records · Completed/)).toBeVisible()
    await expect(panel.getByRole('region', { name: 'Result for inspect_local_records', exact: true })).toContainText('Local fixture result')
    await expect(panel).toContainText('Personal OAuth or local-program receipts are visible only to their approver')
    await captureReview(page, panel.locator('li').filter({ hasText: 'Local program · inspect_local_records · Completed' }), 'routine-local-success-receipt', true)

    await peer.goto(path)
    const peerPanel = peer.getByRole('region', { name: 'External MCP', exact: true })
    await expect(peerPanel.getByText('Approved by another member', { exact: true })).toBeVisible()
    await expect(peerPanel).not.toContainText(ownerConnection.label)
    await expect(peerPanel).not.toContainText(query)
    await expect(peerPanel.getByRole('heading', { name: 'Private run receipts', exact: true })).toHaveCount(0)
    await expect(peerPanel).toContainText(peerConnection.label)
    const peerReview = await api(peer, 'GET', `/schedules/${taskId}/mcp-permission`)
    expect(peerReview.body.policy.approval).toBeNull()
    expect(peerReview.body.runs).toEqual([])
    expect(peerReview.body.tools.map((entry: { connectionId: string; transport?: string }) => [entry.connectionId, entry.transport]))
      .toEqual([[peerConnection.id, 'stdio']])
    expect(JSON.stringify(peerReview.body)).not.toContain(ownerConnection.id)
    await captureReview(peer, peerPanel, 'routine-local-peer-private')

    const createReaderPage = async () => {
      const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
      contexts.push(context)
      const reader = await context.newPage()
      disposers.push(await proxyMcpApi(reader, stack))
      return reader
    }
    const grace = await createReaderPage()
    await signIn(grace, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await grace.goto(`/scheduled/${taskId}`)
    await expect(grace.getByRole('heading', { name: routine.name, exact: true })).toBeVisible()
    await expect(grace.getByRole('button', { name: 'External MCP', exact: true })).toHaveCount(0)
    await expect(grace.getByRole('region', { name: 'External MCP', exact: true })).toHaveCount(0)
    expect((await api(grace, 'GET', `/schedules/${taskId}/mcp-permission`)).status).toBe(404)
    await captureReview(grace, grace.getByRole('main').first(), 'routine-local-shared-reader')

    const maya = await createReaderPage()
    await signIn(maya, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    await maya.goto(path)
    expect((await api(maya, 'GET', `/schedules/${taskId}/mcp-permission`)).status).toBe(404)
    await expect(maya.getByRole('region', { name: 'External MCP', exact: true })).toHaveCount(0)
    await expect(maya.getByRole('heading', { name: routine.name, exact: true })).toHaveCount(0)
    await captureReview(maya, maya.getByRole('main').first(), 'routine-local-foreign')

    failToolCall = true
    const failedRun = store.runSchedule(taskId)!
    const failedReceipt = await store.executeRoutineMcpCall(taskId, failedRun.id, {
      connectionId: ownerConnection.id, connectionRevision: 1, toolName: tool.name,
      schemaHash: mcpToolSchemaHash(tool), arguments: { query: `failed-local-query-${suffix}` },
    }, `local-browser-failure-${suffix}`)
    expect(failedReceipt.status).toBe('failed')
    expect(failedReceipt.transport).toBe('stdio')
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(panel).toContainText('The call failed. This reserved call still counts toward the run limit.')
    await expect(panel).toContainText('The local program may have had effects during startup, even without a tool result.')
    await expect(panel).toContainText('This attempt paused the Routine; review its receipts before re-enabling it and renewing approval.')
    await captureReview(page, panel.locator('li').filter({ hasText: 'This attempt paused the Routine' }), 'routine-local-failed-receipt', true)
  } finally {
    await Promise.all(disposers.map(dispose => dispose()))
    await Promise.all(contexts.map(context => context.close()))
    if (taskId) store.removeSchedule(taskId)
    for (const id of connectionIds) {
      const row = store.privateMcpConnection(id, tenantId, id === connectionIds[0] ? 'user-ada' : peerId)
      if (row) store.removeMcpConnection(row.id, tenantId, row.revision, row.ownerUserId)
    }
    await stack.close()
  }
})

test('web-shaped host does not expose a local Routine catalog or local approval control', async ({ page }) => {
  const stack = await startMcpRouterStack()
  const dispose = await proxyMcpApi(page, stack)
  let connectionId = ''
  let taskId = ''
  let tenantId = ''
  try {
    await signIn(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    // This catalog assertion belongs to a test-owned workspace. Earlier specs
    // may legitimately leave HTTP connections in Ada's seeded workspace.
    const org = await api(page, 'POST', '/orgs', { name: `Web local refusal ${randomUUID().slice(0, 8)}` })
    expect(org.status).toBe(201)
    tenantId = org.body.id as string
    await selectWorkspace(page, 'user-ada', tenantId)
    const local = seedLocalConnection(tenantId, 'user-ada', `Web-hidden local ${randomUUID().slice(0, 8)}`)
    connectionId = local.id
    const routine = await createRoutine(page, randomUUID().slice(0, 8), tenantId)
    taskId = routine.id
    const response = await api(page, 'GET', `/schedules/${taskId}/mcp-permission`)
    expect(response.status).toBe(200)
    expect(response.body.tools).toEqual([])
    expect(JSON.stringify(response.body)).not.toContain(connectionId)
    await page.goto(`/scheduled/${taskId}/external-mcp`)
    const panel = page.getByRole('region', { name: 'External MCP', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel).not.toContainText(local.label)
    await expect(panel.getByRole('button', { name: 'Review approval', exact: true })).toHaveCount(0)
    await expect(panel.getByText(/unattended local-program launch/)).toHaveCount(0)
  } finally {
    await dispose()
    if (taskId) store.removeSchedule(taskId)
    if (connectionId) {
      const row = store.privateMcpConnection(connectionId, tenantId, 'user-ada')
      if (row) store.removeMcpConnection(row.id, row.tenantId, row.revision, 'user-ada')
    }
    await stack.close()
  }
})
