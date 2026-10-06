/** A delegated model attempt is durable before provider I/O and never becomes
 * permission to retry after a process restart. Both real backends are covered. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-delegated-judgment-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistModule = new URL('./persist.ts', import.meta.url).href
const formatModule = new URL('./format.ts', import.meta.url).href
const stateModule = new URL('../delegatedJudgmentState.ts', import.meta.url).href
const identityModule = new URL('../delegatedJudgmentIdentity.ts', import.meta.url).href

after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, saveState, closePersistence } = await import(${JSON.stringify(persistModule)});
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
  test(`${backend}: a real pending call is committed before Messages I/O and process restart makes it uncertain without replay`, { timeout: 30_000 }, () => {
    const file = join(ROOT, `live-pending-${backend}`)
    const keyName = 'PROVIDER_DELEGATED_JUDGMENT_PERSISTENCE_FIXTURE'
    const source = `
      const { createServer } = await import('node:http');
      const { delegatedJudgmentId } = await import(${JSON.stringify(identityModule)});
      let received;
      let receive;
      const requestReady = new Promise(resolve => { receive = resolve });
      const fixture = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        received = { method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
        receive();
      });
      await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
      const address = fixture.address();
      const baseURL = 'http://127.0.0.1:' + address.port;
      const owner = store.defaultTenantId();
      const project = store.createProject({ name: 'Live pending judgment' }, owner).project.id;
      const contribution = store.openContribution(project, { title: 'Live pending' }, owner, undefined);
      store.crystallizeContribution(project, contribution.id, { entries: [{ kind: 'note', target: 'target', after: 'frozen text' }] }, owner, undefined);
      const provider = store.createProvider({ label: 'Local fixture', modelFamily: 'claude', effortLevels: ['Low'],
        models: [{ id: 'persistence-model-fixture', label: 'Persistence model fixture' }] }, {
        baseURL, apiKeyEnv: ${JSON.stringify(keyName)}, model: 'persistence-model-fixture',
        capabilities: { toolUse: true },
      }, owner);
      const agent = store.createAgent({ label: 'Persistent reviewer', providerId: provider.id,
        systemPrompt: 'Apply only the delegation policy.', instructions: 'Return exact JSON.', tools: [] }, owner);
      const delegation = store.createDelegation(project, { agentId: agent.id, actKind: 'land',
        policy: 'Approve consistent changes.', escalation: ['effectful'], mode: 'draft' }, owner);
      const publicAgent = store.listAgents(owner).find(row => row.id === agent.id);
      const publicProvider = store.listProviders(owner).find(row => row.id === provider.id);
      const request = { expectedDelegationRevision: delegation.revision ?? 0, expectedChangesetVersion: 1,
        expectedEnvelopeVersion: null, reviewer: { agentId: agent.id, agentRevision: publicAgent.revision ?? 0,
          providerId: provider.id, providerRevision: publicProvider.definitionRevision ?? 0,
          connectionRevision: publicProvider.connectionRevision ?? 0 } };
      const id = delegatedJudgmentId(owner, project, contribution.id, delegation.id, 'persist-live-key');
      const execution = store.runDelegatedModelJudgment(project, contribution.id, delegation.id, owner, undefined, id, request);
      const durablePending = loadState().contributions.find(row => row.id === contribution.id).judgmentAttempts.at(-1);
      await requestReady;
      const output = { owner, project, contributionId: contribution.id, delegationId: delegation.id,
        id, request, durablePending, providerRequest: received };
      process.stdout.write(JSON.stringify(output) + '\\n', () => process.exit(0));
      await execution;
    `
    const started = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      const { store } = await import(${JSON.stringify(storeModule)});
      const { loadState } = await import(${JSON.stringify(persistModule)});
      store.initPersistence();
      ${source}
    `], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, INITIAL_WORLD: 'clean', DEPLOYMENT_PROFILE: '', BACKEND: 'mock',
        PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file, [keyName]: 'fixture-only-key' },
    })
    const admitted = output(started)
    assert.equal(admitted.providerRequest.method, 'POST')
    assert.equal(admitted.providerRequest.url, '/v1/messages')
    assert.equal(admitted.providerRequest.body.tools, undefined)
    assert.equal(admitted.durablePending.status, 'pending', 'pending is durable before the fixture receives its response')
    assert.equal(admitted.durablePending.decision, undefined)
    assert.equal(admitted.durablePending.summary, undefined)
    assert.equal(Object.hasOwn(admitted.durablePending, 'request'), true)
    const recovered = output(boot(file, backend, `
      const row = store.listContributions(${JSON.stringify(admitted.project)}, ${JSON.stringify(admitted.owner)})
        .find(candidate => candidate.id === ${JSON.stringify(admitted.contributionId)});
      const replay = await store.runDelegatedModelJudgment(${JSON.stringify(admitted.project)},
        ${JSON.stringify(admitted.contributionId)}, ${JSON.stringify(admitted.delegationId)}, ${JSON.stringify(admitted.owner)},
        undefined, ${JSON.stringify(admitted.id)}, ${JSON.stringify(admitted.request)});
      console.log(JSON.stringify({ row, replayStatus: replay.judgments.at(-1).status,
        stored: loadState().contributions.find(candidate => candidate.id === ${JSON.stringify(admitted.contributionId)}).judgmentAttempts.at(-1).status }));
    `))
    assert.equal(recovered.row.judgments.at(-1).status, 'uncertain')
    assert.equal(recovered.replayStatus, 'uncertain')
    assert.equal(recovered.stored, 'uncertain', 'recovery state is itself durable after an OS process restart')
  })

  test(`${backend}: completed result stays private; pending attempt recovers uncertain and exact replay does not execute`, () => {
    const file = join(ROOT, `attempts-${backend}`)
    const seeded = output(boot(file, backend, `
      const { delegatedJudgmentId } = await import(${JSON.stringify(identityModule)});
      const owner = store.defaultTenantId();
      const project = store.createProject({ name: 'Delegated judgment persistence' }, owner).project.id;
      store.applyRelationOp({ kind: 'share-project', projectId: project, projectName: 'Delegated judgment persistence', shared: true }, owner);
      const contribution = store.openContribution(project, { title: 'Persisted judgment' }, owner, undefined);
      store.crystallizeContribution(project, contribution.id, { entries: [{ kind: 'note', target: 'frozen', after: 'frozen content' }] }, owner, undefined);
      const state = loadState();
      const row = state.contributions.find(entry => entry.id === contribution.id);
      const reviewer = { agentId: 'private-agent', agentRevision: 2, providerId: 'private-provider', providerRevision: 3, connectionRevision: 4 };
      const completeKey = 'completed-key';
      const pendingKey = 'pending-key';
      const completeId = delegatedJudgmentId(owner, project, contribution.id, 'persisted-delegation', completeKey);
      const pendingId = delegatedJudgmentId(owner, project, contribution.id, 'persisted-delegation', pendingKey);
      const common = {
        delegationId: 'persisted-delegation', delegationRevision: 0, actKind: 'land', mode: 'draft',
        changesetVersion: 1, envelopeVersion: null, reviewer: 'Private reviewer', provider: 'Private provider',
        model: 'fixture-model', delegationCreatedAt: 50, tenantId: owner,
        request: { expectedDelegationRevision: 0, expectedChangesetVersion: 1, expectedEnvelopeVersion: null, reviewer },
        contextHash: 'a'.repeat(64),
      };
      row.judgmentAttempts = [
        { ...common, id: completeId, startedAt: 100, finishedAt: 101, status: 'draft', decision: 'approve', summary: 'Owner-only policy explanation.' },
        { ...common, id: pendingId, startedAt: 200, status: 'pending' },
      ];
      saveState(state);
      console.log(JSON.stringify({ owner, project, contributionId: contribution.id, completeId, pendingId, completeKey, pendingKey, reviewer }));
    `))

    const recovered = output(boot(file, backend, `
      const contribution = store.listContributions(${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.owner)})
        .find(row => row.id === ${JSON.stringify(seeded.contributionId)});
      const replay = await store.runDelegatedModelJudgment(
        ${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.contributionId)}, 'persisted-delegation',
        ${JSON.stringify(seeded.owner)}, undefined, ${JSON.stringify(seeded.pendingId)},
        { expectedDelegationRevision: 0, expectedChangesetVersion: 1, expectedEnvelopeVersion: null,
          reviewer: ${JSON.stringify(seeded.reviewer)} },
      );
      console.log(JSON.stringify({ contribution, replay }));
    `))

    const completed = recovered.contribution.judgments.find((run: any) => run.id === seeded.completeId)
    const pending = recovered.contribution.judgments.find((run: any) => run.id === seeded.pendingId)
    assert.equal(completed.status, 'draft')
    assert.equal(completed.summary, 'Owner-only policy explanation.')
    assert.equal(pending.status, 'uncertain', 'restart recovery settles rather than replays provider work')
    assert.equal(recovered.replay.judgments.find((run: any) => run.id === seeded.pendingId).status, 'uncertain')
    for (const run of [completed, pending]) {
      for (const privateField of ['tenantId', 'request', 'delegationCreatedAt', 'contextHash']) {
        assert.equal(Object.hasOwn(run, privateField), false, `public result strips ${privateField}`)
      }
    }

    const shared = output(boot(file, backend, `
      const contribution = store.listContributions(${JSON.stringify(seeded.project)}, 'tenant-delegated-judgment-reader')
        .find(row => row.id === ${JSON.stringify(seeded.contributionId)});
      console.log(JSON.stringify(contribution));
    `))
    const sharedRun = shared.judgments.find((run: any) => run.id === seeded.completeId)
    assert.equal(sharedRun.status, 'draft')
    assert.equal(Object.hasOwn(sharedRun, 'summary'), false, 'a shared reader sees status, not private policy-derived prose')
    const durable = output(boot(file, backend, `
      const state = loadState();
      const runs = state.contributions.find(row => row.id === ${JSON.stringify(seeded.contributionId)}).judgmentAttempts;
      console.log(JSON.stringify(runs));
    `))
    assert.equal(durable.find((run: any) => run.id === seeded.pendingId).status, 'uncertain', 'recovery itself commits before reads')
  })

  test(`${backend}: malformed judgment provenance and impossible result combinations refuse snapshot admission`, () => {
    const file = join(ROOT, `admission-${backend}`)
    const cases = output(boot(file, backend, `
      const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
      const owner = store.defaultTenantId();
      const project = store.createProject({ name: 'Judgment admission' }, owner).project.id;
      const contribution = store.openContribution(project, { title: 'Admission row' }, owner, undefined);
      store.crystallizeContribution(project, contribution.id, { entries: [{ kind: 'note', target: 'admission', after: 'content' }] }, owner, undefined);
      const state = loadState();
      const row = state.contributions.find(item => item.id === contribution.id);
      const base = {
        id: 'delegated-judgment-aaaaaaaaaaaaaaaaaaaaaaaa', delegationId: 'delegation', delegationRevision: 0,
        actKind: 'land', mode: 'draft', changesetVersion: 1, envelopeVersion: null,
        reviewer: 'Reviewer', provider: 'Provider', model: 'Model', startedAt: 100, finishedAt: 101,
        status: 'draft', decision: 'approve', summary: 'Valid private result.', tenantId: owner,
        request: { expectedDelegationRevision: 0, expectedChangesetVersion: 1, expectedEnvelopeVersion: null,
          reviewer: { agentId: 'agent', agentRevision: 1, providerId: 'provider', providerRevision: 1, connectionRevision: 1 } },
        delegationCreatedAt: 10, contextHash: 'b'.repeat(64),
      };
      row.judgmentAttempts = [base];
      const valid = hasCorePersistedShape(state);
      const check = mutate => { const copy = structuredClone(state); mutate(copy.contributions.find(item => item.id === contribution.id).judgmentAttempts[0]); return hasCorePersistedShape(copy); };
      console.log(JSON.stringify({ valid, missingRequest: check(run => { delete run.request; }),
        wrongHash: check(run => { run.contextHash = 'bad'; }), badRevision: check(run => { run.request.expectedDelegationRevision = -1; }),
        pendingWithResult: check(run => { run.status = 'pending'; delete run.finishedAt; }),
        decidedInDraft: check(run => { run.status = 'decided'; run.mode = 'draft'; }), extraSecret: check(run => { run.endpoint = 'https://private.invalid'; }) }));
    `))
    assert.deepEqual(cases, {
      valid: true,
      missingRequest: false,
      wrongHash: false,
      badRevision: false,
      pendingWithResult: false,
      decidedInDraft: false,
      extraSecret: false,
    })
  })
}
