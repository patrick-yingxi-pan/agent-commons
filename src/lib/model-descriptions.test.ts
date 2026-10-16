import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { EFFORT_BLURBS, modelBlurb } from './modelDescriptions.ts'

test('model descriptions stay outside the eager selection projection', () => {
  const source = stripComments(read(join(ROOT, 'src/lib/models.ts')))
  assert.doesNotMatch(source, /EFFORT_BLURBS|modelBlurb|modelDescriptions|legacyModelChoice|parseModelChoice|composeModelLabel/,
    'cold selection needs identities and effort choices, not deferred descriptions or legacy Routine parsing')
})

test('captions preserve unknown metadata and describe only fields supplied by the provider', () => {
  assert.equal(modelBlurb({ id: 'configured', label: 'configured' }), 'No metadata from this provider.')
  assert.equal(modelBlurb({ id: 'listed', label: 'Listed', blurb: 'Provider text', capabilities: { thinking: true },
    pricing: { inputPerMTok: 1, outputPerMTok: 2 }, deprecated: true }),
  'Provider text · thinking · $1/M in · $2/M out · deprecated')
  assert.equal(EFFORT_BLURBS.Unknown, undefined)
})
