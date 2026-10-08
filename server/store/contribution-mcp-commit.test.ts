/** A pending Contribution MCP receipt must commit before the executor can
 * begin any network work. The local peer is a harmless protocol fixture. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { after, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MCP_MODERN_VERSION } from '../mcpProtocol.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-contribution-mcp-commit-${process.pid}-`))
after(() => rmSync(ROOT, { recursive: true, force: true }))

async function readJson(req: AsyncIterable<Buffer | string>): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function launch(file: string, blockedPath: string, endpoint: string): Promise<Record<string, any>> {
  const script = `
    const { store } = await import(${JSON.stringify(new URL('./index.ts', import.meta.url).href)});
    const { configureMcpRuntime } = await import(${JSON.stringify(new URL('../mcpRuntime.ts', import.meta.url).href)});
    const { loadState, closePersistence } = await import(${JSON.stringify(new URL('../persistence/persist.ts', import.meta.url).href)});
    const { MCP_MODERN_VERSION } = await import(${JSON.stringify(new URL('../mcpProtocol.ts', import.meta.url).href)});
    const { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } = await import(${JSON.stringify(new URL('../mcpToolAdmission.ts', import.meta.url).href)});
    const { contributionEnvelopeProposalId } = await import(${JSON.stringify(new URL('../contributionEnvelopeProposalIdentity.ts', import.meta.url).href)});
    const { contributionEnvelopeApprovalId } = await import(${JSON.stringify(new URL('../contributionEnvelopeApprovalIdentity.ts', import.meta.url).href)});
    const { contributionEffectExecutionId } = await import(${JSON.stringify(new URL('../contributionEffectExecutionIdentity.ts', import.meta.url).href)});
    process.env.DEPLOYMENT_PROFILE = 'desktop';
    process.env.PERSIST_BACKEND = 'json';
    process.env.DATA_FILE = ${JSON.stringify(file)};
    process.env.INITIAL_WORLD = 'clean';
    configureMcpRuntime({ deviceBearerAvailable: false, allowLoopback: true });
    store.initPersistence();
    const tenant = store.defaultTenantId();
    const projectId = store.createProject({ name: 'Commit-before-call fixture' }, tenant).project.id;
    const contribution = store.openContribution(projectId, { title: 'Explicit local call' }, tenant, undefined);
    const connectionId = 'mcp-connection-' + 'c'.repeat(32);
    const tool = { name: 'write_once', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } };
    store.createMcpConnection({ id: connectionId, label: 'Local harmless fixture', endpoint: ${JSON.stringify(endpoint)}, authentication: 'none' }, tenant, true);
    store.commitMcpInspection(connectionId, tenant, 0, {
      protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
      schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
    }, 1);
    const proposalKey = contributionEnvelopeProposalId(tenant, projectId, contribution.id, 'proposal');
    const proposed = await store.proposeMcpEnvelope(projectId, contribution.id, {
      expectedVersion: 0,
      lines: [{ type: 'mcp.mutate', target: 'write_once', cardinality: 1, harness: 'explicit-call', note: 'One exact harmless test call.',
        mcp: { connectionId, connectionRevision: 1, toolName: 'write_once', arguments: { value: 'commit-guard' } } }],
    }, tenant, undefined, { logicalId: proposalKey });
    if (!proposed || typeof proposed !== 'object') throw new Error('Could not prepare the test envelope.');
    const lineId = proposed.envelope.lines[0].id;
    const approvalKey = contributionEnvelopeApprovalId(tenant, projectId, contribution.id, 'approval');
    const approved = store.approveEnvelope(projectId, contribution.id, tenant, undefined, undefined,
      { logicalId: approvalKey, expectedVersion: 1 });
    if (!approved || typeof approved !== 'object') throw new Error('Could not approve the test envelope.');

    const effectKey = contributionEffectExecutionId(tenant, projectId, contribution.id, 'run');
    process.env.DATA_FILE = ${JSON.stringify(blockedPath)};
    let writeRejected = false;
    let runOutcome;
    try {
      runOutcome = await store.runContributionMcpEffect(projectId, contribution.id, lineId, tenant,
        { logicalId: effectKey, expectedVersion: 1 });
    } catch {
      writeRejected = true;
    }
    process.env.DATA_FILE = ${JSON.stringify(file)};
    const durable = loadState();
    const saved = durable.contributions.find(row => row.id === contribution.id);
    console.log(JSON.stringify({
      writeRejected, runOutcome, healthy: store.persistenceHealthy(), effectKey,
      attempts: saved.effectAttempts ?? [], used: saved.envelope.lines[0].used,
    }));
    closePersistence();
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      env: { ...process.env, DEPLOYMENT_PROFILE: '', PERSIST_BACKEND: 'json', DATA_FILE: file,
        INITIAL_WORLD: 'clean', BACKEND: 'mock' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) reject(new Error(`Contribution MCP commit fixture exited ${code}: ${stderr}`))
      else {
        try { resolve(JSON.parse(stdout)) }
        catch { reject(new Error(`Contribution MCP commit fixture returned no result: ${stdout}\n${stderr}`)) }
      }
    })
  })
}

test('a failed pending-receipt commit cannot reach MCP tools/call', async (t) => {
  const methods: string[] = []
  const peer = createServer((req, res) => {
    void readJson(req).then((body) => {
      methods.push(body.method)
      res.writeHead(200, { 'content-type': 'application/json' })
      const result = body.method === 'server/discover'
        ? { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
        : body.method === 'initialize'
          ? { protocolVersion: MCP_MODERN_VERSION, capabilities: {}, serverInfo: { name: 'local-fixture', version: '1' } }
          : body.method === 'tools/list'
            ? { tools: [{ name: 'write_once', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] }
            : { content: [{ type: 'text', text: 'fixture accepted' }], isError: false }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    }).catch(() => res.destroy())
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    peer.closeAllConnections()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const file = join(ROOT, 'store.json')
  const blockedPath = join(ROOT, 'blocked-path')
  mkdirSync(blockedPath)
  const outcome = await launch(file, blockedPath, `http://127.0.0.1:${address.port}/mcp`)

  assert.equal(outcome.writeRejected, true, `the mutation is refused when its pending receipt cannot be committed: ${JSON.stringify(outcome)}`)
  assert.equal(outcome.healthy, false, 'the process latches the persistence fault')
  assert.deepEqual(outcome.attempts, [], 'the old durable snapshot has no acknowledged attempt')
  assert.equal(outcome.used, 0, 'the old durable envelope retains its unconsumed slot')
  assert.equal(methods.includes('tools/call'), false, `a failed commit must not begin an MCP call; observed ${methods.join(', ')}`)
  assert.deepEqual(methods, [], 'the executor is not entered at all after pending-state persistence fails')
})
