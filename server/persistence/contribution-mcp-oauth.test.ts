import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contributionEffectExecutionId } from '../contributionEffectExecutionIdentity.ts'
import { createContributionEffectAttempt, settleContributionEffectAttempt } from '../contributionEffectState.ts'
import { mcpConnectionCreationId, mcpStdioConnectionCreationId } from '../mcpConnections.ts'
import { contributionMcpProposalOwner } from '../contributionMcpAuthority.ts'
import { hasCorePersistedShape, STORE_VERSION, type PersistedState, type StoredContribution } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-commons-contribution-mcp-oauth-'))
const previousEnvironment = { DATA_FILE: process.env.DATA_FILE, DATABASE_PATH: process.env.DATABASE_PATH, SQLITE_FILE: process.env.SQLITE_FILE }
process.env.DATA_FILE = join(root, 'store.json')
process.env.DATABASE_PATH = join(root, 'store.db')
process.env.SQLITE_FILE = process.env.DATABASE_PATH
after(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
})

const tenantId = 'tenant-shared-contribution'
const ownerUserId = 'user-original-proposer'
const otherUserId = 'user-same-tenant-peer'
const projectId = 'project-contribution-oauth'
const contributionId = 'contribution-oauth'
const connectionId = mcpConnectionCreationId(tenantId, 'contribution-oauth', ownerUserId)
const call = {
  connectionId, connectionRevision: 4, toolName: 'create_event', schemaHash: 'b'.repeat(64),
  arguments: { title: 'Planning' },
}

function fixture({ stamp = true, oauth = true, attempt = false, historical = false, retired = false } = {}): PersistedState {
  const line = {
    id: 'oauth-effect-line', type: 'mcp.mutate', target: call.toolName, cardinality: 1,
    harness: 'explicit-call', note: 'One reviewed call.', used: attempt ? 1 : 0,
    mcp: { connectionLabel: 'Calendar', toolName: call.toolName, arguments: call.arguments },
    mcpAuthority: { tenantId, call, ...(stamp ? { ownerUserId } : {}) },
  }
  const row = {
    id: contributionId, projectId, title: 'OAuth work', summary: '', contributor: 'Owner',
    contributorTenant: tenantId, status: 'open', openedAt: 1,
    envelope: {
      version: 1, status: 'approved', proposedBy: 'Owner', proposedAt: 10,
      approvedBy: 'Owner', approvedAt: 20, approvedVersion: 1, lines: [line],
    },
    events: [{
      id: 'oauth-proposal-v1', kind: 'envelope-proposed', envelopeVersion: 1, at: 10, actor: 'Owner',
      body: 'v1', proposedByTenant: tenantId, principal: { kind: 'user', id: ownerUserId },
      ...(oauth ? { envelopeProposalOwnerUserId: ownerUserId } : {}),
      envelopeProposalExpectedVersion: 0,
      envelopeProposalLines: [{ type: line.type, target: line.target, cardinality: 1, harness: line.harness,
        note: line.note, mcp: { connectionId, connectionRevision: call.connectionRevision,
          toolName: call.toolName, arguments: call.arguments } }],
    }, { id: 'oauth-approval-v1', kind: 'envelope-approved', envelopeVersion: 1, at: 20, actor: 'Owner', body: 'v1' }],
  } as StoredContribution
  if (attempt) {
    row.effectsFired = true
    row.effectAttempts = [createContributionEffectAttempt({
      id: contributionEffectExecutionId(tenantId, projectId, contributionId, 'oauth-call'),
      tenantId, ...(stamp ? { ownerUserId } : {}), projectId, contributionId, envelopeVersion: 1,
      lineId: line.id, actor: 'Owner', connectionLabel: 'Calendar', call, startedAt: 30,
    })]
  }
  if (historical) {
    if (row.effectAttempts) row.effectAttempts = row.effectAttempts.map(run => settleContributionEffectAttempt(run,
      { status: 'uncertain', summary: '' }, 40))
    row.envelope = { version: 2, status: 'proposed', proposedBy: 'Peer', proposedAt: 50,
      lines: [{ id: 'replacement-line', type: 'connector.write', target: 'draft', cardinality: 1,
        harness: 'draft-escrow', note: '', used: 0 }] }
  }
  const connection = { tenantId, id: connectionId, ...(oauth ? { ownerUserId } : {}) }
  return structuredClone({
    version: STORE_VERSION, initialWorld: 'clean', sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: { sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {} },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
    contributions: [row],
    mcpConnections: retired ? { connections: [], retired: [connection] } : {
      connections: [{ ...connection, label: 'Calendar', endpoint: 'https://mcp.example/mcp',
        authentication: oauth ? 'device-oauth' : 'none', revision: 4, connected: false }], retired: [],
    },
  }) as PersistedState
}

