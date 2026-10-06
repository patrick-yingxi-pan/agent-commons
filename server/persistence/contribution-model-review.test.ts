/** Contribution reviewer receipts are durable, private, and never replay a
 * potentially paid request after restart. Both production persistence backends
 * share admission and recovery semantics. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-contribution-review-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const formatModule = new URL('./format.ts', import.meta.url).href
const reviewStateModule = new URL('../contributionReviewState.ts', import.meta.url).href
const reviewIdentityModule = new URL('../contributionReviewIdentity.ts', import.meta.url).href

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
  test(`${backend}: completed review survives restart, pending recovers uncertain, and retries do not dispatch`, () => {
    const file = join(ROOT, `reviews-${backend}`)
    const seeded = output(boot(file, backend, `
      const { contributionReviewId } = await import(${JSON.stringify(reviewIdentityModule)});
      const { reviewChangesetHash } = await import(${JSON.stringify(reviewStateModule)});
      const owner = store.defaultTenantId();
      const project = store.createProject({ name: 'Review persistence fixture' }, owner).project.id;
      const completed = store.openContribution(project, { title: 'Completed review' }, owner, undefined);
      store.crystallizeContribution(project, completed.id, { entries: [{ kind: 'note', target: 'completed', after: 'accepted body' }] }, owner, undefined);
      const interrupted = store.openContribution(project, { title: 'Interrupted review' }, owner, undefined);
      store.crystallizeContribution(project, interrupted.id, { entries: [{ kind: 'note', target: 'interrupted', after: 'frozen body' }] }, owner, undefined);
      const binding = { agentId: 'private-reviewer-agent', agentRevision: 4, providerId: 'private-provider-id', providerRevision: 7, connectionRevision: 2 };
      const state = loadState();
      const completedRow = state.contributions.find(row => row.id === completed.id);
      const interruptedRow = state.contributions.find(row => row.id === interrupted.id);
      const completedId = contributionReviewId(owner, project, completed.id, 'completed-key');
      const pendingId = contributionReviewId(owner, project, interrupted.id, 'pending-key');
      const completedVersion = completedRow.changeset.at(-1);
      const pendingVersion = interruptedRow.changeset.at(-1);
      completedRow.reviewAttempts = [{
        id: completedId, version: 1, tenantId: owner, binding, changesetHash: reviewChangesetHash(completedVersion),
        reviewer: 'Selected reviewer', provider: 'Selected provider', model: 'review-model',
        startedAt: 100, finishedAt: 101, status: 'passed', summary: 'No concrete issue found.', findings: [],
      }];
      interruptedRow.reviewAttempts = [{
        id: pendingId, version: 1, tenantId: owner, binding, changesetHash: reviewChangesetHash(pendingVersion),
        reviewer: 'Selected reviewer', provider: 'Selected provider', model: 'review-model', startedAt: 200, status: 'pending',
      }];
      saveState(state);
      console.log(JSON.stringify({ owner, project, completedId, completedCid: completed.id, pendingId, pendingCid: interrupted.id, binding }));
    `))

    const recovered = output(boot(file, backend, `
      const completed = store.listContributions(${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.owner)}).find(row => row.id === ${JSON.stringify(seeded.completedCid)});
      const pending = store.listContributions(${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.owner)}).find(row => row.id === ${JSON.stringify(seeded.pendingCid)});
      const retry = await store.runContributionModelReview(${JSON.stringify(seeded.project)}, ${JSON.stringify(seeded.pendingCid)}, ${JSON.stringify(seeded.owner)}, ${JSON.stringify(seeded.pendingId)}, 1, ${JSON.stringify(seeded.binding)});
      const recoveredRetry = typeof retry === 'object' ? retry.reviews.find(run => run.id === ${JSON.stringify(seeded.pendingId)}) : undefined;
      console.log(JSON.stringify({ completed, pending, recoveredRetry }));
    `))

    const completeRun = recovered.completed.reviews.find((run: any) => run.id === seeded.completedId)
    assert.equal(completeRun.status, 'passed')
    assert.equal(completeRun.summary, 'No concrete issue found.')
    assert.deepEqual(completeRun.findings, [])
    assert.equal(recovered.pending.reviews.find((run: any) => run.id === seeded.pendingId).status, 'uncertain')
    assert.equal(recovered.recoveredRetry.status, 'uncertain', 'exact Retry returns recovered receipt truth without model dispatch')

    for (const run of [completeRun, recovered.pending.reviews.find((row: any) => row.id === seeded.pendingId)]) {
      assert.equal(Object.hasOwn(run, 'tenantId'), false)
      assert.equal(Object.hasOwn(run, 'binding'), false)
      assert.equal(Object.hasOwn(run, 'changesetHash'), false)
    }

    const durable = output(boot(file, backend, `
      const state = loadState();
      const completed = state.contributions.find(row => row.id === ${JSON.stringify(seeded.completedCid)}).reviewAttempts[0];
      const pending = state.contributions.find(row => row.id === ${JSON.stringify(seeded.pendingCid)}).reviewAttempts[0];
      console.log(JSON.stringify({ completed, pending }));
    `))
    assert.equal(durable.completed.status, 'passed')
    assert.equal(durable.pending.status, 'uncertain', 'the recovery transition itself is committed before startup admission')
  })

  test(`${backend}: present review attempts reject malformed private anchors, hashes, statuses, and results`, () => {
    const file = join(ROOT, `admission-${backend}`)
    const cases = output(boot(file, backend, `
      const { hasCorePersistedShape } = await import(${JSON.stringify(formatModule)});
      const { reviewChangesetHash } = await import(${JSON.stringify(reviewStateModule)});
      const owner = store.defaultTenantId();
      const project = store.createProject({ name: 'Review admission fixture' }, owner).project.id;
      const contribution = store.openContribution(project, { title: 'Review admission' }, owner, undefined);
      store.crystallizeContribution(project, contribution.id, { entries: [{ kind: 'note', target: 'admission', after: 'text' }] }, owner, undefined);
      const state = loadState();
      const row = state.contributions.find(candidate => candidate.id === contribution.id);
      const baseRun = {
        id: 'contribution-review-aaaaaaaaaaaaaaaaaaaaaaaa', version: 1, tenantId: owner,
        binding: { agentId: 'agent', agentRevision: 1, providerId: 'provider', providerRevision: 1, connectionRevision: 1 },
        changesetHash: reviewChangesetHash(row.changeset[0]), reviewer: 'Reviewer', provider: 'Provider', model: 'Model',
        startedAt: 10, finishedAt: 11, status: 'passed', summary: 'Looks good.', findings: [],
      };
      const valid = () => structuredClone(state);
      const invalid = mutate => { const next = valid(); mutate(next.contributions.find(candidate => candidate.id === contribution.id).reviewAttempts[0]); return hasCorePersistedShape(next); };
      row.reviewAttempts = [baseRun];
      const validAdmission = hasCorePersistedShape(state);
      const missingTenant = invalid(run => { delete run.tenantId; });
      const extraPrivateField = invalid(run => { run.endpoint = 'https://must-not-persist'; });
      const badBinding = invalid(run => { run.binding.agentRevision = -1; });
      const wrongHash = invalid(run => { run.changesetHash = '0'.repeat(64); });
      const invalidStatus = invalid(run => { run.status = 'running'; });
      const pendingWithResult = invalid(run => { run.status = 'pending'; delete run.finishedAt; run.summary = 'cannot accompany pending'; });
      const passedWithFinding = invalid(run => { run.findings = [{ entryId: 'not-an-entry', body: 'foreign' }]; });
      const duplicateFinding = invalid(run => { run.findings = [{ entryId: row.changeset[0].entries[0].id, body: 'one' }, { entryId: row.changeset[0].entries[0].id, body: 'two' }]; });
      console.log(JSON.stringify({ validAdmission, missingTenant, extraPrivateField, badBinding, wrongHash, invalidStatus, pendingWithResult, passedWithFinding, duplicateFinding }));
    `))

    assert.equal(cases.validAdmission, true)
    assert.deepEqual({
      missingTenant: cases.missingTenant,
      extraPrivateField: cases.extraPrivateField,
      badBinding: cases.badBinding,
      wrongHash: cases.wrongHash,
      invalidStatus: cases.invalidStatus,
      pendingWithResult: cases.pendingWithResult,
      passedWithFinding: cases.passedWithFinding,
      duplicateFinding: cases.duplicateFinding,
    }, {
      missingTenant: false,
      extraPrivateField: false,
      badBinding: false,
      wrongHash: false,
      invalidStatus: false,
      pendingWithResult: false,
      passedWithFinding: false,
      duplicateFinding: false,
    })
  })
}
