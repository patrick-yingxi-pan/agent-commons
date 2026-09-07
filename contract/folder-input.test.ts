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