test('OAuth Contribution lines cannot omit their private person owner', () => {
  assert.equal(hasCorePersistedShape(fixture({ stamp: false })), false,
    'a tenant-only MCP line cannot adopt the personal OAuth connection')
})

test('Contribution authority cannot attach to a person-owned stdio connection, even with matching owner and grant', () => {
  const state = fixture()
  const id = mcpStdioConnectionCreationId(tenantId, 'contribution-oauth', ownerUserId)
  state.contributions![0]!.envelope!.lines[0]!.mcpAuthority!.call.connectionId = id
  state.contributions![0]!.events[0]!.envelopeProposalLines![0]!.mcp!.connectionId = id
  state.mcpConnections = { connections: [{ transport: 'stdio', tenantId, ownerUserId, id, label: 'Local calendar',
    revision: 4, connected: true, grantReference: `MCP_STDIO_${'A'.repeat(32)}`,
    inspection: { protocolVersion: '2026-07-28', cleanup: 'released', inspectedAt: 1, tools: [] } }], retired: [] }
  assert.equal(hasCorePersistedShape(state), false, 'unattended Contribution authority must not opt into native stdio')
})

test('historical OAuth proposal provenance survives replacement by a non-MCP envelope', () => {
  const state = fixture({ stamp: false, historical: true })
  assert.equal(hasCorePersistedShape(state), true, 'the event already retains its exact originating person')
  for (const principal of [undefined, { kind: 'user', id: otherUserId }, { kind: 'agent', id: ownerUserId }]) {
    const invalid = structuredClone(state)
    invalid.contributions![0].events[0].principal = principal as never
    assert.equal(hasCorePersistedShape(invalid), false, 'an amended envelope cannot erase the OAuth event owner join')
  }
})

test('OAuth proposal replay classification retains its durable stamp independently of connection history', () => {
  for (const retired of [false, true]) {
    const state = fixture({ historical: true, retired })
    const proposal = state.contributions![0].events[0]
    assert.equal(contributionMcpProposalOwner(proposal), ownerUserId)
    state.mcpConnections = { connections: [], retired: [] }
    assert.equal(contributionMcpProposalOwner(proposal), ownerUserId, 'losing the registry identity cannot downgrade exact replay to tenant-only')
    assert.equal(hasCorePersistedShape(state), false, 'the retained stamp refuses an orphan historical OAuth proposal')
  }
  const legacy = fixture({ stamp: false, oauth: false, historical: true })
  assert.equal(contributionMcpProposalOwner(legacy.contributions![0].events[0]), undefined,
    'a user principal on legacy work does not turn its tenant-owned connection into OAuth')
})

test('OAuth proposal stamps are strict, match the original person and cannot be erased after replacement', () => {
  for (const historical of [false, true]) {
    const good = fixture({ historical })
    assert.equal(hasCorePersistedShape(good), true)
    for (const owner of [undefined, null, '', ' ', 'bad\nowner', 'x'.repeat(201), otherUserId]) {
      const invalid = structuredClone(good)
      invalid.contributions![0].events[0].envelopeProposalOwnerUserId = owner as never
      assert.equal(hasCorePersistedShape(invalid), false)
    }
    const missing = structuredClone(good)
    delete missing.contributions![0].events[0].envelopeProposalOwnerUserId
    assert.equal(hasCorePersistedShape(missing), false, 'known OAuth proposal history requires an explicit owner stamp')
    const orphan = structuredClone(good)
    delete orphan.mcpConnections
    assert.equal(hasCorePersistedShape(orphan), false, 'the owner stamp cannot survive without its retained connection identity')
  }
  const legacy = fixture({ oauth: false, stamp: false, historical: true })
  legacy.contributions![0].events[0].envelopeProposalOwnerUserId = ownerUserId
  assert.equal(hasCorePersistedShape(legacy), false, 'legacy proposals cannot acquire an OAuth stamp')
  const otherKind = fixture()
  otherKind.contributions![0].events[1].envelopeProposalOwnerUserId = ownerUserId
  assert.equal(hasCorePersistedShape(otherKind), false, 'only a proposal receipt can carry this authority')
  const noSelection = fixture({ historical: true })
  delete noSelection.contributions![0].events[0].envelopeProposalLines
  assert.equal(hasCorePersistedShape(noSelection), false, 'the stamp must retain its exact OAuth selection')
})

