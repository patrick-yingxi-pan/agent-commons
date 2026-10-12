/** Local stdio MCP Contributions use a real authored child behind the native
 * process seam, the shared router/store, and the rendered exact-call workflow. */
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { test, expect, type Browser, type Page, type TestInfo, type Locator } from '@playwright/test'
import type { McpStdioSetupStartRequest } from '../contract/mcpStdioSetup.ts'
import type { OpenSubGoal, Project } from '../contract/index.ts'
import { createMcpStdioSupervisor } from '../desktop/mcpStdioSupervisor.mjs'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpRouterStack, type McpRouterStack } from './mcp-fixture.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const LOCAL_DISCLOSURE = 'Local MCP process. The selected program runs with normal access to the connection owner’s computer and may have effects just by starting; this is not a sandbox. Each run uses only the reviewed tool and arguments. Arguments and saved results are visible to every Project reader; launch settings stay private.'
const PRIVATE_LAUNCH_PATH = '/fixture/private-local-program'
const PRIVATE_LAUNCH_SECRET = 'local-stdio-fixture-secret-never-http'

/** The child is repository-authored, has no network/filesystem access in its
 * protocol, and exits after each transaction. The supervisor still performs
 * the actual OS spawn, pipes, framing, cancellation, and cleanup. */
const AUTHORED_PEER = String.raw`
  import readline from 'node:readline';
  const input = readline.createInterface({ input: process.stdin });
  const modern = '2026-07-28';
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  input.on('line', line => {
    let row;
    try { row = JSON.parse(line); } catch { process.exit(21); }
    if (row.method === 'notifications/initialized') return;
    if (row.id === undefined) return;
    const result = value => send({ jsonrpc: '2.0', id: row.id, result: value });
    if (row.method === 'server/discover') return result({ resultType: 'complete', supportedVersions: [modern], capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Repository authored local write fixture', version: '1' } } });
    if (row.method === 'tools/list') return result({ resultType: 'complete', tools: [{
      name: 'write_record', description: 'Write one isolated fixture record.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 256 } }, required: ['query'], additionalProperties: false }
    }] });
    if (row.method === 'tools/call') {
      if (process.env.PEER_MODE === 'uncertain') process.exit(9);
      const args = row.params?.arguments ?? {};
      return result({ resultType: 'complete', isError: false,
        content: [{ type: 'text', text: 'Saved local fixture result: ' + String(args.query ?? '') }],
        structuredContent: { accepted: true, query: args.query ?? null } });
    }
    send({ jsonrpc: '2.0', id: row.id, error: { code: -32601, message: 'unsupported fixture method' } });
  });
`

type NativeFixture = {
  stack: McpRouterStack
  close(): Promise<void>
  toolCalls: Array<{ name: string; arguments: unknown }>
  opens: Array<{ reference: string; tenantId: string; ownerUserId: string; connectionId: string; revision: number; purpose: string }>
  protocolCalls: string[]
  bridge(page: Page): Promise<{ calls: Array<{ method: string; request: unknown }>; launches: McpStdioSetupStartRequest[] }>
}

