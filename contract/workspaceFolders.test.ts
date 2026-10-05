import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Workspace } from './entities.ts'
import { isWorkspaceFolder, replaceLocalFolderSnapshot, replaceLocalGitSnapshot, replaceServedFolderSnapshot, validWorkspaceFolders, workspaceArtifactKey, workspaceArtifacts, workspaceFolders } from './workspaceFolders.ts'
import { workspaceInputAttachments } from './attachmentInput.ts'

const snapshot = { version: 1 as const, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'docs', files: [{ name: 'a.txt', sizeBytes: 4, snapshot: { text: 'body' } }, { name: 'b.png', sizeBytes: 8, snapshot: { omitted: 'unsupported' as const } }] }

test('folder selection survives legacy ID migration but never crosses folder or authored identity', () => {
  const legacy = { id: 'docs/a.txt', name: 'a.txt', source: { id: 'cloud::docs', label: 'docs' } }
  const key = workspaceArtifactKey(legacy)
  assert.equal(workspaceArtifactKey({ ...legacy, id: 'cloud::docs/a.txt' }), key)
  assert.notEqual(workspaceArtifactKey({ ...legacy, source: { ...legacy.source, id: 'runner::docs' } }), key)
  assert.notEqual(workspaceArtifactKey({ ...legacy, source: undefined }), key)
  assert.notEqual(workspaceArtifactKey({ ...legacy, name: 'b.txt' }), key)
})

test('validates closed folder rows additively while accepting legacy workspaces', () => {
  assert.equal(isWorkspaceFolder({ id: 'cloud::docs', label: 'docs' }), true)
  assert.equal(isWorkspaceFolder({ id: 'cloud::other', label: 'docs', snapshot }), false)
  assert.equal(isWorkspaceFolder({ id: 'cloud::docs', label: 'docs', snapshot }), true)
  assert.equal(isWorkspaceFolder({ id: 'x', label: 'x', unknown: true }), false)
  assert.equal(validWorkspaceFolders([{ id: 'legacy' }]), true)
  assert.equal(validWorkspaceFolders([{ folders: [{ id: 'x', label: 'x' }] }, { folders: [{ id: 'x', label: 'duplicate' }] }]), false)
  assert.equal(validWorkspaceFolders([{ folders: [{ id: 'x', label: 'x', snapshot: { ...snapshot, extra: 1 } }] }]), false)
})

test('legacy folder identity is unique across containers, including mixed explicit and derived records', () => {
  const source = { id: 'cloud::docs', label: 'docs' }
  const legacy = { id: 'legacy', artifacts: [
    { id: 'a', name: 'a.md', kind: 'doc', meta: '', source },
    { id: 'b', name: 'b.md', kind: 'doc', meta: '', source },
  ] }
  assert.equal(validWorkspaceFolders([legacy]), true, 'multiple files are one folder, not duplicate identities')
  assert.equal(validWorkspaceFolders([legacy, { ...legacy, id: 'other' }]), false)
  assert.equal(validWorkspaceFolders([legacy, { folders: [source] }]), false)
  assert.equal(validWorkspaceFolders([{ ...legacy, folders: [source] }]), true, 'explicit and legacy rows in one container coalesce')
  assert.equal(validWorkspaceFolders([legacy, { folders: [{ ...source, id: 'runner:host::docs' }] }]), true)
})

test('projects saved file rows and replaces only the chosen served folder', () => {
  const legacy = { id: 'cloud::docs', label: 'docs', artifacts: [{ id: 'old', name: 'a.txt', kind: 'doc' as const, meta: 'live', source: { id: 'cloud::docs', label: 'docs' } }, { id: 'authored', name: 'note', kind: 'doc' as const, meta: '' }] } satisfies Workspace
  assert.deepEqual(workspaceFolders(legacy).map((folder) => folder.id), ['cloud::docs'])
  const ordered = { ...legacy, folders: [{ id: 'before', label: 'before' }, { id: 'cloud::docs', label: 'docs' }, { id: 'after', label: 'after' }] }
  const next = replaceServedFolderSnapshot(ordered, 'cloud::docs', snapshot)
  assert.deepEqual(next.folders?.map((folder) => folder.id), ['before', 'cloud::docs', 'after'])
  assert.equal(next.artifacts.some((artifact) => artifact.id === 'old'), false)
  assert.equal(next.artifacts.some((artifact) => artifact.id === 'authored'), true)
  const projection = workspaceArtifacts(next)
  assert.equal(projection.find((artifact) => artifact.name === 'a.txt')?.savedFolderSnapshotId, snapshot.snapshotId)
  assert.equal(projection.find((artifact) => artifact.name === 'a.txt')?.savedFolderSnapshot?.text, 'body')
  assert.equal(projection.find((artifact) => artifact.name === 'b.png')?.kind, 'image')
  assert.equal(projection.find((artifact) => artifact.name === 'b.png')?.savedFolderSnapshot?.text, undefined)
})

