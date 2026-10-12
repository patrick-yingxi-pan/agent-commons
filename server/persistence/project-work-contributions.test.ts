/** A successful explicit MCP receipt and the human landing that links it to
 * one Project work item survive both persistence backends. Present broken
 * joins are refused; legacy unlinked rows remain admissible. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-project-work-contributions-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const formatModule = new URL('./format.ts', import.meta.url).href
const effectStateModule = new URL('../contributionEffectState.ts', import.meta.url).href
const effectIdentityModule = new URL('../contributionEffectExecutionIdentity.ts', import.meta.url).href
const OWNER = 'project-work-contribution-persistence-owner'
const WORKER = 'project-work-contribution-persistence-worker'
const SUB_GOAL = 'Finish the exact reviewed work'

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
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
  test(`${backend}: linked work and its exact human resolution survive restart; malformed links refuse admission`, () => {
    const file = join(ROOT, `project-work-resolution-${backend}`)
    const seeded = output(boot(file, backend, `
      const { createContributionEffectAttempt, settleContributionEffectAttempt } = await import(${JSON.stringify(effectStateModule)});
      const { contributionEffectExecutionId } = await import(${JSON.stringify(effectIdentityModule)});
      const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
      const owner = ${JSON.stringify(OWNER)};
      const worker = ${JSON.stringify(WORKER)};
      const projectId = 'project-work-resolution-${backend}';
      store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Resolution persistence', projectDescription: '' }, owner);
      store.applyRelationOp({ kind: 'share-project', projectId, projectName: 'Resolution persistence', shared: true }, owner);
      const item = store.postOpenSubGoal(projectId,
        { subGoal: ${JSON.stringify(SUB_GOAL)}, type: 'mcp.mutate', target: 'write', note: '' }, worker);
      const contribution = store.openContribution(projectId,
        { title: 'Resolve the requested work', workItemId: item.id }, worker, undefined);
      const state = loadState();
      const row = state.contributions.find(candidate => candidate.id === contribution.id);
      const storedItem = state.openSubGoals.find(candidate => candidate.id === item.id);
      const connectionId = 'mcp-connection-' + 'a'.repeat(32);
      const call = { connectionId, connectionRevision: 1, toolName: 'write', schemaHash: 'b'.repeat(64), arguments: { value: 'done' } };
      const lineId = 'project-work-resolution-line';
      const effectId = contributionEffectExecutionId(worker, projectId, contribution.id, 'resolution-effect');
      row.effectsFired = true;
      row.envelope = { version: 1, status: 'approved', proposedBy: row.contributor, proposedAt: 100,
        approvedBy: 'Project Owner', approvedAt: 101, approvedVersion: 1, lines: [{
          id: lineId, type: 'mcp.mutate', target: 'write', cardinality: 1, harness: 'explicit-call', note: 'Exact work.', used: 1,
          mcp: { connectionLabel: 'Local completion peer', toolName: 'write', arguments: call.arguments },
          mcpAuthority: { tenantId: worker, call },
        }] };
      row.events.push(
        { id: 'project-work-resolution-proposed', kind: 'envelope-proposed', at: 100, actor: row.contributor,
          envelopeVersion: 1, body: 'v1 · 1 act', proposedByTenant: worker, envelopeProposalExpectedVersion: 0,
          envelopeProposalLines: [{ type: 'mcp.mutate', target: 'write', cardinality: 1, harness: 'explicit-call', note: 'Exact work.',
            mcp: { connectionId, connectionRevision: 1, toolName: 'write', arguments: call.arguments } }] },
        { id: 'project-work-resolution-approved', kind: 'envelope-approved', at: 101, actor: 'Project Owner',
          envelopeVersion: 1, body: 'v1', approvedByTenant: owner },
      );
      const pending = createContributionEffectAttempt({ id: effectId, tenantId: worker, projectId,
        contributionId: contribution.id, envelopeVersion: 1, lineId, actor: row.contributor,
        connectionLabel: 'Local completion peer', call, startedAt: 102 });
      row.effectAttempts = [settleContributionEffectAttempt(pending,
        { status: 'done', result: { resultType: 'complete', content: [{ type: 'text', text: 'Exact result saved.' }], isError: false } }, 103)];
      row.status = 'landed'; row.landingNumber = 1; row.landedAt = 104;
      row.landedBy = 'Project Owner'; row.landedByTenant = owner;
      row.events.push({ id: 'project-work-resolution-landed', kind: 'landed', at: 104, actor: 'Project Owner',
        principal: { kind: 'user', id: 'person-project-work-resolution-owner' } });
      storedItem.status = 'done'; storedItem.resolvedAt = 104;
      storedItem.contributionResolution = { contributionId: contribution.id, effectId, by: 'Project Owner' };
      saveState(state);
      console.log(JSON.stringify({ projectId, itemId: item.id, contributionId: contribution.id, effectId,
        valid: hasCorePersistedShape(state), legacyValid: hasCorePersistedShape({ ...state,
          openSubGoals: state.openSubGoals.filter(candidate => candidate.id !== item.id),
          contributions: state.contributions.filter(candidate => candidate.id !== contribution.id) }) }));
    `))

    assert.equal(seeded.valid, true, 'the exact successful effect proof and owner resolution form an admissible persisted join')
    assert.equal(seeded.legacyValid, true, 'removing these rows leaves the legacy snapshot shape admissible')

    const recovered = output(boot(file, backend, `
      const projectId = ${JSON.stringify(seeded.projectId)};
      const item = store.listOpenSubGoals(projectId, ${JSON.stringify(OWNER)}).find(candidate => candidate.id === ${JSON.stringify(seeded.itemId)});
      const contribution = store.listContributions(projectId, ${JSON.stringify(OWNER)}).find(candidate => candidate.id === ${JSON.stringify(seeded.contributionId)});
      const state = loadState();
      console.log(JSON.stringify({ item, contribution,
        storedItem: state.openSubGoals.find(candidate => candidate.id === ${JSON.stringify(seeded.itemId)}),
        storedContribution: state.contributions.find(candidate => candidate.id === ${JSON.stringify(seeded.contributionId)}) }));
    `))
    assert.equal(recovered.item.status, 'done')
    assert.deepEqual(recovered.item.contributionResolution, {
      contributionId: seeded.contributionId, effectId: seeded.effectId, by: 'Project Owner',
    })
    assert.equal(recovered.item.resolvedAt, 104)
    assert.equal(recovered.item.resolvedBy, undefined, 'the human work resolution never becomes an Agent credit')
    assert.equal(recovered.contribution.status, 'landed')
    assert.equal(recovered.contribution.workItemId, seeded.itemId)
    assert.equal(recovered.contribution.workItemResolution, 'closed', 'serve-time projection reflects the now-closed item')
    assert.equal(recovered.contribution.contributorTenant, undefined)
    assert.doesNotMatch(JSON.stringify({ item: recovered.item, contribution: recovered.contribution }),
      /postedByTenant|landedByTenant|mcpAuthority|schemaHash|endpoint|credentialReference/)
    assert.deepEqual(recovered.storedItem.contributionResolution, recovered.item.contributionResolution)
    assert.equal(recovered.storedContribution.effectAttempts[0].status, 'done')

    const malformed = output(boot(file, backend, `
      const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
      const state = loadState();
      const targetId = ${JSON.stringify(seeded.contributionId)};
      const targetItemId = ${JSON.stringify(seeded.itemId)};
      const corruptions = [
        ['computed work status stored', copy => { copy.contributions.find(row => row.id === targetId).workItemResolution = 'ready'; }],
        ['mismatched source text', copy => { copy.contributions.find(row => row.id === targetId).subGoal = 'forged'; }],
        ['missing linked item', copy => { copy.openSubGoals = copy.openSubGoals.filter(row => row.id !== targetItemId); }],
        ['resolution names another contribution', copy => { copy.openSubGoals.find(row => row.id === targetItemId).contributionResolution.contributionId = 'other'; }],
        ['resolution loses human event proof', copy => { copy.contributions.find(row => row.id === targetId).events.at(-1).principal = undefined; }],
        ['malformed envelope lines', copy => { copy.contributions.find(row => row.id === targetId).envelope.lines = null; }],
        ['missing events on an open linked Contribution', copy => {
          const row = copy.contributions.find(row => row.id === targetId);
          row.status = 'open';
          delete row.landedAt; delete row.landedBy; delete row.landedByTenant; delete row.landingId; delete row.landingNumber;
          delete row.events; delete row.envelope; delete row.effectAttempts; delete row.effectsFired;
          const item = copy.openSubGoals.find(row => row.id === targetItemId);
          item.status = 'open'; delete item.resolvedAt; delete item.contributionResolution;
        }],
        ['public computed effects field', copy => { copy.contributions.find(row => row.id === targetId).effects = []; }],
        ['non-object effect attempt', copy => { copy.contributions.find(row => row.id === targetId).effectAttempts[0] = null; }],
        ['malformed approved event version', copy => { copy.contributions.find(row => row.id === targetId).events.find(event => event.kind === 'envelope-approved').envelopeVersion = '1'; }],
      ];
      const results = corruptions.map(([label, mutate]) => {
        const copy = structuredClone(state); mutate(copy); return [label, hasCorePersistedShape(copy)];
      });
      console.log(JSON.stringify({ results }));
    `))
    assert.deepEqual(malformed.results.map(([, valid]: [string, boolean]) => valid), [false, false, false, false, false, false, false, false, false, false])
  })
}
