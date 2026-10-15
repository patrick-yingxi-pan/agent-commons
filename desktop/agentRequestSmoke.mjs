/** Packaged private Agent Requests acceptance. The signed accounts, renderer,
 * server routes, stdio supervisor and SQLite are real. Only the isolated copy's
 * exact native setup decisions are fixture-approved. The repository-authored
 * peer is deterministic and makes no network calls; it still runs as a normal OS
 * process, so the renderer's separate unchecked local-program consent matters. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { DEFAULT_PROVIDER_ID } from '../contract/providers.ts'
import { launchPackagedDesktop, closePackagedDesktop } from './smoke.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { createMcpFixturePackage } from './mcpLoopbackSmokePackage.mjs'
import { mcpStdioSmokePatches } from './mcpStdioSmoke.mjs'
import { MCP_STDIO_GRANT_FILE } from './mcpStdioGrantVault.mjs'
import { AUTH_ROOT_FILE } from './authRoot.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WAIT = 30_000
const PEER = join(ROOT, 'desktop', 'mcpStdioSmokePeer.mjs')
const GATE = 'AC_MCP_STDIO_FIXTURE_ALLOW'
const ENV_KEYS = ['DATA_FILE', 'DATABASE_PATH', GATE, 'AC_MCP_STDIO_FIXTURE_EXECUTABLE',
  'AC_MCP_STDIO_FIXTURE_CWD', 'AC_MCP_STDIO_FIXTURE_ARGS', 'AC_MCP_STDIO_FIXTURE_ENV']
const SECRET = 'Local fixture result for: agent-request-smoke-success'
const REPLY = 'The owner reviewed the local lookup and confirms the requested record is available.'
const MODEL = 'agent-request-authored-model'

/** Local-only model peer; a captured request is the proof of an actual Messages
 * call. The interrupted branch intentionally never sends a model response. */
async function startArgumentModel() {
  const requests = [], sockets = new Set()
  const server = createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method === 'GET' && req.url === '/v1/models') return json(200, { data: [{ id: MODEL, display_name: MODEL }] })
    if (req.method !== 'POST' || req.url !== '/v1/messages') return json(404, {})
    const chunks = []; let size = 0
    try {
      for await (const chunk of req) {
        size += chunk.length
        if (size > 256 * 1024) { json(413, {}); req.resume(); return }
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const probe = body.tools?.some(tool => tool.name === 'probe_noop')
      if (!probe) {
        assert.equal(body.tools, undefined)
        assert.equal(body.model, MODEL)
        assert.match(body.system, /You draft arguments for one owner-reviewed Agent request/)
        assert.equal(body.messages.length, 1)
        assert.equal(body.messages[0].role, 'user')
        assert.equal(JSON.stringify(body).includes(SECRET), false, 'private results never enter drafting input')
        requests.push(body)
        if (body.messages[0].content.includes('hold-model-until-relaunch')) return
      }
      json(200, { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: MODEL,
        content: [{ type: 'text', text: probe ? 'ok' : JSON.stringify({ toolName: 'records.search', arguments: { query: 'agent-request-smoke-success' } }) }],
        stop_reason: 'end_turn', usage: { input_tokens: 17, output_tokens: 9 } })
    } catch { if (!res.destroyed) json(400, { error: { type: 'invalid_request_error', message: 'Invalid authored fixture request' } }) }
  })
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { origin: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy() }) }
}

