import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddedContext, Artifact, WorkspaceFolder } from '../types.ts'
import { addContextToLive, bindingsFor, detachOperationsForFocuses, EMPTY_LIVE, focusForAdded, removeFolderFromLive, WS_ID } from './liveSession.ts'
import type { Live } from './liveSession.ts'

const folder = (sourceId: string, path: string, label: string): WorkspaceFolder => ({
  id: `${sourceId}::${path}`, label,
  snapshot: { version: 1, snapshotId: sourceId === 'cloud' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', capturedAt: '2026-10-04T12:00:00.000Z', sourceId, path, files: [] },
})
const context = (record: WorkspaceFolder, artifacts: Artifact[] = []): AddedContext => ({
  kind: 'folder', label: record.label, artifacts, folder: record,
  source: { id: record.snapshot!.sourceId, kind: record.snapshot!.sourceId === 'cloud' ? 'cloud' : 'runner', label: record.snapshot!.sourceId },
})

test('empty served folders bind by explicit source-qualified identity across sources', () => {
  const cloud = context(folder('cloud', 'empty', 'Cloud empty'))
  const runner = context(folder('runner:one', 'empty', 'Runner empty'))
  assert.equal(bindingsFor(cloud)[0]?.id, 'cloud::empty')
  assert.equal(bindingsFor(runner)[0]?.id, 'runner:one::empty')
})

test('adds captured folders without duplicating projected artifacts or existing folder IDs', () => {
  const first = folder('cloud', 'docs', 'Cloud docs')
  const ctx = context(first, [{ id: 'cloud::docs/a.txt', name: 'a.txt', kind: 'doc', meta: '', source: { id: first.id, label: first.label } }])
  const live = addContextToLive(EMPTY_LIVE, ctx)
  assert.deepEqual(live.workspaces[0]?.folders, [first])
  assert.deepEqual(live.workspaces[0]?.artifacts, [])
  assert.equal(addContextToLive(live, { ...ctx, folder: { ...first, label: 'Changed label' } }).workspaces[0]?.folders?.length, 1)
})

test('local explicit folders retain their artifact snapshots and attach into the shared workspace', () => {
  const record = { id: 'ui-host::picked', label: 'Picked/' }
  const localArtifact: Artifact = { id: 'local-file', name: 'a.md', kind: 'doc', meta: '', source: record, localSnapshot: { text: 'saved local text' } }
  const live = addContextToLive(EMPTY_LIVE, { kind: 'folder', label: 'Picked', folder: record, source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' }, artifacts: [localArtifact] })
  assert.deepEqual(live.workspaces[0]?.folders, [record])
  assert.deepEqual(live.workspaces[0]?.artifacts, [localArtifact])
})

test('workspace detach includes explicit folder bindings even when there are no artifacts', () => {
  const record = folder('runner:one', 'empty', 'Empty')
  const live = addContextToLive(EMPTY_LIVE, context(record))
  assert.deepEqual(detachOperationsForFocuses(live, [{ kind: 'workspace', id: WS_ID }]), [
    { action: 'detach', contextId: WS_ID }, { action: 'detach', contextId: record.id },
  ])
})

test('adding and removing a served folder preserves other workspaces and local artifacts', () => {
  const existing = { id: 'existing', label: 'Existing', artifacts: [{ id: 'local', name: 'local.md', kind: 'doc' as const, meta: '' }] }
  const untouched = { id: 'untouched', label: 'Untouched empty', artifacts: [] }
  const live: Live = { ...EMPTY_LIVE, workspaces: [existing, untouched] }
  const a = folder('cloud', 'a', 'A')
  const b = folder('runner:one', 'b', 'B')
  const added = addContextToLive(addContextToLive(live, context(a)), context(b))
  assert.equal(added.workspaces.length, 2)
  const removed = removeFolderFromLive(added, a.id)
  assert.equal(removed.workspaces[0]?.artifacts[0]?.id, 'local')
  assert.equal(removed.workspaces[0]?.folders?.some((item) => item.id === a.id), false)
  assert.equal(removed.workspaces[0]?.folders?.some((item) => item.id === b.id), true)
  assert.deepEqual(removed.workspaces[1], untouched)
})

test('focus resolves the shared workspace that actually received the folder', () => {
  const record = folder('cloud', 'focus', 'Focus')
  const unrelated = { id: 'unrelated', label: 'Unrelated', artifacts: [] }
  const after = addContextToLive({ ...EMPTY_LIVE, workspaces: [unrelated] }, context(record))
  assert.deepEqual(focusForAdded(context(record), after), { kind: 'workspace', id: unrelated.id })
})

test('removal leaves an untouched empty workspace alone', () => {
  const record = folder('cloud', 'remove', 'Remove')
  const addressed = { id: 'addressed', label: 'Addressed empty', artifacts: [] }
  const untouched = { id: 'untouched-empty', label: 'Empty', artifacts: [] }
  const afterAdd = addContextToLive({ ...EMPTY_LIVE, workspaces: [addressed, untouched] }, context(record))
  const afterRemove = removeFolderFromLive(afterAdd, record.id)
  assert.deepEqual(afterRemove.workspaces, [untouched])
})

test('removing the last folder retains authored artifacts but removes an otherwise empty shared workspace', () => {
  const only = folder('cloud', 'only', 'Only')
  const withLocal = addContextToLive(EMPTY_LIVE, context(only))
  withLocal.workspaces[0]!.artifacts.push({ id: 'authored', name: 'authored', kind: 'doc', meta: '' })
  assert.equal(removeFolderFromLive(withLocal, only.id).workspaces[0]?.artifacts[0]?.id, 'authored')
  assert.deepEqual(removeFolderFromLive(addContextToLive(EMPTY_LIVE, context(only)), only.id).workspaces, [])
})

test('legacy local folder intake still merges artifacts without dropping other workspaces', () => {
  const localArtifact: Artifact = { id: 'ui-host::folder/a.md', name: 'a.md', kind: 'doc', meta: '', source: { id: 'ui-host::folder', label: 'folder/' }, localSnapshot: { text: 'saved local body' } }
  const shared = { id: WS_ID, label: 'Workspace', artifacts: [{ id: 'existing', name: 'existing', kind: 'doc' as const, meta: '' }] }
  const other = { id: 'other', label: 'Other', artifacts: [{ id: 'existing', name: 'existing', kind: 'doc' as const, meta: '' }] }
  const before: Live = { ...EMPTY_LIVE, workspaces: [shared, other] }
  const ctx = { kind: 'folder', label: 'folder/', artifacts: [localArtifact] } as AddedContext
  const after = addContextToLive(before, ctx)
  assert.deepEqual(after.workspaces[0]?.artifacts, [shared.artifacts[0], localArtifact])
  assert.deepEqual(after.workspaces[1], other)
  assert.equal(after.workspaces.length, 2)
})