async function startNativeFixture(mode: 'success' | 'uncertain' = 'success'): Promise<NativeFixture> {
  const supervisor = createMcpStdioSupervisor()
  const toolCalls: NativeFixture['toolCalls'] = []
  const opens: NativeFixture['opens'] = []
  const protocolCalls: string[] = []
  let grantReference = ''
  const stack = await startMcpRouterStack({
    localProcessesAvailable: true,
    synchronizeStdioBindings: async () => ({ available: true }),
    openStdio: (reference, binding, options) => {
      opens.push({ reference, tenantId: binding.tenantId, ownerUserId: binding.ownerUserId,
        connectionId: binding.connectionId, revision: binding.connectionRevision, purpose: options.purpose })
      if (grantReference && reference !== grantReference) throw new Error('fixture grant mismatch')
      const child = supervisor.open({ executable: process.execPath, args: ['--input-type=module', '-e', AUTHORED_PEER],
        cwd: tmpdir(), env: { PEER_MODE: mode === 'uncertain' && options.purpose === 'call' ? 'uncertain' : 'success' } }, options)
      const request = child.request.bind(child)
      return {
        ...child,
        request: async (method, params, requestOptions) => {
          protocolCalls.push(method)
          if (method === 'tools/call') {
            toolCalls.push({ name: String(params.name ?? ''), arguments: structuredClone(params.arguments) })
          }
          return request(method, params, requestOptions)
        },
      }
    },
  })
  return {
    stack,
    toolCalls,
    opens,
    protocolCalls,
    close: async () => { try { await stack.close() } finally { await supervisor.dispose() } },
    bridge: async (page) => {
      const calls: Array<{ method: string; request: unknown }> = []
      const launches: McpStdioSetupStartRequest[] = []
      let flowId = ''
      let prepared: McpStdioSetupStartRequest | undefined
      let operationId = ''
      grantReference = `MCP_STDIO_${randomUUID().replaceAll('-', '').toUpperCase()}`
      await page.exposeFunction('contributionStdioFixtureCall', async (method: string, request: McpStdioSetupStartRequest | { flowId: string }) => {
        calls.push({ method, request: structuredClone(request) })
        if (method === 'start') {
          prepared = request as McpStdioSetupStartRequest
          launches.push(structuredClone(prepared))
          flowId = `contribution-stdio-flow-${randomUUID()}`
          operationId = `contribution-stdio-inspect-${randomUUID()}`
          return { flowId, connectionId: prepared.connectionId, revision: prepared.expectedRevision, status: 'ready' }
        }
        if (!prepared || request.flowId !== flowId) throw new Error('Unexpected stdio flow handle')
        if (method === 'authorize') {
          const headers = { 'x-account-transition-source': `session:${prepared.source.userId}` }
          const response = await page.request.post(`${stack.url}${API}/mcp-connections/${prepared.connectionId}/inspect`, {
            headers, data: { operationId, expectedRevision: prepared.expectedRevision, grantReference },
          })
          const body = await response.json().catch(() => ({})) as { connection?: { revision?: number }; error?: unknown }
          if (response.status() !== 200 || !body.connection) throw new Error(`Local inspection was not acknowledged: ${JSON.stringify(body)}`)
          return { flowId, connectionId: prepared.connectionId, revision: body.connection.revision!, status: 'connected' }
        }
        if (method === 'cancel') return { flowId, connectionId: prepared.connectionId, revision: prepared.expectedRevision, status: 'cancelled' }
        throw new Error(`Unexpected fixture bridge method ${method}`)
      })
      await page.addInitScript(() => {
        type BridgeWindow = Window & { contributionStdioFixtureCall: (method: string, request: unknown) => Promise<unknown>; agentCommonsDesktop?: Record<string, unknown> }
        const target = window as BridgeWindow
        target.agentCommonsDesktop = { ...target.agentCommonsDesktop,
          mcpStdio: Object.fromEntries(['start', 'authorize', 'reconcile', 'cancel'].map(method => [method,
            (request: unknown) => target.contributionStdioFixtureCall(method, request)])) }
      })
      return { calls, launches }
    },
  }
}

async function postJson(page: Page, path: string, body?: Record<string, unknown>) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() as Record<string, any> }
  }, { path, body })
}

async function getJson(page: Page, path: string) {
  return page.evaluate(async path => {
    const response = await fetch(path)
    return { status: response.status, body: await response.json() as Record<string, any> }
  }, path)
}

async function installEventFixture(page: Page) {
  await page.addInitScript(() => {
    const Native = window.EventSource
    type EventWindow = Window & { __emitStdioContributionEvent?: (event: unknown) => void; __stdioContributionSource?: EventSource }
    const target = window as EventWindow
    class FixtureSource extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        target.__stdioContributionSource = this
      }
    }
    window.EventSource = FixtureSource
    target.__emitStdioContributionEvent = event => {
      if (!target.__stdioContributionSource) throw new Error('The local contribution event source has not connected.')
      target.__stdioContributionSource.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
    }
  })
}

