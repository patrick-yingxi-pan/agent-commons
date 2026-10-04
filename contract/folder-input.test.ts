import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planAttachmentInput, workspaceInputAttachments } from './attachmentInput.ts'
import type { Artifact, SessionWorkspace } from './entities.ts'

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
