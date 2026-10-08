import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRIBUTION_EFFECT_DISCLOSURE_CLASS,
  CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS,
} from './contributionEffectPresentation.ts'

test('Contribution effect fields fit the available pane and disclosures use the readable text ramp', () => {
  assert.equal(CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS, 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))')
  assert.doesNotMatch(CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS, /@media|vw|breakpoint/i)
  assert.match(CONTRIBUTION_EFFECT_DISCLOSURE_CLASS, /text-ink-soft/)
  assert.doesNotMatch(CONTRIBUTION_EFFECT_DISCLOSURE_CLASS, /text-warn-text|text-danger/)
})