test('local folder capture projects saved rows without carrying a path or coexisting with served capture', () => {
  const localSnapshot = {
    version: 1 as const,
    snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    capturedAt: '2026-10-04T12:00:00.000Z',
    connectionId: 'LOCAL_0123456789ABCDEF0123456789ABCDEF',
    files: [{ name: 'local.md', sizeBytes: 5, snapshot: { text: 'local' } }],
  }
  const folderId = 'ui-host::LOCAL_0123456789ABCDEF0123456789ABCDEF'
  const workspace = { id: 'w', label: 'Workspace', artifacts: [{ id: 'old', name: 'local.md', kind: 'doc' as const, meta: '', source: { id: folderId, label: 'Local' } }] }
  const next = replaceLocalFolderSnapshot(workspace, folderId, localSnapshot)
  assert.equal(validWorkspaceFolders([next]), true)
  assert.deepEqual(next.artifacts, [])
  assert.deepEqual(workspaceArtifacts(next).map((artifact) => [artifact.name, artifact.savedFolderSnapshot, artifact.savedFolderSnapshotId]), [
    ['local.md', { text: 'local' }, localSnapshot.snapshotId],
  ])
  assert.equal(validWorkspaceFolders([{ folders: [{ id: folderId, label: 'Local', snapshot, localSnapshot }] }]), false)
  assert.equal(validWorkspaceFolders([{ folders: [{ id: 'ui-host::other', label: 'Local', localSnapshot }] }]), false)
  assert.equal(JSON.stringify(next).includes('/Users/'), false)
})

test('Local Git capture projects nested tracked dotfiles as saved-only model input', () => {
  const gitSnapshot = {
    version: 1 as const, snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    capturedAt: '2026-10-04T12:00:00.000Z', connectionId: 'GIT_0123456789ABCDEF0123456789ABCDEF',
    files: [
      { path: '.github/workflows/check.yml', sizeBytes: 4, snapshot: { text: 'test' } },
      { path: 'src/main.ts', sizeBytes: 3, snapshot: { omitted: 'unsupported' as const } },
    ],
  }
  const folderId = 'ui-host::GIT_0123456789ABCDEF0123456789ABCDEF'
  const old = { id: 'w', label: 'Workspace', artifacts: [{ id: 'old', name: 'main.ts', kind: 'doc' as const, meta: '', source: { id: folderId, label: 'Agent Commons' } }] }
  const next = replaceLocalGitSnapshot(old, folderId, gitSnapshot)
  assert.equal(validWorkspaceFolders([next]), true)
  assert.equal(next.artifacts.length, 0)
  const projection = workspaceArtifacts(next)
  assert.deepEqual(projection.map((artifact) => [artifact.name, artifact.savedFolderSnapshot]), [
    ['.github/workflows/check.yml', { text: 'test' }], ['src/main.ts', { omitted: 'unsupported' }],
  ])
  assert.equal(projection[0]?.id, `${folderId}/.github/workflows/check.yml`)
  const input = workspaceInputAttachments({ attachments: [], workspaces: [next] })
  assert.deepEqual(input.map((item) => [item.label, item.previewText]), [
    ['Agent Commons/.github/workflows/check.yml', 'test'], ['Agent Commons/src/main.ts', undefined],
  ])
  assert.equal(JSON.stringify(next).includes('/Users/'), false)
  assert.equal(isWorkspaceFolder({ id: folderId, label: 'Agent Commons', gitSnapshot, localSnapshot: { version: 1 } }), false)
})
