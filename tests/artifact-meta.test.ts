/** Surface-audit S6 — the canonical artifact surfaces (full viewer + gallery card)
 *  should be at least as specific as the humble side panel, which shows the artifact's
 *  own descriptor (meta). These lock the shared guard: reveal meta ONLY when it's more
 *  specific than the generic kind label, so a gallery-created artifact (meta = the
 *  label) never reads "Document · Document". */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactMetaIsSpecific } from '../src/lib/artifactMeta.ts'

test('a concrete descriptor that beats the kind label is shown', () => {
  assert.equal(artifactMetaIsSpecific('functional spec', 'Document'), true)
  assert.equal(artifactMetaIsSpecific('1600×900', 'Image'), true)
  assert.equal(artifactMetaIsSpecific('to: workspace admins', 'Email'), true)
})

test('meta equal to the kind label is NOT specific — no "Document · Document"', () => {
  assert.equal(artifactMetaIsSpecific('Document', 'Document'), false, 'gallery-created artifact')
  assert.equal(artifactMetaIsSpecific('Image', 'Image'), false)
})

test('an empty / missing descriptor is not specific', () => {
  assert.equal(artifactMetaIsSpecific('', 'Document'), false)
  assert.equal(artifactMetaIsSpecific(undefined, 'Document'), false)
})
