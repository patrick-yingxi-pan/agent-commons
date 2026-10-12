import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import {
  CONTRIBUTION_ENVELOPE_STATUS_CLASSES,
  CONTRIBUTION_EFFECT_DISCLOSURE_CLASS,
  CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS,
} from './contributionEffectPresentation.ts'

test('Contribution effect fields fit the available pane and disclosures use the readable text ramp', () => {
  assert.equal(CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS, 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))')
  assert.doesNotMatch(CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS, /@media|vw|breakpoint/i)
  assert.match(CONTRIBUTION_EFFECT_DISCLOSURE_CLASS, /text-ink-soft/)
  assert.doesNotMatch(CONTRIBUTION_EFFECT_DISCLOSURE_CLASS, /text-warn-text|text-danger/)
})

test('Contribution envelope status badges use paired semantic tint/text seats', () => {
  assert.match(CONTRIBUTION_ENVELOPE_STATUS_CLASSES.proposed, /bg-warn-tint/)
  assert.match(CONTRIBUTION_ENVELOPE_STATUS_CLASSES.proposed, /text-warn-text/)
  assert.doesNotMatch(CONTRIBUTION_ENVELOPE_STATUS_CLASSES.proposed, /bg-warn-strong\/10/)
  assert.match(CONTRIBUTION_ENVELOPE_STATUS_CLASSES.approved, /bg-ok-tint/)
  assert.match(CONTRIBUTION_ENVELOPE_STATUS_CLASSES.approved, /text-ok-text/)

  const card = stripComments(read(join(ROOT, 'src/components/ContributionEnvelopeCard.tsx')))
  assert.match(card, /className=\{CONTRIBUTION_ENVELOPE_STATUS_CLASSES\.proposed\}/)
  assert.match(card, /className=\{CONTRIBUTION_ENVELOPE_STATUS_CLASSES\.approved\}/)
  assert.doesNotMatch(card, /bg-warn-strong\/10\s+[^\"]*text-warn-text/)
})