async function signInSeed(page: Page, email: string, password: string, userId: string) {
  await page.goto('/contexts')
  const login = await page.evaluate(async ({ email, password, api }) => {
    const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }) })
    return { status: response.status, body: await response.json() as { user?: { id?: string } } }
  }, { email, password, api: API })
  expect(login.status).toBe(200)
  expect(login.body.user?.id).toBe(userId)
  await page.reload()
  await expect.poll(async () => page.evaluate(async api => (await (await fetch(`${api}/me`)).json()).user?.id, API)).toBe(userId)
}

async function setSignedTenant(page: Page, userId: string, tenantId: string) {
  const origin = new URL(page.url()).origin
  await page.context().addCookies([{ name: SESSION_COOKIE, value: signSession({ userId, tenantId, iat: Date.now() }),
    url: origin, httpOnly: true, sameSite: 'Lax' }])
  await page.reload()
  const identity = await page.evaluate(async api => await (await fetch(`${api}/me`)).json() as { via?: string; user?: { id?: string }; tenant?: { id?: string } }, API)
  expect(identity).toMatchObject({ via: 'session', user: { id: userId }, tenant: { id: tenantId } })
}

async function createWorkspace(page: Page, browser: Browser, stack: McpRouterStack, stamp: string) {
  await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
  const made = await postJson(page, `${API}/orgs`, { name: `Local MCP workspace ${stamp}` })
  expect(made.status).toBe(201, JSON.stringify(made.body))
  const tenantId = made.body.id as string
  await setSignedTenant(page, 'user-ada', tenantId)

  const appOrigin = new URL(page.url()).origin
  const peerContext = await browser.newContext({ baseURL: appOrigin })
  const peer = await peerContext.newPage()
  const peerDispose = await proxyMcpApi(peer, stack)
  await peer.goto('/contexts')
  const peerSignup = await postJson(peer, `${API}/auth/signup`, {
    name: `Local MCP peer ${stamp}`, email: `local-mcp-peer-${stamp}@example.test`, password: `local-mcp-peer-${stamp}-password`,
  })
  expect(peerSignup.status).toBe(200, JSON.stringify(peerSignup.body))
  const peerUserId = peerSignup.body.user.id as string
  const invite = await postJson(page, `${API}/orgs/${tenantId}/invites`, { email: `local-mcp-peer-${stamp}@example.test` })
  expect(invite.status).toBe(201, JSON.stringify(invite.body))
  const accepted = await postJson(peer, `${API}/me/invites/${invite.body.id}/accept`)
  expect(accepted.status).toBe(200, JSON.stringify(accepted.body))
  await setSignedTenant(peer, peerUserId, tenantId)
  return { tenantId, peerContext, peer, peerDispose }
}

