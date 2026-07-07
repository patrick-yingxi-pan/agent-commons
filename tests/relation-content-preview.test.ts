/** Surface-audit S2 — a content-bearing consent op shows the body you're approving,
 *  so consent isn't given blind. These lock `relationContentPreview`: which ops carry
 *  a previewable body (and its label), that an edit to an existing value surfaces the
 *  CURRENT value (for an old→new diff) while a create surfaces the proposed body alone
 *  (never a diff faked against an empty column), and that every pure-ref op previews
 *  nothing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relationContentPreview, type RelationOp } from '../contract/relations.ts'

// Resolvers: project p1 has an existing README; nothing has custom instructions.
const readme = (pid: string) => (pid === 'p1' ? 'old readme' : undefined)
const instructions = (_pid: string) => undefined
const preview = (op: RelationOp) => relationContentPreview(op, readme, instructions)

test('set-project-readme surfaces the CURRENT readme (old→new diff) + the proposed body', () => {
  const got = preview({ kind: 'set-project-readme', projectId: 'p1', projectName: 'P', readme: 'new readme' })
  assert.deepEqual(got, { label: 'README', current: 'old readme', proposed: 'new readme' })
})

test('an edit to a value with NO current overlay surfaces the proposed body alone — no faked diff', () => {
  // p9 has no README overlay → current undefined → the card renders proposed alone.
  const got = preview({ kind: 'set-project-readme', projectId: 'p9', projectName: 'P9', readme: 'brand new' })
  assert.equal(got?.current, undefined, 'no empty-left diff column is invented')
  assert.equal(got?.proposed, 'brand new')
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
})

test('a content op with an EMPTY body previews nothing (no blank disclosure)', () => {
  assert.equal(preview({ kind: 'create-agent', label: 'A' }), null, 'agent with no instructions')
  assert.equal(preview({ kind: 'create-project', projectId: 'p2', projectName: 'P2', projectDescription: '' }), null)
})

test('pure-reference ops preview nothing — there is no body to show', () => {
  assert.equal(preview({ kind: 'commission-agent', agentId: 'a', agentLabel: 'A', projectId: 'p', projectName: 'P' }), null)
  assert.equal(preview({ kind: 'share-project', projectId: 'p', projectName: 'P', shared: true }), null)
  assert.equal(preview({ kind: 'file-session', sessionId: 's', sessionTitle: 'S', projectId: 'p', projectName: 'P' }), null)
})
