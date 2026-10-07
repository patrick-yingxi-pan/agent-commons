import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactContent } from '../contract/content.ts'
import { docBlockId, identifyDocumentBody } from './documentIdentity.ts'

const doc = (blocks: Record<string, unknown>[], revision?: number): ArtifactContent => ({
  type: 'doc', title: 'Identity fixture', blocks: blocks as never,
  ...(revision === undefined ? {} : { revision }),
})

test('Document block identity is deterministic and scoped to artifact, revision, and ordinal', () => {
  const one = docBlockId('artifact-a', 0, 1)
  assert.match(one, /^block-[0-9a-f]{32}$/)
  assert.equal(docBlockId('artifact-a', 0, 1), one)
  assert.notEqual(docBlockId('artifact-b', 0, 1), one)
  assert.notEqual(docBlockId('artifact-a', 1, 1), one)
  assert.notEqual(docBlockId('artifact-a', 0, 2), one)
  for (const args of [['', 0, 0], ['a', -1, 0], ['a', 0, -1], ['a', Number.MAX_SAFE_INTEGER + 1, 0]] as const) {
    assert.throws(() => docBlockId(...args), TypeError)
  }
})

test('legacy Documents receive stable per-revision IDs without changing authored content', () => {
  const source = doc([{ p: 'First' }, { h: 'Second' }], 4)
  const before = structuredClone(source)
  const identified = identifyDocumentBody('artifact-7', source)
  assert.deepEqual(source, before, 'identity assignment does not mutate its input')
  assert.deepEqual(identified.blocks.map((block) => block.id), [docBlockId('artifact-7', 4, 0), docBlockId('artifact-7', 4, 1)])
  assert.deepEqual(identifyDocumentBody('artifact-7', source), identified)
  assert.notDeepEqual(identifyDocumentBody('artifact-7', { ...source, revision: 5 }), identified,
    'different revisions are not presumed to contain the same block identities')
})

test('non-Documents pass through and fully identified Documents preserve their IDs', () => {
  const sheet = { type: 'sheet', name: 'Sheet', columns: [], rows: [], cells: [], notes: [], revision: 0 } as unknown as ArtifactContent
  assert.equal(identifyDocumentBody('artifact-sheet', sheet), sheet)

  const source = doc([{ p: 'First', id: 'reviewed-first' }, { email: { to: 'a@example.com', subject: 'Hi' }, id: 'reviewed-email' }], 0)
  const identified = identifyDocumentBody('artifact-doc', source)
  assert.deepEqual(identified.blocks.map((block) => block.id), ['reviewed-first', 'reviewed-email'])
  assert.notEqual(identified, source)
  assert.notEqual(identified.blocks, source.blocks)
  const boundaryId = `a${'_'.repeat(95)}`
  assert.equal(boundaryId.length, 96)
  assert.equal((identifyDocumentBody('artifact-doc', doc([{ p: 'Boundary', id: boundaryId }])).blocks[0] as { id?: string }).id, boundaryId)
})

test('mixed, duplicate, or malformed existing Document IDs are rejected, never silently replaced', () => {
  for (const blocks of [
    [{ p: 'one', id: 'known' }, { p: 'two' }],
    [{ p: 'one' }, { p: 'two', id: 'known' }],
    [{ p: 'one', id: 'same' }, { p: 'two', id: 'same' }],
    [{ p: 'one', id: '' }],
    [{ p: 'one', id: 'not valid!' }],
    [{ p: 'one', id: 'valid\n' }],
    [{ p: 'one', id: 'valid\r' }],
    [{ p: 'one', id: 'valid\u2028' }],
    [{ p: 'one', id: `a${'_'.repeat(96)}` }],
  ]) assert.throws(() => identifyDocumentBody('artifact-doc', doc(blocks)), TypeError)
})