async function createLocalConnection(page: Page, label: string) {
  await page.goto('/contexts')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
  const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
  await create.getByLabel('Name', { exact: true }).fill(label)
  await create.getByLabel('Transport').selectOption('stdio')
  await expect(create.getByLabel('Server URL')).toHaveCount(0)
  await expect(create.getByLabel('Authentication')).toHaveCount(0)
  await create.getByRole('button', { name: 'Save server', exact: true }).click()
  const row = page.getByRole('main').getByRole('button', { name: label, exact: true })
  await expect(row).toBeVisible({ timeout: ms(15_000) })
  await row.click()
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  const connectionPath = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Configure ${label}`, exact: true })
  await dialog.getByLabel('Executable path', { exact: true }).fill(PRIVATE_LAUNCH_PATH)
  await dialog.getByLabel('Working directory', { exact: true }).fill('/fixture/private-working-directory')
  await dialog.getByRole('textbox', { name: 'Arguments (JSON array)', exact: true }).fill(JSON.stringify(['--test-owned', 'literal $(not-a-shell)']))
  await dialog.getByRole('textbox', { name: 'Environment (JSON object)', exact: true }).fill(JSON.stringify({ LOCAL_FIXTURE_SECRET: PRIVATE_LAUNCH_SECRET }))
  await dialog.getByRole('button', { name: 'Review & inspect', exact: true }).click()
  await expect(dialog.locator('[data-mcp-stdio-phase="connected"]')).toBeVisible({ timeout: ms(20_000) })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const connectionId = connectionPath.split('/').at(-1)!
  return { connectionId, connectionPath }
}

async function ownedLinkedContribution(page: Page, stamp: string) {
  const created = await postJson(page, `${API}/projects`, {
    name: `Local stdio work ${stamp}`, description: 'An explicitly reviewed local contribution write.',
  })
  expect(created.status).toBe(201, JSON.stringify(created.body))
  const project = created.body.project as Project
  const work = await postJson(page, `${API}/projects/${project.id}/open-subgoals`, {
    subGoal: `Save local record ${stamp}`, type: 'mcp.mutate', target: 'write_record', note: 'Resolve only after a saved successful result.',
  })
  expect(work.status).toBe(200, JSON.stringify(work.body))
  const item = work.body as OpenSubGoal
  const contribution = await postJson(page, `${API}/projects/${project.id}/contributions`, {
    title: `Local MCP contribution ${stamp}`, summary: 'One exact local tool call, reviewed separately.', workItemId: item.id,
  })
  expect(contribution.status).toBe(200, JSON.stringify(contribution.body))
  expect(contribution.body.workItemResolution).toBe('needs-result')
  return { project, item, contribution: contribution.body as { id: string },
    route: `/projects/${project.id}/changes/${contribution.body.id}` }
}

async function captureFive(page: Page, info: TestInfo, subject: Locator, stem: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await subject.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { width: element.clientWidth, scrollWidth: element.scrollWidth, left: rect.left, right: rect.right }
    })
    expect(box.scrollWidth, `${stem} content remains contained at ${viewport.width}px`).toBeLessThanOrEqual(box.width)
    expect(box.left).toBeGreaterThanOrEqual(-1)
    expect(box.right).toBeLessThanOrEqual(viewport.width + 1)
    await assertWcag22Aa(page, `${stem} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${stem}-${viewport.width}x${viewport.height}.png`) })
  }
}

async function createProposal(page: Page, connectionLabel: string, query: string) {
  await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
  await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
  await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: `${connectionLabel} · write_record` })
  const args = { query }
  await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify(args))
  await page.getByLabel('Max acts 1', { exact: true }).fill('1')
  return args
}

test('owner completes one exact local stdio Contribution and linked work result; workspace peers and readers stay read-only', async ({ page, browser }, info) => {
  test.setTimeout(ms(180_000))
  const native = await startNativeFixture()
  const dispose = await proxyMcpApi(page, native.stack)
  const stamp = randomUUID().slice(0, 8)
  const label = `Local process ${stamp}`
  const rendererBodies: string[] = []
  let peerContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let peerDispose: (() => Promise<void>) | undefined
  let readerContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let readerDispose: (() => Promise<void>) | undefined
  let foreignContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let foreignDispose: (() => Promise<void>) | undefined
  try {
    page.on('request', request => {
      if (request.resourceType() === 'fetch' && request.url().includes('/api/v1/') && request.postData()) rendererBodies.push(request.postData()!)
    })
    const workspace = await createWorkspace(page, browser, native.stack, stamp)
    peerContext = workspace.peerContext
    peerDispose = workspace.peerDispose
    const bridge = await native.bridge(page)
    const connection = await createLocalConnection(page, label)
    expect(bridge.calls.map(row => row.method)).toEqual(['start', 'authorize'])
    expect(bridge.launches).toHaveLength(1)
    expect(bridge.launches[0]?.launch).toMatchObject({ executable: PRIVATE_LAUNCH_PATH, cwd: '/fixture/private-working-directory', env: { LOCAL_FIXTURE_SECRET: PRIVATE_LAUNCH_SECRET } })
    expect(native.protocolCalls).toEqual(['server/discover', 'tools/list'])
    expect(native.toolCalls).toEqual([])
    expect(native.opens).toHaveLength(1)
    expect(native.opens[0]).toMatchObject({ tenantId: workspace.tenantId, ownerUserId: 'user-ada', connectionId: connection.connectionId, purpose: 'inspect' })
    const savedConnections = await getJson(page, `${API}/mcp-connections`)
    const publicConnection = (savedConnections.body as any).connections.find((row: any) => row.id === connection.connectionId)
    expect(publicConnection).toMatchObject({ transport: 'stdio', status: 'connected' })
    expect(JSON.stringify(publicConnection)).not.toMatch(/MCP_STDIO_|grantReference|ownerUserId|private-local-program|private-working-directory|local-stdio-fixture-secret/)
    const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
    expect(browserStorage).not.toContain(PRIVATE_LAUNCH_SECRET)
    expect(browserStorage).not.toContain(PRIVATE_LAUNCH_PATH)

    const arena = await ownedLinkedContribution(page, stamp)
    const grant = await postJson(page, `${API}/grants`, {
      subject: { kind: 'project', id: arena.project.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
    })
    expect(grant.status).toBe(200, JSON.stringify(grant.body))
    await page.goto(arena.route)
    const query = `exact local write ${stamp}`
    const args = await createProposal(page, label, query)
    const selectedDisclosure = page.locator('[data-contribution-stdio-disclosure="proposal"]').first()
    await expect(selectedDisclosure).toHaveText(LOCAL_DISCLOSURE)
    await captureFive(page, info, selectedDisclosure, 'stdio-contribution-proposal')
    expect(native.toolCalls).toEqual([])

    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    const envelope = page.locator('[data-contribution-envelope-version="1"]')
    await expect(envelope).toContainText(query)
    const savedBeforeRun = await getJson(page, `${API}/projects/${arena.project.id}/contributions`)
    expect(savedBeforeRun.status).toBe(200)
    const contributionBeforeRun = (savedBeforeRun.body as any[]).find(row => row.id === arena.contribution.id)
    const lineBeforeRun = contributionBeforeRun?.envelope?.lines?.find((line: any) => line.type === 'mcp.mutate')
    expect(lineBeforeRun?.mcp?.transport).toBe('stdio')
    expect(JSON.stringify(contributionBeforeRun)).not.toMatch(/MCP_STDIO_|grantReference|ownerUserId|private-local-program|private-working-directory|local-stdio-fixture-secret/)
    await envelope.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeEnabled()
    const ownerApproved = await getJson(page, `${API}/projects/${arena.project.id}/contributions`)
    const ownerApprovedContribution = (ownerApproved.body as any[]).find(row => row.id === arena.contribution.id)
    expect(ownerApprovedContribution?.envelope?.lines?.find((line: any) => line.type === 'mcp.mutate')?.mcp?.canRun).toBe(true)

    const appOrigin = new URL(page.url()).origin
    readerContext = await browser.newContext({ baseURL: appOrigin })
    const reader = await readerContext.newPage()
    readerDispose = await proxyMcpApi(reader, native.stack)
    await signInSeed(reader, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await reader.goto(arena.route)
    await expect(reader.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    const readerApproved = await getJson(reader, `${API}/projects/${arena.project.id}/contributions`)
    const readerApprovedContribution = (readerApproved.body as any[]).find(row => row.id === arena.contribution.id)
    expect(readerApprovedContribution?.envelope?.lines?.find((line: any) => line.type === 'mcp.mutate')?.mcp?.canRun).toBeUndefined()
    await captureFive(reader, info, reader.locator('[data-contribution-envelope-version="1"]'), 'stdio-contribution-granted-reader-unused')

    await workspace.peer.goto(arena.route)
    await expect(workspace.peer.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(workspace.peer.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    const peerApproved = await getJson(workspace.peer, `${API}/projects/${arena.project.id}/contributions`)
    const peerApprovedContribution = (peerApproved.body as any[]).find(row => row.id === arena.contribution.id)
    expect(peerApprovedContribution?.envelope?.lines?.find((line: any) => line.type === 'mcp.mutate')?.mcp?.canRun).toBeUndefined()
    await captureFive(workspace.peer, info, workspace.peer.locator('[data-contribution-envelope-version="1"]'), 'stdio-contribution-workspace-peer-unused')

    await page.bringToFront()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const confirmation = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    const confirmationDisclosure = confirmation.locator('[data-contribution-stdio-disclosure="confirmation"]')
    await expect(confirmationDisclosure).toHaveText(LOCAL_DISCLOSURE)
    await captureFive(page, info, confirmation, 'stdio-contribution-confirmation')
    expect(native.toolCalls).toEqual([])
    await confirmation.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    const receipt = page.locator('[data-contribution-effect-status="done"]').first()
    await expect(receipt).toContainText(`Saved local fixture result: ${query}`)
    await expect(receipt.locator('[data-contribution-stdio-disclosure="receipt"]')).toHaveText(LOCAL_DISCLOSURE)
    expect(native.toolCalls).toEqual([{ name: 'write_record', arguments: args }])
    expect(native.opens.filter(open => open.purpose === 'call')).toHaveLength(1)
    expect(native.opens.every(open => open.tenantId === workspace.tenantId && open.ownerUserId === 'user-ada' && open.connectionId === connection.connectionId)).toBe(true)
    await captureFive(page, info, receipt, 'stdio-contribution-saved-receipt')

    const afterRun = await getJson(page, `${API}/projects/${arena.project.id}/contributions`)
    const publicContribution = (afterRun.body as any[]).find(row => row.id === arena.contribution.id)
    expect(publicContribution.effects?.[0]?.transport).toBe('stdio')
    expect(JSON.stringify(publicContribution)).not.toMatch(/MCP_STDIO_|grantReference|ownerUserId|private-local-program|private-working-directory|local-stdio-fixture-secret/)

    await reader.goto(arena.route)
    const readerReceipt = reader.locator('[data-contribution-effect-status="done"]').first()
    await expect(readerReceipt).toContainText(`Saved local fixture result: ${query}`)
    await expect(readerReceipt.locator('[data-contribution-stdio-disclosure="receipt"]')).toHaveText(LOCAL_DISCLOSURE)
    await expect(reader.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)

    await workspace.peer.goto(arena.route)
    const peerReceipt = workspace.peer.locator('[data-contribution-effect-status="done"]').first()
    await expect(peerReceipt).toContainText(`Saved local fixture result: ${query}`)
    await expect(workspace.peer.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(workspace.peer.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)

    foreignContext = await browser.newContext({ baseURL: appOrigin })
    const foreign = await foreignContext.newPage()
    foreignDispose = await proxyMcpApi(foreign, native.stack)
    await signInSeed(foreign, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    await foreign.goto(arena.route)
    const wall = foreign.locator('[data-resource-unavailable="missing"]')
    await expect(wall).toBeVisible()
    await expect(wall).toContainText('This project isn’t visible from this account')
    await expect(foreign.locator('[data-contribution-effect-status]')).toHaveCount(0)
    await expect(foreign.getByRole('main')).not.toContainText(query)
    await captureFive(foreign, info, wall, 'stdio-contribution-foreign-wall')

    await page.getByRole('button', { name: 'Land and resolve work', exact: true }).click()
    await expect(page.getByRole('main').getByText(/Landed · L\d+/).first()).toBeVisible()
    const workList = await getJson(page, `${API}/projects/${arena.project.id}/open-subgoals`)
    expect(workList.status).toBe(200)
    expect((workList.body as OpenSubGoal[]).find(row => row.id === arena.item.id)?.status).toBe('done')
    const finalList = await getJson(page, `${API}/projects/${arena.project.id}/contributions`)
    const finalContribution = (finalList.body as any[]).find(row => row.id === arena.contribution.id)
    expect(finalContribution.status).toBe('landed')
    expect(finalContribution.workItemResolution).toBe('closed')
    await page.goto(`/projects/${arena.project.id}/work/${arena.item.id}`)
    await expect(page.getByText('Landed and resolved this work item', { exact: false })).toBeVisible()
    await captureFive(page, info, page.locator('[data-resource-page]'), 'stdio-contribution-resolved-work')
    expect(native.toolCalls).toHaveLength(1, 'landing and every reader projection never repeat the local MCP action')
    expect(rendererBodies.join('\n')).not.toMatch(/MCP_STDIO_|grantReference|ownerUserId|private-local-program|private-working-directory|local-stdio-fixture-secret/)
  } finally {
    await foreignDispose?.(); await readerDispose?.(); await peerDispose?.(); await dispose()
    await foreignContext?.close(); await readerContext?.close(); await peerContext?.close()
    await native.close()
  }
})

test('disconnect removes a live local Run confirmation before any child dispatch', async ({ page, browser }, info) => {
  test.setTimeout(ms(100_000))
  const native = await startNativeFixture()
  const dispose = await proxyMcpApi(page, native.stack)
  const stamp = randomUUID().slice(0, 8)
  let peerContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let peerDispose: (() => Promise<void>) | undefined
  try {
    await installEventFixture(page)
    const workspace = await createWorkspace(page, browser, native.stack, `disconnect-${stamp}`)
    peerContext = workspace.peerContext
    peerDispose = workspace.peerDispose
    const bridge = await native.bridge(page)
    const connection = await createLocalConnection(page, `Disconnect local ${stamp}`)
    expect(bridge.calls.map(row => row.method)).toEqual(['start', 'authorize'])
    expect(native.opens[0]).toMatchObject({ tenantId: workspace.tenantId, ownerUserId: 'user-ada', connectionId: connection.connectionId, purpose: 'inspect' })
    const created = await postJson(page, `${API}/projects`, { name: `Disconnect Project ${stamp}`, description: 'Withdraw Run before dispatch.' })
    expect(created.status).toBe(201)
    const project = created.body.project as Project
    const contribution = await postJson(page, `${API}/projects/${project.id}/contributions`, { title: `No local dispatch ${stamp}`, summary: 'Disconnect before confirmation.' })
    expect(contribution.status).toBe(200)
    const route = `/projects/${project.id}/changes/${contribution.body.id}`
    await page.goto(route)
    await createProposal(page, `Disconnect local ${stamp}`, `must-not-run-${stamp}`)
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    const envelope = page.locator('[data-contribution-envelope-version="1"]')
    await envelope.getByRole('button', { name: 'Approve', exact: true }).click()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __stdioContributionSource?: EventSource }).__stdioContributionSource))).toBe(true)

    const current = await getJson(page, `${API}/mcp-connections/${connection.connectionId}`)
    const disconnected = await postJson(page, `${API}/mcp-connections/${connection.connectionId}/disconnect`, { expectedRevision: current.body.revision })
    expect(disconnected.status).toBe(200, JSON.stringify(disconnected.body))
    // Deliver the same saved lifecycle event used by the real client subscription;
    // this checks revocation of the already-open confirmation, not only a reload.
    await page.evaluate(({ id, tenantId }) => {
      const target = window as Window & { __emitStdioContributionEvent?: (event: unknown) => void }
      if (!target.__emitStdioContributionEvent) throw new Error('The local contribution event source is missing.')
      target.__emitStdioContributionEvent({ type: 'connector.status', id, tenantId, ownerUserId: 'user-ada', status: 'needs-auth' })
    }, { id: connection.connectionId, tenantId: workspace.tenantId })
    await expect(page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    expect(native.toolCalls).toEqual([])
    expect(native.opens.filter(open => open.purpose === 'call')).toHaveLength(0)
    await captureFive(page, info, envelope, 'stdio-contribution-disconnected')
  } finally {
    await peerDispose?.(); await dispose(); await peerContext?.close(); await native.close()
  }
})

test('a lost acknowledgement retains an uncertain local receipt without replay or linked-work resolution', async ({ page, browser }, info) => {
  test.setTimeout(ms(150_000))
  const native = await startNativeFixture('uncertain')
  const dispose = await proxyMcpApi(page, native.stack)
  const stamp = randomUUID().slice(0, 8)
  let peerContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let peerDispose: (() => Promise<void>) | undefined
  let postCount = 0
  try {
    const workspace = await createWorkspace(page, browser, native.stack, `uncertain-${stamp}`)
    peerContext = workspace.peerContext
    peerDispose = workspace.peerDispose
    const bridge = await native.bridge(page)
    const label = `Uncertain local ${stamp}`
    const connection = await createLocalConnection(page, label)
    expect(bridge.calls.map(row => row.method)).toEqual(['start', 'authorize'])
    expect(native.opens[0]).toMatchObject({ tenantId: workspace.tenantId, ownerUserId: 'user-ada', connectionId: connection.connectionId, purpose: 'inspect' })
    const arena = await ownedLinkedContribution(page, `uncertain-${stamp}`)
    await page.goto(arena.route)
    const query = `may-have-run-${stamp}`
    await createProposal(page, label, query)
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    const envelope = page.locator('[data-contribution-envelope-version="1"]')
    await envelope.getByRole('button', { name: 'Approve', exact: true }).click()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const confirmation = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(confirmation.locator('[data-contribution-stdio-disclosure="confirmation"]')).toHaveText(LOCAL_DISCLOSURE)
    let underlying: unknown
    let runAcknowledgementDropped = false
    await page.route(`**${API}/projects/${arena.project.id}/contributions/${arena.contribution.id}/effects`, async route => {
      if (route.request().method() !== 'POST') { await route.fallback(); return }
      postCount += 1
      const url = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${native.stack.url}${url.pathname}${url.search}`, headers })
      expect(response.status()).toBe(200)
      underlying = await response.json()
      runAcknowledgementDropped = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Fixture dropped the run acknowledgement.' } }) })
    })
    let holdReceiptReads = true
    let receiptReads = 0
    await page.route(`**${API}/projects/${arena.project.id}/contributions`, async route => {
      if (route.request().method() !== 'GET') { await route.fallback(); return }
      if (!runAcknowledgementDropped) { await route.fallback(); return }
      receiptReads += 1
      if (holdReceiptReads) {
        // The submit path must first settle as uncertain rather than learning
        // the receipt from its automatic GET. The user then chooses Check.
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Fixture delays exact receipt reconciliation until explicit Check.' } }) })
        return
      }
      const url = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${native.stack.url}${url.pathname}${url.search}`, headers })
      await route.fulfill({ response })
    })
    await confirmation.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    const held = page.locator('[data-contribution-mcp-attempt="uncertain"]')
    await expect(held.getByRole('button', { name: 'Check saved receipt', exact: true })).toBeVisible()
    expect(receiptReads).toBeGreaterThanOrEqual(1)
    expect(postCount).toBe(1)
    expect(native.toolCalls).toEqual([{ name: 'write_record', arguments: { query } }])
    expect(JSON.stringify(underlying)).toContain('uncertain')
    await captureFive(page, info, held, 'stdio-contribution-uncertain-held')
    const readsBeforeCheck = receiptReads
    holdReceiptReads = false
    await held.getByRole('button', { name: 'Check saved receipt', exact: true }).click()
    await expect.poll(() => receiptReads).toBeGreaterThan(readsBeforeCheck)
    const receipt = page.locator('[data-contribution-effect-status="uncertain"]').first()
    await expect(receipt).toBeVisible()
    await expect(receipt.locator('[data-contribution-stdio-disclosure="receipt"]')).toHaveText(LOCAL_DISCLOSURE)
    await expect(page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeDisabled()
    const work = await getJson(page, `${API}/projects/${arena.project.id}/open-subgoals`)
    expect((work.body as OpenSubGoal[]).find(row => row.id === arena.item.id)?.status).toBe('open')
    await captureFive(page, info, receipt, 'stdio-contribution-uncertain-receipt')

    const saved = await getJson(page, `${API}/projects/${arena.project.id}/contributions`)
    const contribution = (saved.body as any[]).find(row => row.id === arena.contribution.id)
    expect(contribution.effects?.[0]?.transport).toBe('stdio')
    expect(contribution.effects?.[0]?.status).toBe('uncertain')
    await page.reload()
    const persisted = page.locator('[data-contribution-effect-status="uncertain"]').first()
    await expect(persisted).toBeVisible()
    await expect(persisted).toContainText(query)
    await expect(persisted.locator('[data-contribution-stdio-disclosure="receipt"]')).toHaveText(LOCAL_DISCLOSURE)
    expect(postCount).toBe(1)
    expect(native.toolCalls).toHaveLength(1)
    expect(native.opens.filter(open => open.purpose === 'call')).toHaveLength(1)
    const finalWork = await getJson(page, `${API}/projects/${arena.project.id}/open-subgoals`)
    expect((finalWork.body as OpenSubGoal[]).find(row => row.id === arena.item.id)?.status).toBe('open')
  } finally {
    await peerDispose?.(); await dispose(); await peerContext?.close(); await native.close()
  }
})