test('retained proposals cannot combine personal connections from two people or another tenant', () => {
  const state = fixture({ historical: true })
  const secondId = mcpConnectionCreationId(tenantId, 'second-oauth', otherUserId)
  state.mcpConnections!.retired.push({ tenantId, id: secondId, ownerUserId: otherUserId })
  const proposal = state.contributions![0].events[0]
  proposal.envelopeProposalLines!.push({ ...proposal.envelopeProposalLines![0],
    mcp: { ...proposal.envelopeProposalLines![0].mcp!, connectionId: secondId } })
  assert.equal(hasCorePersistedShape(state), false, 'one originating person must own every personal selection')
  const foreign = fixture({ historical: true })
  foreign.contributions![0].events[0].proposedByTenant = 'foreign-tenant'
  assert.equal(hasCorePersistedShape(foreign), false, 'a matching person does not excuse a different source tenant')
})

test('current OAuth authority joins the exact proposal person and live or retired connection', () => {
  for (const retired of [false, true]) {
    const good = fixture({ retired })
    assert.equal(hasCorePersistedShape(good), true)
    for (const mutate of [
      (state: any) => { state.contributions[0].envelope.lines[0].mcpAuthority.ownerUserId = otherUserId },
      (state: any) => { state.contributions[0].envelope.lines[0].mcpAuthority.ownerUserId = '' },
      (state: any) => { state.contributions[0].envelope.lines[0].mcpAuthority.ownerUserId = null },
      (state: any) => { state.contributions[0].envelope.lines[0].mcpAuthority.ownerUserId = 'bad\nowner' },
      (state: any) => { state.contributions[0].envelope.lines[0].mcpAuthority.ownerUserId = 'x'.repeat(201) },
      (state: any) => { delete state.contributions[0].events[0].principal },
      (state: any) => { state.contributions[0].events[0].principal = { kind: 'agent', id: ownerUserId } },
      (state: any) => { state.contributions[0].events[0].principal.id = otherUserId },
      (state: any) => { state.mcpConnections = { connections: [], retired: [] } },
      (state: any) => { (retired ? state.mcpConnections.retired : state.mcpConnections.connections)[0].tenantId = 'foreign-tenant' },
      (state: any) => { (retired ? state.mcpConnections.retired : state.mcpConnections.connections)[0].ownerUserId = otherUserId },
    ]) {
      const invalid = structuredClone(good)
      mutate(invalid)
      assert.equal(hasCorePersistedShape(invalid), false)
    }
  }
})

test('legacy tenant-owned Contribution calls remain ownerless and cannot gain OAuth stamps', () => {
  assert.equal(hasCorePersistedShape(fixture({ oauth: false, stamp: false, attempt: true })), true)
  assert.equal(hasCorePersistedShape(fixture({ oauth: false })), false)
  const absentRegistry = fixture({ oauth: false, stamp: false, attempt: true })
  delete absentRegistry.mcpConnections
  assert.equal(hasCorePersistedShape(absentRegistry), true, 'legacy state without connection history retains tenant-only semantics')
})

test('OAuth attempts retain exact current and historical person joins even with a recomputed receipt hash', () => {
  for (const historical of [false, true]) {
    const good = fixture({ attempt: true, historical })
    assert.equal(hasCorePersistedShape(good), true)
    for (const owner of [undefined, otherUserId]) {
      const invalid = structuredClone(good)
      const run = invalid.contributions![0].effectAttempts![0]
      const { callHash: _hash, status: _status, ...intent } = run
      delete (intent as any).finishedAt
      delete (intent as any).summary
      delete (intent as any).result
      delete (intent as any).ownerUserId
      const changed = createContributionEffectAttempt({ ...intent, ...(owner === undefined ? {} : { ownerUserId: owner }) })
      invalid.contributions![0].effectAttempts = [historical ? settleContributionEffectAttempt(changed,
        { status: 'uncertain', summary: '' }, 40) : changed]
      assert.equal(hasCorePersistedShape(invalid), false, 'a coherent hash does not grant another person execution provenance')
    }
    const wrongPrincipal = structuredClone(good)
    wrongPrincipal.contributions![0].events[0].principal = { kind: 'user', id: otherUserId }
    assert.equal(hasCorePersistedShape(wrongPrincipal), false)
    const wrongCall = structuredClone(good)
    wrongCall.contributions![0].events[0].envelopeProposalLines![0].mcp!.arguments = { title: 'Different' }
    assert.equal(hasCorePersistedShape(wrongCall), false)
  }
})

