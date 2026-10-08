/** A late MCP response cannot overwrite the uncertain receipt created by
 * restoring the durable pending snapshot while the original call is in flight. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-contribution-mcp-restore-${process.pid}-`))
after(() => rmSync(ROOT, { recursive: true, force: true }))

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function reply(res: ServerResponse, id: unknown, result: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function readSnapshot(file: string): any {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function withDeadline<T>(promise: Promise<T>, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message())), 10_000)
  })]).finally(() => { if (timer) clearTimeout(timer) })
}

test('restored pending MCP attempt fences off the original late completion and replay', async (t) => {
  let releaseCall!: () => void
  const heldCall = new Promise<void>((resolve) => { releaseCall = resolve })
  let announceCall!: () => void
  const callReached = new Promise<void>((resolve) => { announceCall = resolve })
  const methods: string[] = []
  let toolCalls = 0
  const peer = createServer((req, res) => {
    void readJson(req).then(async (body) => {
      methods.push(body.method)
      if (body.method === 'server/discover') {
        return reply(res, body.id, {
          resultType: 'complete',
          supportedVersions: [MCP_MODERN_VERSION],
          capabilities: { tools: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'restore-fixture', version: '1' } },
        })
      }
      toolCalls += 1
      announceCall()
      assert.equal(body.method, 'tools/call')
      assert.deepEqual(body.params.arguments, { value: 'exact-approved-call' })
      await heldCall
      return reply(res, body.id, {
        resultType: 'complete',
        content: [{ type: 'text', text: 'accepted once before the restore fence' }],
        isError: false,
      })
    }).catch(() => res.destroy())
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    releaseCall()
    peer.closeAllConnections()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')

  const file = join(ROOT, 'store.json')
  const storeUrl = new URL('./index.ts', import.meta.url).href
  const persistenceUrl = new URL('../persistence/persist.ts', import.meta.url).href
  const admissionUrl = new URL('../mcpToolAdmission.ts', import.meta.url).href
  const protocolUrl = new URL('../mcpProtocol.ts', import.meta.url).href
  const proposalIdUrl = new URL('../contributionEnvelopeProposalIdentity.ts', import.meta.url).href
  const approvalIdUrl = new URL('../contributionEnvelopeApprovalIdentity.ts', import.meta.url).href
  const effectIdUrl = new URL('../contributionEffectExecutionIdentity.ts', import.meta.url).href
  const script = `
    const { createInterface } = await import('node:readline');
    const { store } = await import(${JSON.stringify(storeUrl)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceUrl)});
    const { configureMcpRuntime } = await import(${JSON.stringify(new URL('../mcpRuntime.ts', import.meta.url).href)});
    const { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } = await import(${JSON.stringify(admissionUrl)});
    const { MCP_MODERN_VERSION } = await import(${JSON.stringify(protocolUrl)});
    const { contributionEnvelopeProposalId } = await import(${JSON.stringify(proposalIdUrl)});
    const { contributionEnvelopeApprovalId } = await import(${JSON.stringify(approvalIdUrl)});
    const { contributionEffectExecutionId } = await import(${JSON.stringify(effectIdUrl)});
    process.env.DEPLOYMENT_PROFILE = 'desktop';
    process.env.PERSIST_BACKEND = 'json';
    process.env.DATA_FILE = ${JSON.stringify(file)};
    process.env.INITIAL_WORLD = 'clean';
    configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true });
    store.initPersistence();
    const tenant = store.defaultTenantId();
    const projectId = store.createProject({ name: 'Late MCP completion restore fence' }, tenant).project.id;
    const contribution = store.openContribution(projectId, { title: 'One reviewed call' }, tenant, undefined);
    const connectionId = 'mcp-connection-' + 'd'.repeat(32);
    const endpoint = ${JSON.stringify(`http://127.0.0.1:${address.port}/mcp`)};
    const tool = { name: 'write_once', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } };
    store.createMcpConnection({ id: connectionId, label: 'Local restore fixture', endpoint, authentication: 'none' }, tenant, true);
    store.commitMcpInspection(connectionId, tenant, 0, {
      protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
    }, 1);
    const proposalKey = contributionEnvelopeProposalId(tenant, projectId, contribution.id, 'proposal');
    const proposed = await store.proposeMcpEnvelope(projectId, contribution.id, {
      expectedVersion: 0,
      lines: [{ type: 'mcp.mutate', target: 'write_once', cardinality: 1, harness: 'explicit-call', note: 'One exact call.',
        mcp: { connectionId, connectionRevision: 1, toolName: 'write_once', arguments: { value: 'exact-approved-call' } } }],
    }, tenant, undefined, { logicalId: proposalKey });
    if (!proposed || typeof proposed !== 'object') throw new Error('Could not propose the fixture call.');
    const lineId = proposed.envelope.lines[0].id;
    const approvalKey = contributionEnvelopeApprovalId(tenant, projectId, contribution.id, 'approval');
    const approved = store.approveEnvelope(projectId, contribution.id, tenant, undefined, undefined,
      { logicalId: approvalKey, expectedVersion: 1 });
    if (!approved || typeof approved !== 'object') throw new Error('Could not approve the fixture call.');
    const logicalId = contributionEffectExecutionId(tenant, projectId, contribution.id, 'exact-run');
    const runPromise = store.runContributionMcpEffect(projectId, contribution.id, lineId, tenant,
      { logicalId, expectedVersion: 1 });
    process.stdout.write(JSON.stringify({ kind: 'ready' }) + '\\n');
    runPromise.then((value) => process.stdout.write(JSON.stringify({ kind: 'late', value: typeof value === 'string' ? value : value?.effects?.[0]?.status }) + '\\n'),
      (error) => process.stdout.write(JSON.stringify({ kind: 'late-error', message: String(error) }) + '\\n'));
    const rl = createInterface({ input: process.stdin });
    for await (const input of rl) {
      const command = JSON.parse(input);
      if (command.kind === 'restore') {
        store.initPersistence();
        const durable = loadState().contributions.find((row) => row.id === contribution.id);
        const row = store.listContributions(projectId, tenant).find((candidate) => candidate.id === contribution.id);
        const replay = await store.runContributionMcpEffect(projectId, contribution.id, lineId, tenant,
          { logicalId, expectedVersion: 1 });
        process.stdout.write(JSON.stringify({ kind: 'restored', durable: durable.effectAttempts[0].status,
          used: durable.envelope.lines[0].used, row: row.effects[0].status,
          replay: typeof replay === 'string' ? replay : replay?.effects?.[0]?.status }) + '\\n');
      } else if (command.kind === 'stop') {
        closePersistence();
        rl.close();
        break;
      }
    }
  `
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, DEPLOYMENT_PROFILE: '', BACKEND: 'mock', PERSIST_BACKEND: 'json', DATA_FILE: file, INITIAL_WORLD: 'clean' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  let stderr = ''
  const messages: Record<string, any>[] = []
  const waiters = new Map<string, Array<(value: Record<string, any>) => void>>()
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const parsed = JSON.parse(line) as Record<string, any>
      messages.push(parsed)
      const callbacks = waiters.get(parsed.kind)
      if (callbacks?.length) callbacks.shift()!(parsed)
    }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const waitFor = (kind: string): Promise<Record<string, any>> => {
    const existing = messages.find((message) => message.kind === kind)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => {
      const pending = waiters.get(kind) ?? []
      pending.push(resolve)
      waiters.set(kind, pending)
    })
  }
  t.after(async () => {
    if (child.exitCode === null) {
      child.stdin.write(JSON.stringify({ kind: 'stop' }) + '\n')
      child.kill('SIGTERM')
    }
    if (child.exitCode === null) await once(child, 'exit')
  })

  const ready = await withDeadline(Promise.race([waitFor('ready'), childExit.then((exit) => {
    throw new Error(`MCP restore fixture exited during setup (${exit.code ?? exit.signal}): ${stderr}`)
  })]), () => `MCP restore fixture did not finish setup: ${stderr}`)
  assert.equal(ready.kind, 'ready')
  await withDeadline(Promise.race([callReached, childExit.then((exit) => {
    throw new Error(`MCP restore fixture exited before dispatch (${exit.code ?? exit.signal}): ${stderr}`)
  })]), () => `MCP restore fixture did not dispatch within the local test window: ${stderr}`)
  const beforeRestore = readSnapshot(file)
  const durablePending = beforeRestore.contributions.find((row: any) => row.title === 'One reviewed call')
  assert.equal(durablePending.effectAttempts[0].status, 'pending', 'the call has already left the process only after its pending receipt commits')
  assert.equal(durablePending.envelope.lines[0].used, 1)

  child.stdin.write(JSON.stringify({ kind: 'restore' }) + '\n')
  const restored = await waitFor('restored')
  assert.deepEqual({ durable: restored.durable, used: restored.used, row: restored.row, replay: restored.replay },
    { durable: 'uncertain', used: 1, row: 'uncertain', replay: 'uncertain' },
    'recovery persists uncertainty before exact Retry and retains the consumed slot')
  assert.equal(toolCalls, 1, 'the exact replay after restore does not dispatch again')

  releaseCall()
  const late = await waitFor('late')
  assert.equal(late.value, 'conflict', 'the original promise loses its process-local fence after restore')
  const afterLate = readSnapshot(file).contributions.find((row: any) => row.title === 'One reviewed call')
  assert.equal(afterLate.effectAttempts[0].status, 'uncertain', 'late success cannot overwrite the recovered receipt')
  assert.equal(afterLate.envelope.lines[0].used, 1)
  assert.equal(toolCalls, 1)
  assert.deepEqual(methods, ['server/discover', 'tools/call'])
  child.stdin.write(JSON.stringify({ kind: 'stop' }) + '\n')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, stderr)
})
