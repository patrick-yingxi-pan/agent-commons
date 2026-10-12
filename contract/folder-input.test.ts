import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ATTACHMENT_TEXT_FILE_BYTES, planAttachmentInput, workspaceInputAttachments } from './attachmentInput.ts'
import type { Artifact, SessionWorkspace, Workspace } from './entities.ts'
import { replaceLocalFolderSnapshot } from './workspaceFolders.ts'

const folder = (artifacts: Artifact[]) => ({ attachments: [], workspaces: [{ id: 'ws', label: 'Workspace', artifacts }] })
const source = { id: 'ui-host::opaque', label: 'research/' }

test('readable folder snapshots precede metadata so binary rows cannot consume the input cap', () => {
  const metadata = Array.from({ length: 30 }, (_, i): Artifact => ({
    id: `image-${i}`, name: `${i}.png`, kind: 'image', meta: '', source, localSnapshot: { omitted: 'unsupported' },
  }))
  const text: Artifact = { id: 'text', name: 'a.md', kind: 'doc', meta: '', source, localSnapshot: { text: 'actual body' } }
  const plan = planAttachmentInput(workspaceInputAttachments(folder([...metadata, text])))
  assert.equal(plan[0].attachment.id, 'text')
  assert.equal(plan[0].status, 'ready')
  assert.equal(plan.filter((entry) => entry.status === 'ready').length, 1)
  assert.equal(plan.length, 31)
})

test('legacy, served and malformed folder artifacts never invent model text or crash generation', () => {
  const input = { attachments: [], workspaces: [null, {}, { artifacts: [null,
    { id: 'legacy', name: 'a.md', source },
    { id: 'served', name: 'b.md', source: { id: 'cloud::folder', label: 'cloud/' }, localSnapshot: { text: 'not local' } },
    { id: 'bad-source', name: 'c.md', source: { id: 1 }, localSnapshot: { text: 'invalid' } },
  ] }] } as unknown as SessionWorkspace
  assert.deepEqual(workspaceInputAttachments(input), [])
})

test('saved served-folder bodies become exact snapshot attachments after direct attachments', () => {
  const snapshot = { version: 1 as const, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'docs', files: [
    { name: 'a.txt', sizeBytes: 4, snapshot: { text: 'body' } },
    { name: 'z.bin', sizeBytes: 9, snapshot: { omitted: 'unsupported' as const } },
  ] }
  const direct = { id: 'cloud::docs/a.txt', label: 'direct old capture', kind: 'file' as const, source: { id: 'cloud', kind: 'cloud' as const, label: 'Cloud' }, textSnapshot: { ...snapshot, path: 'docs/a.txt', text: 'old!' } }
  const input = { attachments: [direct], workspaces: [{ id: 'ws', label: 'Workspace', artifacts: [], folders: [{ id: 'cloud::docs', label: 'docs/', snapshot }] }] }
  const attachments = workspaceInputAttachments(input)
  assert.equal(attachments.length, 3)
  assert.equal(attachments[0]?.textSnapshot?.text, 'old!')
  assert.equal(attachments[1]?.textSnapshot?.text, 'body')
  assert.equal(attachments[1]?.textSnapshot?.snapshotId, snapshot.snapshotId)
  assert.equal(attachments[1]?.textSnapshot?.path, 'docs/a.txt')
  assert.equal(attachments[2]?.textSnapshot, undefined)
  assert.equal(attachments[2]?.id, 'cloud::docs/z.bin')
})

test('native local-folder captures become stable UI-host inputs with whole-file limits and omissions intact', () => {
  const connectionId = 'LOCAL_0123456789ABCDEF0123456789ABCDEF' as const
  const folderId = `ui-host::${connectionId}`
  const largeText = 'x'.repeat(ATTACHMENT_TEXT_FILE_BYTES)
  const capture = {
    version: 1 as const, snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    capturedAt: '2026-10-04T12:00:00.000Z', connectionId,
    files: [
      { name: 'a.md', sizeBytes: new TextEncoder().encode(largeText).byteLength, snapshot: { text: largeText } },
      { name: 'b.md', sizeBytes: 4, snapshot: { text: 'full' } },
      { name: 'image.png', sizeBytes: 9, snapshot: { omitted: 'unsupported' as const } },
    ],
  }
  const workspace: Workspace = {
    id: 'ws', label: 'Workspace', artifacts: [],
    folders: [{ id: folderId, label: 'Local/', localSnapshot: capture }],
  }
  const attachments = workspaceInputAttachments({ attachments: [], workspaces: [workspace] })
  assert.deepEqual(attachments.map((item) => item.id), [
    `ui-host::${connectionId}/a.md`, `ui-host::${connectionId}/b.md`, `ui-host::${connectionId}/image.png`,
  ])
  assert.equal(attachments[0]?.source?.id, 'ui-host')
  assert.equal(attachments[0]?.source?.kind, 'ui-host')
  assert.equal(attachments[0]?.label, 'Local/a.md')
  assert.equal(attachments[0]?.previewText, largeText, 'an exact 64 KiB saved body stays whole')
  assert.equal(attachments[2]?.previewText, undefined, 'omitted binary content remains metadata only')
  const plan = planAttachmentInput(attachments)
  assert.deepEqual(plan.map((item) => item.status), ['ready', 'ready', 'unavailable'])
  assert.equal(plan[0]?.bytes, ATTACHMENT_TEXT_FILE_BYTES)
  assert.equal(plan[1]?.attachment.previewText, 'full')
})

