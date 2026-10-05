import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasCorePersistedShape, STORE_VERSION } from './format.ts'
import { readPortableSnapshot, restoreBackendState, writePortableSnapshot } from './portable.ts'
import type { PersistedState } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `agent-commons-artifact-deletion-${process.pid}-`))
const storeModule = new URL('../store/index.ts', import.meta.url).href
const persistenceModule = new URL('./persist.ts', import.meta.url).href
const identityModule = new URL('../artifactCreationIdentity.ts', import.meta.url).href
after(() => rmSync(ROOT, { recursive: true, force: true }))

function boot(file: string, backend: 'json' | 'sqlite', work: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const { store } = await import(${JSON.stringify(storeModule)});
    const { loadState, closePersistence } = await import(${JSON.stringify(persistenceModule)});
    const { artifactCreationId } = await import(${JSON.stringify(identityModule)});
    store.initPersistence();
    ${work}
    console.log(JSON.stringify({ state: globalThis.skipState ? null : loadState(), report: globalThis.report ?? null }));
    closePersistence();
  `], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, INITIAL_WORLD: 'clean', BACKEND: 'mock', PERSIST_BACKEND: backend, DATA_FILE: file, DATABASE_PATH: file },
  })
}

function stateOf(result: ReturnType<typeof boot>): { state: PersistedState; report: any } {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim())
}

function base(): PersistedState {
  return {
    version: STORE_VERSION,
    initialWorld: 'clean',
    sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
      scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
    artifactRetirements: [{ artifactId: 'art-deleted', tenantId: 'tenant-deletion-owner',
      discussionIds: ['discussion-deleted'], proposalIds: ['proposal-deleted'] }],
    artifactDeletionReceipts: [[JSON.stringify(['tenant-deletion-owner', 'user-owner', 'a'.repeat(64)]), {
      tenantId: 'tenant-deletion-owner', userId: 'user-owner', artifactId: 'art-deleted', keyHash: 'a'.repeat(64),
      expectedLifecycleRevision: 4, reviewTokenHash: 'b'.repeat(64),
    }]],
  } as PersistedState
}

test('portable deletion tombstones and exact receipts round-trip, but live references fail closed', () => {
  const valid = base()
  assert.equal(hasCorePersistedShape(valid), true)
  const directory = mkdtempSync(join(tmpdir(), 'artifact-deletion-portable-'))
  const path = join(directory, 'state.json')
  try {
    writePortableSnapshot(path, valid)
    assert.deepEqual(readPortableSnapshot(path), valid)
    const malformed = {
      ...valid,
      graph: { ...valid.graph, extraArtifacts: [{ id: 'art-deleted', name: 'resurrected.md', kind: 'doc', projectId: null, source: 'x', meta: 'x', excerpt: 'x', editedAt: 0 }] },
    } as PersistedState
    assert.equal(hasCorePersistedShape(malformed), false, 'a portable state cannot contain both a tombstone and the live identity')
    writeFileSync(path, JSON.stringify(malformed))
    assert.throws(() => readPortableSnapshot(path), /unsupported or invalid/)
    assert.equal(readFileSync(path, 'utf8'), JSON.stringify(malformed), 'admission never mutates rejected backup bytes')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('present malformed retirement/receipt slices are not treated as legacy absence', () => {
  const valid = base()
  assert.equal(hasCorePersistedShape({ ...valid, artifactRetirements: null } as unknown as PersistedState), false)
  assert.equal(hasCorePersistedShape({ ...valid, artifactRetirements: [{ ...valid.artifactRetirements![0]!, discussionIds: ['z', 'a'] }] } as PersistedState), false)
  assert.equal(hasCorePersistedShape({ ...valid, artifactRetirements: [{ ...valid.artifactRetirements![0]!, proposalIds: ['proposal-deleted', 'proposal-deleted'] }] } as PersistedState), false)
  assert.equal(hasCorePersistedShape({ ...valid, artifactDeletionReceipts: [['wrong-key', valid.artifactDeletionReceipts![0]![1]]] } as PersistedState), false)
  assert.equal(hasCorePersistedShape({ ...valid, artifactDeletionReceipts: [[valid.artifactDeletionReceipts![0]![0], { ...valid.artifactDeletionReceipts![0]![1], artifactId: 'other' }]] } as PersistedState), false)
  assert.equal(hasCorePersistedShape({
    ...valid,
    notifications: [{ id: 'private-retired-bell', kind: 'social.shared', at: 1, read: false, actor: 'Ada',
      tenantId: 'tenant-deletion-reader', subjectKind: 'artifact', subjectId: 'art-deleted', subjectName: 'Private deleted title' }],
  } as PersistedState), false, 'a retired private Artifact cannot survive through a persisted notification label')
})

test('retired opaque descendant IDs reject orphan social references in portable snapshots', () => {
  const valid = base()
  assert.equal(hasCorePersistedShape(valid), true)
  const discussionId = 'discussion-deleted'
  const proposalId = 'proposal-deleted'
  const malformedStates: Array<[string, PersistedState]> = [
    ['notification', {
      ...valid,
      notifications: [{ id: 'orphan-notification', kind: 'social.discussed', at: 1, read: false, actor: 'Reader',
        tenantId: 'tenant-reader', subjectKind: 'discussion', subjectId: discussionId, subjectName: 'Private title' }],
    } as PersistedState],
    ['grant', {
      ...valid,
      grants: [{ id: 'orphan-grant', subject: { kind: 'discussion', id: discussionId }, audience: { kind: 'org', orgId: 'org-reader' },
        tier: 'view', grantedBy: 'Owner', grantedAt: 1, granterTenant: 'tenant-deletion-owner', audienceTenant: 'tenant-reader' }],
    } as PersistedState],
    ['watch', { ...valid, watches: [['tenant-reader', `discussion:${discussionId}`]] } as PersistedState],
    ['root Artifact watch', { ...valid, watches: [['tenant-reader', 'artifact:art-deleted']] } as PersistedState],
    ['like', { ...valid, commonsLikes: [['tenant-reader', `landing:${proposalId}`]] } as PersistedState],
    ['view', { ...valid, views: [['tenant-reader', 'proposal', proposalId, 1]] } as PersistedState],
    ['root Artifact view', { ...valid, views: [['tenant-reader', 'artifact', 'art-deleted', 1]] } as PersistedState],
    ['read mark', { ...valid, discussionReads: [['tenant-reader', [[discussionId, 1]]]] } as PersistedState],
  ]
  for (const [label, malformed] of malformedStates) {
    assert.equal(hasCorePersistedShape(malformed), false, `a retired nested subject cannot survive through an orphan ${label}`)
  }
})

test('portable retirement admits and round-trips a lawful cascade with more than ten thousand opaque IDs', () => {
  const state = base()
  const discussionIds = Array.from({ length: 10_001 }, (_, index) => `discussion-${String(index).padStart(5, '0')}`)
  state.artifactRetirements![0] = { ...state.artifactRetirements![0]!, discussionIds, proposalIds: [] }
  assert.equal(hasCorePersistedShape(state), true, 'nested discussion chains have no global count cap')
  const directory = mkdtempSync(join(tmpdir(), 'artifact-deletion-large-cascade-'))
  const path = join(directory, 'state.json')
  try {
    writePortableSnapshot(path, state)
    const restored = readPortableSnapshot(path)
    assert.equal(restored.artifactRetirements?.[0]?.discussionIds?.length, 10_001)
    assert.equal(hasCorePersistedShape(restored), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const backend of ['json', 'sqlite'] as const) {
  test(`${backend}: permanent deletion receipt and retired identity survive a real process restart`, () => {
    const file = join(ROOT, `restart-${backend}`)
    const owner = `tenant-deletion-restart-${backend}`
    const user = `user-deletion-restart-${backend}`
    const key = `delete-restart-${backend}`
    const initial = stateOf(boot(file, backend, `
      const owner = ${JSON.stringify(owner)};
      const id = artifactCreationId(owner, ${JSON.stringify(key)});
      const created = store.createArtifact({ name: 'retired-restart.md', kind: 'doc', body: 'Retained before deletion.' }, owner, id);
      if (!created || created === 'invalid') throw new Error('fixture creation failed');
      store.updateArtifactBlock(id, 0, 'Edited before deletion.', 0);
      store.setArtifactLifecycle(id, 'trashed', 0, owner);
      const preview = store.previewArtifactDeletion(id, owner);
      if (!preview) throw new Error('fixture preview failed');
      const request = { expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken };
      const result = store.permanentlyDeleteArtifact(id, request, owner, ${JSON.stringify(user)}, ${JSON.stringify(key)});
      if (!result?.deleted) throw new Error('fixture deletion failed');
      globalThis.report = { id, request, result };
    `))
    const { id, request, result } = initial.report
    assert.deepEqual(result, { artifactId: id, deleted: true })
    assert.ok(initial.state.artifactRetirements?.some((row: any) => row.artifactId === id))
    assert.equal(initial.state.artifactBodies?.some(([candidate]: [string]) => candidate === id), false)
    assert.equal(initial.state.artifactHistory?.some(([candidate]: [string]) => candidate === id), false)
    assert.equal(initial.state.artifactDeletionReceipts?.length, 1)
    assert.equal(hasCorePersistedShape(initial.state), true)

    const restarted = stateOf(boot(file, backend, `
      const id = ${JSON.stringify(id)};
      const request = ${JSON.stringify(request)};
      const replay = store.permanentlyDeleteArtifact(id, request, ${JSON.stringify(owner)}, ${JSON.stringify(user)}, ${JSON.stringify(key)});
      const changedKeyRequest = { ...request, expectedLifecycleRevision: request.expectedLifecycleRevision + 1 };
      let changedRequestConflicted = false;
      try { store.permanentlyDeleteArtifact(id, changedKeyRequest, ${JSON.stringify(owner)}, ${JSON.stringify(user)}, ${JSON.stringify(key)}); }
      catch { changedRequestConflicted = true; }
      const directReplay = store.createArtifact({ name: 'changed retry', kind: 'doc', body: 'Resurrection.' }, ${JSON.stringify(owner)}, id);
      globalThis.report = { replay, changedRequestConflicted, retired: store.artifactIsRetired(id), directReplay };
    `))
    assert.deepEqual(restarted.report, {
      replay: result, changedRequestConflicted: true, retired: true, directReplay: 'invalid',
    }, `${backend}: exact durable receipt replays while altered intent and resurrection fail closed`)
    assert.deepEqual(restarted.state, initial.state, `${backend}: restart replay appends neither another receipt nor mutation`)
    assert.equal(hasCorePersistedShape(restarted.state), true)
  })
}

test('failed durable deletion has no success acknowledgement, event, or committed receipt', () => {
  const file = join(ROOT, 'failed-commit.json')
  const beforeFailure = join(ROOT, 'failed-commit-before.json')
  const owner = 'tenant-deletion-failed-commit'
  const key = 'delete-failed-commit'
  const created = stateOf(boot(file, 'json', `
    const owner = ${JSON.stringify(owner)};
    const id = artifactCreationId(owner, ${JSON.stringify(key)});
    store.createArtifact({ name: 'failed-commit.md', kind: 'doc', body: 'Still retained.' }, owner, id);
    store.setArtifactLifecycle(id, 'trashed', 0, owner);
    globalThis.report = { id };
  `)).report
  const id = created.id
  const failed = boot(file, 'json', `
    const fs = await import('node:fs');
    const owner = ${JSON.stringify(owner)};
    const id = ${JSON.stringify(id)};
    const events = [];
    const off = store.subscribe(event => events.push(event));
    const preview = store.previewArtifactDeletion(id, owner);
    if (!preview) throw new Error('failed-commit preview missing');
    fs.renameSync(${JSON.stringify(file)}, ${JSON.stringify(beforeFailure)});
    fs.mkdirSync(${JSON.stringify(file)});
    let rejected = false;
    try {
      store.permanentlyDeleteArtifact(id, { expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken },
        owner, 'user-failed-commit', ${JSON.stringify(key)});
    } catch { rejected = true; }
    off();
    globalThis.report = { rejected, healthy: store.persistenceHealthy(), events };
    globalThis.skipState = true;
  `)
  const failedReport = stateOf(failed)
  assert.deepEqual(failedReport.report, { rejected: true, healthy: false, events: [] },
    'the store withholds success and all invalidation events when its durable write fails')
  const durable = JSON.parse(readFileSync(beforeFailure, 'utf8')) as PersistedState
  assert.equal(durable.graph.extraArtifacts.some((row: any) => row.id === id), true, 'the last committed row remains intact')
  assert.equal(durable.artifactRetirements?.some((row: any) => row.artifactId === id), false)
  assert.equal(durable.artifactDeletionReceipts?.length ?? 0, 0, 'no receipt claims the failed commit')
})

test('an explicitly restored older whole backup is an intentional rollback, not silently merged with current tombstones', () => {
  const older = base()
  const id = 'art-explicit-backup-rollback'
  older.artifactRetirements = undefined
  older.artifactDeletionReceipts = undefined
  older.graph.extraArtifacts = [{
    id, name: 'older-backup.md', kind: 'doc', projectId: null, source: 'A saved conversation',
    meta: 'Document', excerpt: 'Older backup content', editedAt: 1, tenantId: 'tenant-deletion-owner',
  }]
  older.artifactBodies = [[id, { type: 'doc', revision: 0, blocks: [{ p: 'Older backup content' }] }]]
  const current = base()
  current.artifactRetirements = [{ artifactId: id, tenantId: 'tenant-deletion-owner' }]
  current.artifactDeletionReceipts = current.artifactDeletionReceipts!.map(([key, receipt]) => [key, { ...receipt, artifactId: id }])
  assert.ok(current.artifactRetirements.some((row) => row.artifactId === id), 'the current store contains the identity being rolled back')
  let stored = current
  const backend = {
    name: 'test-backup-rollback',
    load: () => stored,
    save: (next: PersistedState) => { stored = structuredClone(next) },
    close() {},
  }
  const restored = restoreBackendState(backend, older)
  assert.equal(restored.graph.extraArtifacts.some((row) => row.id === id), true)
  assert.equal(restored.artifactRetirements?.some((row) => row.artifactId === id) ?? false, false,
    'an operator-requested older backup intentionally rolls back newer retirement state')
  assert.equal(stored.artifactBodies?.some(([candidate]) => candidate === id), true)
})
