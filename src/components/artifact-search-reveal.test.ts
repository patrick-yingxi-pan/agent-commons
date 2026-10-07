import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('every authored field renderer routes search focus through one scoped reveal funnel', () => {
  const doc = read('./artifactPreview.tsx')
  const structured = read('./StructuredArtifactView.tsx')
  const tabs = read('./WorkbookTabs.tsx')
  for (const field of ['doc.title', '${field}.h', '${field}.p', '${field}.ul.${i}', '${field}.code.${i}', '${field}.email.to', '${field}.email.subject']) {
    assert.ok(doc.includes(field), `Document field ${field} must be addressable`)
  }
  for (const field of ['${fieldPrefix}.column.${index}', '${fieldPrefix}.cell.${rowIndex}.${columnIndex}', '${fieldPrefix}.note', 'slides.${index}.title', 'slides.${index}.bullet.${bulletIndex}']) {
    assert.ok(structured.includes(field), `Structured field ${field} must be addressable`)
  }
  assert.ok(tabs.includes('workbook.${index}.name'))
  assert.ok(structured.includes('useState(targetSheetId ?? body.sheets[0]!.id)'), 'a later-tab match starts visible')
  assert.ok(structured.includes('[targetSheetId, search.request]'), 'Show match can reopen a tab after manual navigation')
  assert.ok(doc.includes('heldOpen={searchTarget !== undefined}'), 'stored Content folds cannot hide an addressed field')
  assert.ok(doc.includes('reveal(lib, lib.revision ?? 0,'), 'current positions use the actual body revision')
  assert.ok(read('./ArtifactHistoryPanel.tsx').includes('bodyOverrideRevision={selectedVersion.revision}'), 'immutable positions use the response revision, never the requested revision')
})

test('field focus is local, non-mutating and available to keyboard and assistive technology', () => {
  const reveal = read('./ArtifactSearchReveal.tsx')
  assert.ok(reveal.includes('artifactSearchReveal(body, revision, target)'))
  assert.ok(reveal.includes("result.kind === 'ready' ? result.field : undefined"))
  assert.ok(reveal.includes("'data-artifact-search-match': true, tabIndex: -1, ref: register"))
  assert.ok(reveal.includes('node.focus({ preventScroll: true })'))
  assert.ok(reveal.includes('if (!element) revealed.current = null'), 'a reused worksheet cell may receive focus again after leaving its target tab')
  assert.ok(reveal.includes("node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })"))
  assert.ok(reveal.includes('role="status"'))
  assert.ok(reveal.includes('Show match'))
  assert.doesNotMatch(reveal, /document\.querySelector|fetch\(|enqueue\w+\(|apiPatch\(/)
})