for (const backendName of ['json', 'sqlite'] as const) {
  test(`${backendName}: OAuth owners and proposal provenance round-trip through retirement and envelope replacement`, () => {
    const backend = backendName === 'json' ? new JsonFileBackend() : new SqliteBackend(process.env.DATABASE_PATH)
    try {
      for (const retired of [false, true]) for (const historical of [false, true]) {
        const state = fixture({ attempt: true, retired, historical })
        assert.equal(hasCorePersistedShape(state), true)
        backend.save(state)
        const loaded = backend.load()
        assert.deepEqual(loaded?.contributions, state.contributions)
        assert.equal(loaded?.contributions?.[0].events[0].envelopeProposalOwnerUserId, ownerUserId)
        assert.deepEqual(loaded?.mcpConnections, state.mcpConnections)
      }
    } finally { backend.close() }
  })

  test(`${backendName}: orphan historical OAuth proposals refuse load without changing saved bytes`, () => {
    const backend = backendName === 'json' ? new JsonFileBackend() : new SqliteBackend(process.env.DATABASE_PATH)
    try {
      const invalid = fixture({ historical: true })
      invalid.mcpConnections = { connections: [], retired: [] }
      backend.save(invalid)
      const filename = backendName === 'json' ? process.env.DATA_FILE! : process.env.DATABASE_PATH!
      const bytes = readFileSync(filename)
      assert.throws(() => backend.load(), /incompatible|required core slices/)
      assert.deepEqual(readFileSync(filename), bytes)
    } finally { backend.close() }
  })

  test(`${backendName}: missing OAuth authority refuses persisted state without replacing its contents`, () => {
    const backend = backendName === 'json' ? new JsonFileBackend() : new SqliteBackend(process.env.DATABASE_PATH)
    try {
      const invalid = fixture({ stamp: false })
      backend.save(invalid)
      const filename = backendName === 'json' ? process.env.DATA_FILE! : process.env.DATABASE_PATH!
      const bytes = readFileSync(filename)
      assert.throws(() => backend.load(), /incompatible|required core slices/)
      assert.deepEqual(readFileSync(filename), bytes)
    } finally { backend.close() }
  })

  test(`${backendName}: pending OAuth receipt recovers durably with its exact person and occupied slot`, () => {
    const dataFile = join(root, `recovery-${backendName}.json`)
    const databasePath = join(root, `recovery-${backendName}.db`)
    const state = fixture({ attempt: true })
    if (backendName === 'json') writeFileSync(dataFile, JSON.stringify(state))
    else {
      const backend = new SqliteBackend(databasePath)
      try { backend.save(state) } finally { backend.close() }
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      const { store } = await import(${JSON.stringify(new URL('../store/index.ts', import.meta.url).href)});
      const { loadState, closePersistence } = await import(${JSON.stringify(new URL('./persist.ts', import.meta.url).href)});
      store.initPersistence();
      const row = loadState().contributions.find(row => row.id === ${JSON.stringify(contributionId)});
      console.log(JSON.stringify(row));
      closePersistence();
    `], { encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
        PERSIST_BACKEND: backendName, DATA_FILE: dataFile, DATABASE_PATH: databasePath, SQLITE_FILE: databasePath } })
    assert.equal(result.status, 0, result.stderr)
    const recovered = JSON.parse(result.stdout)
    assert.equal(recovered.effectAttempts[0].status, 'uncertain')
    assert.equal(recovered.effectAttempts[0].ownerUserId, ownerUserId)
    assert.equal(recovered.effectAttempts[0].callHash, state.contributions![0].effectAttempts![0].callHash)
    assert.equal(recovered.envelope.lines[0].mcpAuthority.ownerUserId, ownerUserId)
    assert.equal(recovered.envelope.lines[0].used, 1)
    assert.deepEqual(recovered.events[0].principal, { kind: 'user', id: ownerUserId })
    assert.equal(recovered.events[0].envelopeProposalOwnerUserId, ownerUserId)
  })
}
