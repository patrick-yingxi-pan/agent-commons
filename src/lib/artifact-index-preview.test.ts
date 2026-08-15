/** UI-31 — every artifact kind has one INDEX preview shape.
 *
 * The old index miniaturized each artifact's reading surface, so documents,
 * emails, images, slides, and sheets became five unrelated card layouts. The
 * index now previews the resource as an index should: one synopsis row. Rich
 * content keeps its one canonical home on `/artifacts/:id`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

const component = (name: string) => stripComments(sectionViewComponent(name))

test('the Artifacts root is one list of standardized preview rows', () => {
  const section = component('ArtifactsSection')
  assert.match(section, /<CardList>/, 'artifact groups use the shared one-column list')
  assert.match(section, /<ArtifactPreviewRow\b/, 'every artifact routes through the one index preview')
  assert.doesNotMatch(section, /grid-cols-|<ArtifactCard\b|<ArtifactThumb\b/, 'the index has no gallery or miniature-content escape')
})

test('an artifact preview is identity, synopsis, provenance, and recency — never a tiny reading surface', () => {
  const row = component('ArtifactPreviewRow')
  assert.match(row, /data-artifact-preview-row=\{artifact\.kind\}/, 'the browser can enumerate every kind through the funnel')
  assert.match(row, /data-artifact-preview-copy/, 'the synopsis has one DOM role')
  assert.match(row, /artifact\.excerpt\?\.trim\(\) \|\| 'No preview available\.'/)
  assert.match(row, /KIND_LABEL\[artifact\.kind\]/, 'kind is metadata rather than layout')
  assert.match(row, /artifactMetaIsSpecific/, 'specific descriptors survive without duplicating the kind')
  assert.match(row, /artifact\.source/, 'provenance stays visible')
  assert.match(row, /relativeTime\(artifact\.editedAt\)/, 'recency stays visible')
  assert.match(row, /cardDoorClick\(onOpen\)/, 'plain preview copy opens the canonical page')
  assert.match(row, /ROW_DOOR_CLASS/, 'the cue matches the whole row target')
  assert.doesNotMatch(row, /ArtifactBodyView|ArtifactThumb|CARD_DOOR_CLASS|QUIET_CARD_CLASS|h-28/, 'rich body/card chrome cannot regrow inside the index')
})
