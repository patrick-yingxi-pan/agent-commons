/** Item-first MCP publication persists as one linked Contribution and one
 * unapproved exact-call envelope across the JSON and SQLite backends. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-project-work-initial-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const formatModule = new URL('./format.ts', import.meta.url).href
const protocolModule = new URL('../mcpProtocol.ts', import.meta.url).href
const admissionModule = new URL('../mcpToolAdmission.ts', import.meta.url).href
const tool = { name: 'write', inputSchema: {
  type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
} }

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
      PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function output(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, `persistence process failed:\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: item-first exact MCP proposal is atomic, strict and restart durable`, () => {
    const file = join(ROOT, `initial-proposal-${backend}`)
    const seeded = output(boot(file, backend, `
      const { MCP_MODERN_VERSION } = await import(${JSON.stringify(protocolModule)});
      const { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } = await import(${JSON.stringify(admissionModule)});
      const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
      const owner = 'project-work-initial-owner-${backend}';
      const worker = 'project-work-initial-worker-${backend}';
      const projectId = 'project-work-initial-project-${backend}';
      store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Reviewed MCP publication', projectDescription: '' }, owner);
      store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Reviewed MCP publication', shared: true }, owner);
      const item = store.postOpenSubGoal(projectId,
        { subGoal: 'Review then publish one write', type: 'mcp.mutate', target: 'write', note: '' }, worker);
      const connectionId = 'mcp-connection-' + '${backend === 'json' ? 'a' : 'b'}'.repeat(32);
      store.createMcpConnection({ id: connectionId, label: 'Persistence MCP', endpoint: 'https://mcp.example.com/mcp', authentication: 'none' }, worker);
      const schemaHash = mcpToolSchemaHash(${JSON.stringify(tool)});
      store.commitMcpInspection(connectionId, worker, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed',
        tools: [${JSON.stringify(tool)}], schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] } }, 1);
      const principal = { kind: 'user', id: 'project-work-initial-person-${backend}' };
      const created = await store.openContributionWithInitialMcpProposal(projectId, {
        title: 'Publish the exact reviewed work', workItemId: item.id,
        initialMcpProposal: { connectionId, connectionRevision: 1, toolName: 'write', arguments: { value: 'saved draft' } },
      }, worker, principal, { logicalId: 'contrib-project-work-initial-${backend}', actorUserId: principal.id });
      const state = loadState();
      const row = state.contributions.find(candidate => candidate.id === 'contrib-project-work-initial-${backend}');
      const damaged = structuredClone(state);
      const damagedRow = damaged.contributions.find(candidate => candidate.id === row.id);
      const proposalEvent = damagedRow.events.find(event => event.kind === 'envelope-proposed');
      delete proposalEvent.envelopeProposalLines;
      console.log(JSON.stringify({ created, projectId, itemId: item.id, connectionId,
        valid: hasCorePersistedShape(state), missingProposalStampValid: hasCorePersistedShape(damaged),
        storedEnvelope: row.envelope, storedEvents: row.events }));
    `))

    assert.equal(seeded.valid, true, 'the linked row and exact v1 proposal metadata form an admissible snapshot')
    assert.equal(seeded.missingProposalStampValid, false, 'a persisted explicit-call envelope cannot omit its exact creation proposal proof')
    assert.equal(seeded.created.workItemId, seeded.itemId)
    assert.equal(seeded.created.envelope.version, 1)
    assert.equal(seeded.created.envelope.status, 'proposed')
    assert.equal(seeded.created.envelope.lines.length, 1)
    assert.equal(seeded.created.envelope.lines[0].mcp.arguments.value, 'saved draft')
    assert.equal(seeded.created.effects?.length ?? 0, 0)
    assert.equal(seeded.storedEvents.filter((event: any) => event.kind === 'opened').length, 1)
    assert.equal(seeded.storedEvents.filter((event: any) => event.kind === 'envelope-proposed').length, 1)
    assert.equal(seeded.storedEvents[1].envelopeProposalExpectedVersion, 0)
    assert.equal(seeded.storedEvents[1].envelopeProposalLines[0].mcp.arguments.value, 'saved draft')

    const recovered = output(boot(file, backend, `
      const projectId = ${JSON.stringify(seeded.projectId)};
      const replay = await store.openContributionWithInitialMcpProposal(projectId, {
        title: 'Changed retry after restart', workItemId: 'missing-work',
        initialMcpProposal: { connectionId: 'mcp-connection-missing', connectionRevision: 99, toolName: 'changed', arguments: {} },
      }, ${JSON.stringify(`project-work-initial-worker-${backend}`)},
        { kind: 'user', id: ${JSON.stringify(`project-work-initial-person-${backend}`)} },
        { logicalId: 'contrib-project-work-initial-${backend}', actorUserId: ${JSON.stringify(`project-work-initial-person-${backend}`)} });
      const contribution = store.listContributions(projectId, ${JSON.stringify(`project-work-initial-owner-${backend}`)})
        .find(row => row.id === 'contrib-project-work-initial-${backend}');
      const state = loadState();
      console.log(JSON.stringify({ contribution, replay,
        validAfterRestart: (await import(${JSON.stringify(formatModule)})).hasCorePersistedShape(state) }));
    `))
    assert.equal(recovered.validAfterRestart, true)
    assert.equal(recovered.contribution.workItemId, seeded.itemId)
    assert.equal(recovered.replay.id, `contrib-project-work-initial-${backend}`,
      'a durable keyed create replays before changed work or connection validation')
    assert.equal(recovered.replay.envelope.lines[0].mcp.arguments.value, 'saved draft')
    assert.equal(recovered.contribution.envelope.status, 'proposed')
    assert.equal(recovered.contribution.envelope.approvedVersion, undefined)
    assert.equal(recovered.contribution.envelope.lines[0].mcp.arguments.value, 'saved draft')
    assert.equal(recovered.contribution.effects?.length ?? 0, 0)
    assert.doesNotMatch(JSON.stringify(recovered.contribution), /schemaHash|mcpAuthority|mcp-connection-/)
  })
}
