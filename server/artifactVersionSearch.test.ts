import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { searchArtifactVersions } from './artifactVersionSearch.ts'

test('artifact version search visits only literal saved text fields and returns metadata without bodies', () => {
  const sources = [{
    id: 'artifact-a', name: 'Notes.md', trashed: false,
    versions: [
      { revision: 0, savedAt: null, reason: 'baseline' as const, body: { type: 'doc' as const, title: 'Document title', blocks: [{ email: { to: 'Ada <ada@example.com>', subject: 'Résumé' } }] } },
      { revision: 1, savedAt: '2026-01-01T00:00:00.000Z', reason: 'edit' as const, body: { type: 'doc' as const, title: 'Other title', blocks: [{ p: 'Current ✨ text' }] } },
    ],
  }]
  const result = searchArtifactVersions(sources, 'résumé', 0)
  assert.equal(result.total, 1)
  assert.deepEqual(result.hits[0], {
    type: 'artifactVersion', id: 'artifact-a', title: 'Notes.md', subtitle: 'Résumé',
    revision: 0, savedAt: null, reason: 'baseline', trashed: false,
    match: { revision: 0, field: 'doc.block.0.email.subject' },
  })
  assert.equal(Object.hasOwn(result.hits[0]!, 'body'), false)
})

test('artifact version search handles sheets, workbooks, slides, and ignores arbitrary object fields', () => {
  const versions = [
    { revision: 0, savedAt: null, reason: 'baseline' as const, body: { type: 'sheet' as const, columns: ['Quarter'], rows: [['Needle in cell']], note: { hidden: 'Needle in arbitrary object' } as unknown as string } },
    { revision: 1, savedAt: '2026-01-01T00:00:00.000Z', reason: 'edit' as const, body: { type: 'workbook' as const, sheets: [{ id: 'tab-id', name: 'Tab Needle', columns: ['Name'], rows: [['value']] }] } },
    { revision: 2, savedAt: '2026-01-02T00:00:00.000Z', reason: 'edit' as const, body: { type: 'slides' as const, slides: [{ title: 'Slide title', bullets: ['Needle in bullet'] }] } },
  ]
  const result = searchArtifactVersions([{ id: 'artifact-b', name: 'Deck', trashed: false, versions }], 'needle', 0)
  assert.equal(result.total, 3)
  assert.deepEqual(result.hits.map((hit) => [hit.revision, hit.subtitle]), [
    [2, 'Needle in bullet'], [1, 'Tab Needle'], [0, 'Needle in cell'],
  ])
  assert.deepEqual(result.hits.map((hit) => hit.match), [
    { revision: 2, field: 'slides.0.bullet.0' },
    { revision: 1, field: 'workbook.0.name' },
    { revision: 0, field: 'sheet.cell.0.0' },
  ])
})

test('artifact version search counts all matches but retains only the requested page', () => {
  const versions = Array.from({ length: 45 }, (_, revision) => ({
    revision, savedAt: revision === 0 ? null : new Date(revision * 1000).toISOString(),
    reason: revision === 0 ? 'baseline' as const : 'edit' as const,
    body: { type: 'doc' as const, title: `version ${revision}`, blocks: [{ p: 'page needle' }] },
  }))
  const first = searchArtifactVersions([{ id: 'artifact-c', name: 'Paged', trashed: false, versions }], 'needle', 0)
  const second = searchArtifactVersions([{ id: 'artifact-c', name: 'Paged', trashed: false, versions }], 'needle', 20)
  const beyond = searchArtifactVersions([{ id: 'artifact-c', name: 'Paged', trashed: false, versions }], 'needle', 100)
  const emptyQuery = searchArtifactVersions([{ id: 'artifact-c', name: 'Paged', trashed: false, versions }], '', 0)
  assert.equal(first.total, 45)
  assert.equal(first.hits.length, 20)
  assert.equal(second.hits.length, 20)
  assert.equal(beyond.total, 45)
  assert.deepEqual(beyond.hits, [])
  assert.equal(emptyQuery.total, 0)
  assert.deepEqual(emptyQuery.hits, [])
  assert.deepEqual([...first.hits, ...second.hits].map((hit) => hit.revision), Array.from({ length: 40 }, (_, i) => 44 - i))
})

test('artifact version snippets are constructed only inside the requested page window', () => {
  const source = readFileSync(new URL('./artifactVersionSearch.ts', import.meta.url), 'utf8')
  const pageGate = source.indexOf('if (total >= offset && hits.length < SEARCH_PAGE_SIZE) {')
  const snippetCall = source.indexOf('literalSearchSnippet(match.text, query)')
  assert.ok(pageGate >= 0, 'the source retains the existing page-membership gate')
  assert.ok(snippetCall > pageGate, 'snippet construction must stay after the page gate')
})

test('artifact version search rejects a trimmed query over its contract bound', () => {
  assert.throws(() => searchArtifactVersions([], ` ${'x'.repeat(257)} `, 0), /limited to 256/)
})
