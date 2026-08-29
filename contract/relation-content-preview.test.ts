/** Surface-audit S2 — a content-bearing consent op shows the body you're approving,
 *  so consent isn't given blind. These lock `relationContentPreview`: which ops carry
 *  a previewable body (and its label), that an edit to an existing value surfaces the
 *  CURRENT value (for an old→new diff) while a create surfaces the proposed body alone
 *  (never a diff faked against an empty column), and that every pure-ref op previews
 *  nothing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relationContentPreview, type RelationOp } from './relations.ts'

// Resolvers: project p1 has an existing description; nothing has custom instructions.
const description = (pid: string) => (pid === 'p1' ? 'old description' : undefined)
const instructions = (_pid: string) => undefined
const preview = (op: RelationOp) => relationContentPreview(op, description, instructions)

test('set-project-description surfaces the CURRENT description (old→new diff) + the proposed body', () => {
  const got = preview({ kind: 'set-project-description', projectId: 'p1', projectName: 'P', description: 'new description' })
  assert.deepEqual(got, { label: 'Description', current: 'old description', proposed: 'new description' })
})

test('an edit to a value with NO current overlay surfaces the proposed body alone — no faked diff', () => {
  // p9 has no description overlay → current undefined → the card renders proposed alone.
  const got = preview({ kind: 'set-project-description', projectId: 'p9', projectName: 'P9', description: 'brand new' })
  assert.equal(got?.current, undefined, 'no empty-left diff column is invented')
  assert.equal(got?.proposed, 'brand new')
})

test('a CLEARED current ("" — a real stored value) also renders as a create, not a blank-left diff', () => {
  // graph.ts stores '' when instructions are cleared; diffing against an empty
  // column is exactly the faked diff the contract forbids.
  const cleared = (pid: string) => (pid === 'p1' ? '' : undefined)
  const got = relationContentPreview(
    { kind: 'set-project-instructions', projectId: 'p1', projectName: 'P', instructions: 'fresh' },
    cleared,
    cleared,
  )
  assert.equal(got?.current, undefined, 'empty-string current normalizes away')
  assert.equal(got?.proposed, 'fresh')
})

test('set-project-instructions previews the instructions body', () => {
  const got = preview({ kind: 'set-project-instructions', projectId: 'p1', projectName: 'P', instructions: 'be terse' })
  assert.equal(got?.label, 'Instructions')
  assert.equal(got?.proposed, 'be terse')
  assert.equal(got?.current, undefined, 'no instructions overlay set → proposed alone')
})

test('create ops preview the proposed body alone (no prior value to diff)', () => {
  assert.deepEqual(preview({ kind: 'create-prompt', label: 'L', body: 'the prompt body', targetFamily: 'claude' }), {
    label: 'Prompt body',
    proposed: 'the prompt body',
  })
  assert.deepEqual(preview({ kind: 'create-agent', label: 'A', instructions: 'agent guidance' }), {
    label: 'Instructions',
    proposed: 'agent guidance',
  })
  assert.deepEqual(
    preview({ kind: 'create-project', projectId: 'p2', projectName: 'P2', projectDescription: 'a new project' }),
    { label: 'Description', proposed: 'a new project' },
  )
  assert.deepEqual(
    preview({ kind: 'save-artifact', artifact: { name: 'brief.md', kind: 'doc', meta: 'Document', body: 'The actual brief.' } }),
    { label: 'Document content', proposed: 'The actual brief.' },
    'saving a document is never a blind metadata-only confirmation',
  )
})

test('a content op with an EMPTY body previews nothing (no blank disclosure)', () => {
  assert.equal(preview({ kind: 'create-agent', label: 'A' }), null, 'agent with no instructions')
  assert.equal(preview({ kind: 'create-project', projectId: 'p2', projectName: 'P2', projectDescription: '' }), null)
  assert.equal(
    preview({ kind: 'save-artifact', artifact: { name: 'legacy.md', kind: 'doc', meta: 'Document' } }),
    null,
    'legacy metadata-only saves remain readable without inventing content',
  )
})

test('pure-reference ops preview nothing — there is no body to show', () => {
  assert.equal(preview({ kind: 'commission-agent', agentId: 'a', agentLabel: 'A', projectId: 'p', projectName: 'P' }), null)
  assert.equal(preview({ kind: 'share-project', projectId: 'p', projectName: 'P', shared: true }), null)
  assert.equal(preview({ kind: 'file-session', sessionId: 's', sessionTitle: 'S', projectId: 'p', projectName: 'P' }), null)
})
