/** A pending external Contribution call is made uncertain at restart, is
 * durably recovered before admission, and exact Retry never dispatches again. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-contribution-effect-recovery-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const stateModule = new URL('../contributionEffectState.ts', import.meta.url).href
const identityModule = new URL('../contributionEffectExecutionIdentity.ts', import.meta.url).href
after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    store.initPersistence();
    ${work}
    closePersistence();
  `], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
      PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function output(result: ReturnType<typeof boot>): Record<string, any> {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: pending MCP effect recovers as uncertain and exact retry does not dispatch`, () => {
    const file = join(ROOT, `effect-recovery-${backend}`)
    const seeded = output(boot(file, backend, `
      const { createContributionEffectAttempt } = await import(${JSON.stringify(stateModule)});
      const { contributionEffectExecutionId } = await import(${JSON.stringify(identityModule)});
      const owner = store.defaultTenantId();
      const project = store.createProject({ name: 'Contribution effect recovery' }, owner).project.id;
      const created = store.openContribution(project, { title: 'Interrupted MCP call' }, owner, undefined);
      const state = loadState();
      const row = state.contributions.find(candidate => candidate.id === created.id);
      row.effectsFired = true;
      const connectionId = 'mcp-connection-' + 'a'.repeat(32);
      const call = { connectionId, connectionRevision: 4, toolName: 'create_event', schemaHash: 'b'.repeat(64), arguments: { title: 'Planning' } };
      const lineId = 'effect-recovery-line';
      const logicalId = contributionEffectExecutionId(owner, project, created.id, 'pending-key');
      const actor = row.contributor;
      const line = {
        id: lineId, type: 'mcp.mutate', target: 'create_event', cardinality: 1,
        harness: 'explicit-call', note: 'One reviewed call.', used: 1,
        mcp: { connectionLabel: 'Calendar connection', toolName: call.toolName, arguments: call.arguments },
        mcpAuthority: { tenantId: owner, call },
      };
      row.envelope = {
        version: 1, status: 'approved', proposedBy: actor, proposedAt: 100,
        approvedBy: actor, approvedAt: 101, approvedVersion: 1, lines: [line],
      };
      row.events.push(
        { id: 'effect-recovery-proposal', kind: 'envelope-proposed', at: 100, actor, envelopeVersion: 1,
          body: 'v1 · one act', proposedByTenant: owner, envelopeProposalExpectedVersion: 0,
          envelopeProposalLines: [{ type: line.type, target: line.target, cardinality: 1, harness: line.harness,
            note: line.note, mcp: { connectionId, connectionRevision: 4, toolName: call.toolName, arguments: call.arguments } }] },
        { id: 'effect-recovery-approval', kind: 'envelope-approved', at: 101, actor, envelopeVersion: 1,
          body: 'v1', approvedByTenant: owner },
      );
      row.effectAttempts = [createContributionEffectAttempt({
        id: logicalId, tenantId: owner, projectId: project, contributionId: created.id,
        envelopeVersion: 1, lineId, actor, connectionLabel: 'Calendar connection', call, startedAt: 100,
      })];
      saveState(state);
      console.log(JSON.stringify({ owner, project, contributionId: created.id, lineId, logicalId }));
    `))

    const recovered = output(boot(file, backend, `
      const row = store.listContributions(${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.owner)})
        .find(candidate => candidate.id === ${JSON.stringify(seeded.contributionId)});
      const retry = await store.runContributionMcpEffect(
        ${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.contributionId)},
        ${JSON.stringify(seeded.lineId)}, ${JSON.stringify(seeded.owner)},
        { logicalId: ${JSON.stringify(seeded.logicalId)}, expectedVersion: 1 },
      );
      const durable = loadState().contributions.find(candidate => candidate.id === ${JSON.stringify(seeded.contributionId)});
      console.log(JSON.stringify({ row, retry, durable }));
    `))

    assert.equal(recovered.row.effects.find((run: any) => run.id === seeded.logicalId).status, 'uncertain')
    assert.equal(recovered.retry.effects.find((run: any) => run.id === seeded.logicalId).status, 'uncertain',
      'the represented receipt is returned before connection lookup or dispatch')
    assert.equal(recovered.durable.effectAttempts[0].status, 'uncertain',
      'restart recovery is committed before startup admits the next request')
    assert.equal(recovered.durable.envelope.lines[0].used, 1,
      'an uncertain external call retains its consumed slot')
  })
}