async function api(page, path, body, { method = body === undefined ? 'GET' : 'POST', status = 200, key = randomUUID() } = {}) {
  const response = await page.evaluate(async ({ path, body, method, key }) => {
    const result = await fetch(`/api/v1${path}`, { method,
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: result.status, body: await result.json() }
  }, { path, body, method, key })
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(response.body)}`)
  return response.body
}

function storedRequest(profile, id) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    // StoredProxyRequest anchors its id at intent.id, not row.id, so the generic
    // entity_id index is intentionally null for this slice.
    const rows = database.prepare('SELECT json FROM entities WHERE slice = ?').all('agentRequests')
    const row = rows.map(value => JSON.parse(value.json)).find(value => value?.intent?.id === id)
    assert.ok(row, 'the exact private Agent request is committed in SQLite')
    return row
  } finally { database.close() }
}

function traceRows(text) { return text.split('\n').filter(Boolean).map(line => JSON.parse(line)) }
async function peerTrace(path) {
  try { return traceRows(await readFile(path, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error }
}
const toolCalls = rows => rows.filter(row => row.kind === 'request' && row.method === 'tools/call')
const processStarts = rows => rows.filter(row => row.kind === 'process-start')

async function switchAccount(page, origin, userId, expectedName) {
  await api(page, '/auth/session', { userId })
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText(expectedName, { timeout: WAIT })
}

async function creationDefaults(page) {
  const providers = await api(page, '/providers')
  const prompts = await api(page, '/system-prompts')
  const provider = providers.find(row => row.isDefault) ?? providers.find(row => row.id === DEFAULT_PROVIDER_ID) ?? providers[0]
  const prompt = prompts.find(row => row.isDefault) ?? prompts[0]
  assert.ok(provider?.id, 'the clean profile exposes an actual Agent provider')
  assert.ok(prompt?.id, 'the clean profile exposes an actual Agent prompt')
  return { providerId: provider.id, systemPromptId: prompt.id }
}

async function createAgent(page, label, authority, providerId) {
  const defaults = await creationDefaults(page)
  return api(page, '/agents', {
    label, ...defaults, ...(providerId ? { providerId } : {}), tools: [], instructions: '',
    ...(authority ? { authority } : {}),
  })
}

async function createRequestThroughUi(page, origin, fromAgentId, toAgentId, task) {
  await page.goto(`${origin}/agents/requests`)
  const from = page.getByLabel('Your Agent', { exact: true })
  const to = page.getByLabel('Receiving Agent', { exact: true })
  await expect(from).toBeVisible({ timeout: WAIT })
  await expect(to).toBeVisible({ timeout: WAIT })
  await expect.poll(async () => from.locator('option').evaluateAll(options => options.map(option => option.value)),
    { timeout: WAIT }).toContain(fromAgentId)
  await expect.poll(async () => to.locator('option').evaluateAll(options => options.map(option => option.value)),
    { timeout: WAIT }).toContain(toAgentId)
  await from.selectOption(fromAgentId)
  await to.selectOption(toAgentId)
  await page.getByLabel('Requested outcome', { exact: true }).fill(task)
  const created = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/agent-requests', { timeout: WAIT })
  await page.getByRole('button', { name: 'Send request', exact: true }).click()
  const response = await created
  assert.equal(response.status(), 200)
  const row = await response.json()
  assert.match(row.id, /^agent-request-[a-f0-9]{32}$/)
  return row
}

async function ownerRun(page, origin, requestId, query, expectedResult, model) {
  await page.goto(`${origin}/agents/requests/${encodeURIComponent(requestId)}`)
  await expect(page.getByRole('heading', { name: 'Choose one call', exact: true })).toBeVisible({ timeout: WAIT })
  const tool = page.getByLabel('Inspected tool', { exact: true })
  await expect(tool).toContainText('Native private request fixture · records.search', { timeout: WAIT })
  await tool.selectOption({ label: 'Native private request fixture · records.search · Local program' })
  if (model) {
    const suggestion = page.getByRole('region', { name: 'Optional argument draft', exact: true })
    await expect(suggestion).toContainText(MODEL)
    await expect(suggestion).toContainText('Your workspace pays for model usage')
    await suggestion.getByRole('button', { name: 'Draft arguments', exact: true }).click()
    await expect(suggestion.getByRole('button', { name: 'Use draft', exact: true })).toBeEnabled({ timeout: WAIT })
    assert.equal(model.requests.length, 1, 'one explicitly started model call')
    await expect(page.getByLabel('Arguments (JSON)', { exact: true })).toHaveValue('{}', { timeout: WAIT })
    assert.equal((await api(page, `/agent-requests/${requestId}`)).execution, undefined, 'the suggested arguments do not execute a tool')
    await suggestion.getByRole('button', { name: 'Use draft', exact: true }).click()
    await expect.poll(async () => JSON.parse(await page.getByLabel('Arguments (JSON)', { exact: true }).inputValue())).toEqual({ query })
  } else await page.getByLabel('Arguments (JSON)', { exact: true }).fill(JSON.stringify({ query }))
  await page.getByRole('button', { name: 'Review call', exact: true }).click()
  const acknowledgement = page.getByRole('checkbox', { name: /I understand this local program has normal OS access/ })
  const run = page.getByRole('button', { name: 'Run once', exact: true })
  await expect(acknowledgement).toHaveAttribute('aria-checked', 'false')
  await expect(run).toBeDisabled()
  await acknowledgement.click()
  await expect(run).toBeEnabled()
  await run.click()
  if (expectedResult) {
    await expect(page.getByRole('heading', { name: 'Write a reply to share', exact: true })).toBeVisible({ timeout: WAIT })
    const receipt = page.getByRole('region', { name: 'Private execution receipt', exact: true })
    await receipt.getByText('Exact call and raw result · visible only to you', { exact: true }).click()
    await expect(receipt).toContainText(expectedResult)
  }
}

export async function smokePackagedAgentRequests({ executable = packagedExecutable() } = {}) {
  if (process.platform !== 'darwin') throw new Error('Packaged Agent Requests stdio acceptance requires macOS')
  const profile = await mkdtemp(join(tmpdir(), 'ac-agent-requests-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-agent-requests-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidence = await mkdtemp(join(evidenceRoot, 'run-'))
  const tracePath = join(profile, 'peer-trace.jsonl')
  const label = 'Native private request fixture'
  const launch = Object.freeze({ executable: process.execPath, args: Object.freeze([PEER, tracePath]), cwd: ROOT,
    env: Object.freeze({ AC_MCP_STDIO_FIXTURE_TRACE: tracePath }) })
  const priorEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.DATA_FILE = join(profile, 'unused-store.json')
  process.env.DATABASE_PATH = join(profile, 'store.db')
  process.env[GATE] = '1'
  process.env.AC_MCP_STDIO_FIXTURE_EXECUTABLE = launch.executable
  process.env.AC_MCP_STDIO_FIXTURE_CWD = launch.cwd
  process.env.AC_MCP_STDIO_FIXTURE_ARGS = JSON.stringify(launch.args)
  process.env.AC_MCP_STDIO_FIXTURE_ENV = JSON.stringify(launch.env)

  let fixture, run, model
  let stage = 'fixture-package-and-owner-signup'
  try {
    fixture = await createMcpFixturePackage(executable, mcpStdioSmokePatches())
    model = await startArgumentModel()
    run = await launchPackagedDesktop(fixture.executable, profile)
    let { page, origin } = run
    const owner = await api(page, '/auth/signup', {
      name: 'Agent Request owner', email: `agent-request-owner-${randomUUID()}@example.test`, password: 'isolated-agent-request-owner-password',
    })
    await page.reload()

    stage = 'owner-local-program-cancel-then-inspect'
    await page.goto(`${origin}/contexts`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name', { exact: true }).fill(label)
    await create.getByLabel('Transport').selectOption('stdio')
    await create.getByRole('button', { name: 'Save server', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
    const connectionId = new URL(page.url()).pathname.split('/').at(-1)
    assert.ok(connectionId)
    const connection = await api(page, `/mcp-connections/${connectionId}`)
    const configure = async () => {
      await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
      const setup = page.getByRole('dialog', { name: `Configure ${label}`, exact: true })
      await setup.getByLabel('Executable path', { exact: true }).fill(launch.executable)
      await setup.getByLabel('Working directory', { exact: true }).fill(launch.cwd)
      await setup.getByRole('textbox', { name: 'Arguments (JSON array)', exact: true }).fill(JSON.stringify(launch.args))
      await setup.getByRole('textbox', { name: 'Environment (JSON object)', exact: true }).fill(JSON.stringify(launch.env))
      return setup
    }
    let setup = await configure()
    await setup.getByRole('button', { name: 'Review & inspect', exact: true }).click({ timeout: WAIT })
    await expect(setup.locator('[data-mcp-stdio-phase="cancelled"]')).toBeVisible({ timeout: WAIT })
    assert.deepEqual(await api(page, `/mcp-connections/${connectionId}`), connection,
      'Cancel leaves the exact owner connection unchanged')
    assert.deepEqual(await peerTrace(tracePath), [], 'native setup cancellation never starts the child')
    await setup.getByRole('button', { name: 'Close', exact: true }).click()
    setup = await configure()
    await setup.getByRole('button', { name: 'Review & inspect', exact: true }).click({ timeout: WAIT })
    await expect(setup.locator('[data-mcp-stdio-phase="connected"]')).toBeVisible({ timeout: WAIT })
    const inspected = await api(page, `/mcp-connections/${connectionId}`)
    assert.equal(inspected.status, 'connected')
    assert.deepEqual(inspected.tools.map(tool => tool.name), ['records.search'])
    const ownerGrant = join(profile, MCP_STDIO_GRANT_FILE)
    assert.equal((await readFile(ownerGrant)).includes(Buffer.from(launch.executable)), false,
      'the real OS-encrypted local grant does not persist plaintext launch authority')
    await setup.getByRole('button', { name: 'Close', exact: true }).click()

    stage = 'owner-and-requester-agent-setup'
    const provider = await api(page, '/providers', {
      label: 'Private argument model', modelFamily: 'claude', effortLevels: ['Low'],
      models: [{ id: MODEL, label: 'Authored argument model' }],
      authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] }, config: { baseURL: model.origin, model: MODEL },
    })
    const receiver = await createAgent(page, 'Private receiving Agent', { connectors: [connectionId] }, provider.id)
    const draftReceiver = await createAgent(page, 'Interrupted model Agent', { connectors: [connectionId] }, provider.id)
    await api(page, `/agents/${draftReceiver.id}`, { published: true, expectedRevision: draftReceiver.revision ?? 0 }, { method: 'PATCH' })
    const published = await api(page, `/agents/${receiver.id}`, { published: true, expectedRevision: receiver.revision ?? 0 },
      { method: 'PATCH' })
    assert.equal(published.published, true, 'only the Agent definition is published for cross-tenant discovery')
    const requester = await api(page, '/auth/signup', {
      name: 'Agent Request requester', email: `agent-requester-${randomUUID()}@example.test`, password: 'isolated-agent-requester-password',
    })
    await page.reload()
    const directory = await api(page, '/directory/agents')
    const publicReceiver = directory.find(row => row.id === published.id)
    assert.ok(publicReceiver, 'the requester discovers the published receiving Agent through its public read')
    assert.equal(JSON.stringify(publicReceiver).includes(connectionId), false,
      'the public directory projection omits private MCP reach')
    const source = await createAgent(page, 'Private requesting Agent')
    const options = await api(page, '/agent-request-options')
    assert.ok(options.sourceAgents.some(row => row.id === source.id))
    assert.ok(options.targetAgents.some(row => row.id === published.id), 'the signed requester sees the published receiving Agent')

    stage = 'rendered-request-owner-only-result-and-reviewed-share'
    const task = `Please look up the requested record (${randomUUID().slice(0, 8)}).`
    const first = await createRequestThroughUi(page, origin, source.id, published.id, task)
    assert.equal(first.role, 'requester')
    await api(page, '/auth/session', { userId: owner.user.id })
    await page.reload()
    await expect(page.getByTestId('account-chip')).toContainText(owner.user.name, { timeout: WAIT })
    const initialOwner = await api(page, `/agent-requests/${first.id}`)
    assert.equal(initialOwner.role, 'owner')
    assert.equal(initialOwner.execution, undefined)
    const firstTrace = await peerTrace(tracePath)
    assert.equal(processStarts(firstTrace).length, 1, 'setup inspection is the only child start before Run')
    assert.equal(toolCalls(firstTrace).length, 0, 'creating a request and opening owner review never runs a tool')

    await ownerRun(page, origin, first.id, 'agent-request-smoke-success', SECRET, model)
    const completedOwner = await api(page, `/agent-requests/${first.id}`)
    assert.equal(completedOwner.status, 'awaiting-reply')
    assert.equal(completedOwner.execution.status, 'done')
    assert.equal(completedOwner.execution.result.content[0].text, SECRET)
    assert.deepEqual(completedOwner.execution.approval.call.arguments, { query: 'agent-request-smoke-success' })
    assert.equal(completedOwner.argumentDraft.status, 'done')
    assert.deepEqual(completedOwner.argumentDraft.arguments, { query: 'agent-request-smoke-success' })
    const firstCalls = toolCalls(await peerTrace(tracePath))
    assert.equal(firstCalls.length, 1)
    assert.equal(firstCalls[0].params.name, 'records.search')
    assert.deepEqual(firstCalls[0].params.arguments, { query: 'agent-request-smoke-success' })
    const storedCompleted = storedRequest(profile, first.id)
    assert.deepEqual(storedCompleted.execution, completedOwner.execution, 'SQLite preserves the owner receipt exactly')

    await switchAccount(page, origin, requester.user.id, requester.user.name)
    const privateRequester = await api(page, `/agent-requests/${first.id}`)
    assert.equal(privateRequester.execution, undefined)
    assert.equal(privateRequester.argumentDraft, undefined)
    assert.equal(privateRequester.reply, undefined)
    assert.equal(JSON.stringify(privateRequester).includes(SECRET), false)
    await page.goto(`${origin}/agents/requests/${encodeURIComponent(first.id)}`)
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Shared reply', exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(SECRET)

    await switchAccount(page, origin, owner.user.id, owner.user.name)
    await page.goto(`${origin}/agents/requests/${encodeURIComponent(first.id)}`)
    await expect(page.getByRole('heading', { name: 'Write a reply to share', exact: true })).toBeVisible()
    await page.getByLabel('Reply', { exact: true }).fill(REPLY)
    await page.getByRole('button', { name: 'Review reply', exact: true }).click()
    await expect(page.getByText(REPLY, { exact: true })).toBeVisible()
    const firstShare = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/agent-requests/${first.id}/decision`, { timeout: WAIT })
    await page.getByRole('button', { name: 'Share reply', exact: true }).click()
    assert.equal((await firstShare).status(), 200)
    const sharedOwner = await api(page, `/agent-requests/${first.id}`)
    assert.equal(sharedOwner.status, 'replied')
    assert.equal(sharedOwner.reply, REPLY)
    assert.equal(sharedOwner.execution.result.content[0].text, SECRET)
    const storedShared = storedRequest(profile, first.id)
    assert.equal(storedShared.status, sharedOwner.status)
    assert.equal(storedShared.revision, sharedOwner.revision)
    assert.equal(storedShared.reply, sharedOwner.reply)
    assert.deepEqual(storedShared.execution, sharedOwner.execution, 'SQLite stores the raw receipt separately from the shared reply')

    await switchAccount(page, origin, requester.user.id, requester.user.name)
    await page.goto(`${origin}/agents/requests/${encodeURIComponent(first.id)}`)
    await expect(page.getByRole('region', { name: 'Shared reply', exact: true })).toContainText(REPLY)
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(SECRET)

    stage = 'pending-interruption-and-same-profile-relaunch-without-replay'
    const secondTask = `Please inspect one more record (${randomUUID().slice(0, 8)}).`
    await page.goto(`${origin}/agents/requests`)
    const second = await createRequestThroughUi(page, origin, source.id, published.id, secondTask)
    await switchAccount(page, origin, owner.user.id, owner.user.name)
    await ownerRun(page, origin, second.id, 'contribution-smoke-interrupt', undefined)
    await expect.poll(async () => toolCalls(await peerTrace(tracePath)).length, { timeout: WAIT }).toBe(2)
    const pendingOwner = await api(page, `/agent-requests/${second.id}`)
    assert.equal(pendingOwner.execution.status, 'pending')
    assert.deepEqual(pendingOwner.execution.approval.call.arguments, { query: 'contribution-smoke-interrupt' })
    const pendingSaved = storedRequest(profile, second.id)
    assert.equal(pendingSaved.execution.status, 'pending')
    await switchAccount(page, origin, requester.user.id, requester.user.name)
    const third = await createRequestThroughUi(page, origin, source.id, draftReceiver.id, 'hold-model-until-relaunch')
    await switchAccount(page, origin, owner.user.id, owner.user.name)
    await page.goto(`${origin}/agents/requests/${encodeURIComponent(third.id)}`)
    await page.getByLabel('Inspected tool', { exact: true }).selectOption({ label: 'Native private request fixture · records.search · Local program' })
    await page.getByRole('button', { name: 'Draft arguments', exact: true }).click()
    await expect.poll(() => model.requests.length, { timeout: WAIT }).toBe(2)
    await expect(page.getByRole('region', { name: 'Optional argument draft', exact: true })).toContainText('Drafting arguments')
    assert.equal(storedRequest(profile, third.id).argumentDraft.status, 'pending', 'the provider attempt is durable before process exit')
    const authRoot = await readFile(join(profile, AUTH_ROOT_FILE))
    const oldOrigin = origin
    await page.screenshot({ path: join(evidence, 'owner-pending-request.png'), fullPage: true })
    await closePackagedDesktop(run); run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }))
    const interrupted = storedRequest(profile, second.id)
    assert.ok(['pending', 'uncertain'].includes(interrupted.execution.status),
      'process exit retains unresolved truth without inventing a successful result')
    assert.equal(interrupted.execution.result, undefined)

    run = await launchPackagedDesktop(fixture.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, owner.user.id, 'the real owner session survives the same-profile relaunch')
    assert.deepEqual(await readFile(join(profile, AUTH_ROOT_FILE)), authRoot, 'relaunch retains the exact OS authentication root')
    const recovered = await api(page, `/agent-requests/${second.id}`)
    const recoveredDraft = await api(page, `/agent-requests/${third.id}`)
    assert.equal(recoveredDraft.argumentDraft.status, 'uncertain')
    assert.equal(recoveredDraft.execution, undefined, 'interrupted advice cannot become a tool execution')
    assert.equal(model.requests.length, 2, 'relaunch never repeats either model request')
    assert.equal(recovered.status, 'awaiting-reply')
    assert.equal(recovered.execution.status, 'uncertain', 'shutdown or startup closes an interrupted call without replay')
    assert.equal(recovered.execution.result, undefined)
    assert.deepEqual(storedRequest(profile, first.id), storedShared, 'the completed and shared request survives byte-for-byte')
    const storedRecovered = storedRequest(profile, second.id)
    assert.equal(storedRecovered.intent.id, second.id)
    assert.deepEqual(storedRecovered.intent, pendingSaved.intent, 'recovery does not rewrite the immutable request intent')
    assert.equal(storedRecovered.status, recovered.status)
    assert.equal(storedRecovered.revision, recovered.revision)
    assert.deepEqual(storedRecovered.execution, recovered.execution, 'SQLite preserves the exact owner recovery receipt')
    await page.goto(`${origin}/agents/requests/${encodeURIComponent(second.id)}`)
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toContainText(recovered.execution.summary)
    const afterRestart = await peerTrace(tracePath)
    assert.equal(toolCalls(afterRestart).length, 2, 'startup and reading the interrupted request never replay the call')
    assert.equal(processStarts(afterRestart).length, 3, 'startup and request history never launch the local program')

    await switchAccount(page, origin, requester.user.id, requester.user.name)
    await page.goto(`${origin}/agents/requests/${encodeURIComponent(second.id)}`)
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('contribution-smoke-interrupt')
    await expect(page.locator('body')).not.toContainText(recovered.execution.summary)
    await expect(page.locator('body')).not.toContainText(SECRET)
    assert.equal(JSON.stringify(await api(page, '/agent-requests')).includes('execution'), false,
      'both request summaries omit raw receipts')

    const finalTrace = await peerTrace(tracePath)
    assert.deepEqual(toolCalls(finalTrace).map(row => row.params.arguments), [
      { query: 'agent-request-smoke-success' }, { query: 'contribution-smoke-interrupt' },
    ])
    assert.equal((await readFile(join(profile, MCP_STDIO_GRANT_FILE))).includes(Buffer.from(launch.executable)), false)
    const traceText = await readFile(tracePath, 'utf8')
    assert.equal(traceText.includes(launch.executable), false, 'private executable paths never enter the peer protocol trace')
    assert.equal(traceText.includes('AC_MCP_STDIO_FIXTURE_ALLOW'), false, 'fixture approval variables never enter the child protocol')
    assert.equal(traceText.includes(SECRET), false, 'the raw peer result exists only in owner-private request history')
    await writeFile(join(evidence, 'evidence.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), sourceAsarSha256: fixture.sourceAsarSha256, fixtureAsarSha256: fixture.fixtureAsarSha256,
      originalPackagedAppUnmodified: true, realSignedPeople: [owner.user.id, requester.user.id],
      crossTenantPublishedTarget: true, ownerOnlyRawReceipt: true, separatelyReviewedReply: true,
      pendingRestartRecoveredUncertainWithoutReplay: true, exactToolCalls: toolCalls(finalTrace).length,
      argumentDraft: { explicitUseBeforeReview: true, calls: model.requests.length, interruptedStatus: recoveredDraft.argumentDraft.status,
        knownReceiptRetained: storedShared.argumentDraft.status === 'done', requesterRedacted: privateRequester.argumentDraft === undefined },
      sqliteRows: [storedShared, storedRecovered].map(row => ({ id: row.intent.id, status: row.status, revision: row.revision })),
      scope: 'Disposable unsigned macOS app copy with exact local stdio setup approvals; no source ASAR or shipped startup changes. Not signing/notarization, public MCP, or Intel acceptance.',
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    console.log(`[desktop-agent-request-smoke] real signed owner/requester · one-shot argument draft · explicit Use/Review/Run · exact local MCP call · private owner receipt · reviewed share · model/tool uncertainty without replay · evidence ${evidence}`)
  } catch (error) {
    if (run?.page && !run.page.isClosed()) {
      await run.page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => undefined)
      const state = await run.page.evaluate(() => ({ url: location.href, text: document.body.innerText })).catch(() => null)
      await writeFile(join(evidence, 'failure-state.json'), JSON.stringify({ stage, state }, null, 2), { mode: 0o600, flag: 'wx' }).catch(() => undefined)
    }
    throw new Error(`Packaged Agent Requests acceptance failed during ${stage}: ${error instanceof Error ? error.message : 'unavailable'} · evidence ${evidence}`)
  } finally {
    try {
      try { await closePackagedDesktop(run) } finally { await model?.close() }
    } finally {
      try {
        // Preserve fixture close failures (especially source-hash mismatches).
        await fixture?.close()
      } finally {
        try {
          await rm(profile, { recursive: true, force: true })
        } finally {
          for (const [key, value] of priorEnv) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
          }
        }
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  smokePackagedAgentRequests().catch(error => { console.error(error.message); process.exitCode = 1 })
}