test('local-folder input after Refresh uses only the replacement capture bytes', () => {
  const connectionId = 'LOCAL_FEDCBA9876543210FEDCBA9876543210' as const
  const folderId = `ui-host::${connectionId}`
  const workspace: Workspace = {
    id: 'ws', label: 'Workspace', artifacts: [],
    folders: [{ id: folderId, label: 'Local/', localSnapshot: {
      version: 1, snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      capturedAt: '2026-10-04T12:00:00.000Z', connectionId,
      files: [{ name: 'notes.md', sizeBytes: 3, snapshot: { text: 'old' } }],
    } }],
  }
  const refreshed = replaceLocalFolderSnapshot(workspace, folderId, {
    version: 1, snapshotId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    capturedAt: '2026-10-04T12:01:00.000Z', connectionId,
    files: [{ name: 'notes.md', sizeBytes: 3, snapshot: { text: 'new' } }],
  })
  const attachments = workspaceInputAttachments({ attachments: [], workspaces: [refreshed] })
  assert.equal(attachments.length, 1)
  assert.equal(attachments[0]?.id, `ui-host::${connectionId}/notes.md`)
  assert.equal(attachments[0]?.previewText, 'new')
  assert.equal(attachments.some((item) => item.previewText === 'old'), false)
})

test('recursive local-folder model input preserves full paths when basenames repeat', () => {
  const connectionId = 'LOCAL_0123456789ABCDEF0123456789ABCDEF' as const
  const workspace: Workspace = {
    id: 'ws', label: 'Workspace', artifacts: [],
    folders: [{ id: `ui-host::${connectionId}`, label: 'Project/', localSnapshot: {
      version: 2, scope: 'recursive', snapshotId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      capturedAt: '2026-10-04T12:00:00.000Z', connectionId,
      files: [
        { name: 'src/notes.md', sizeBytes: 5, snapshot: { text: 'first' } },
        { name: 'tests/notes.md', sizeBytes: 6, snapshot: { text: 'second' } },
      ],
    } }],
  }
  const attachments = workspaceInputAttachments({ attachments: [], workspaces: [workspace] })
  assert.deepEqual(attachments.map((item) => [item.id, item.label, item.previewText]), [
    [`ui-host::${connectionId}/src/notes.md`, 'Project/src/notes.md', 'first'],
    [`ui-host::${connectionId}/tests/notes.md`, 'Project/tests/notes.md', 'second'],
  ])
})

test('recursive served-folder model input keeps distinct exact paths and ordinary text snapshot provenance', () => {
  const workspace: Workspace = {
    id: 'ws', label: 'Workspace', artifacts: [],
    folders: [{ id: 'cloud::Project', label: 'Project/', snapshot: {
      version: 2, scope: 'recursive', snapshotId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'Project',
      files: [
        { name: 'src/notes.md', sizeBytes: 5, snapshot: { text: 'first' } },
        { name: 'tests/notes.md', sizeBytes: 6, snapshot: { text: 'second' } },
      ],
    } }],
  }
  const attachments = workspaceInputAttachments({ attachments: [], workspaces: [workspace] })
  assert.deepEqual(attachments.map((item) => [item.id, item.label, item.textSnapshot?.path, item.textSnapshot?.text, item.textSnapshot?.version]), [
    ['cloud::Project/src/notes.md', 'Project/src/notes.md', 'Project/src/notes.md', 'first', 1],
    ['cloud::Project/tests/notes.md', 'Project/tests/notes.md', 'Project/tests/notes.md', 'second', 1],
  ])
  assert.deepEqual(planAttachmentInput(attachments).map((item) => item.status), ['ready', 'ready'])
})
