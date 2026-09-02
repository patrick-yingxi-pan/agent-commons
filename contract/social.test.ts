import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalGrantNote, MAX_GRANT_NOTE_CHARS } from './social.ts'

test('grant-note absence is canonical silence and present prose is bounded', () => {
  assert.equal(canonicalGrantNote(undefined), undefined)
  assert.equal(canonicalGrantNote('   \n\t '), undefined)
  assert.equal(canonicalGrantNote('  publish this  '), 'publish this')
  assert.equal(canonicalGrantNote('x'.repeat(MAX_GRANT_NOTE_CHARS + 1))?.length, MAX_GRANT_NOTE_CHARS)
})
