import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { docBlockId } from '../server/documentIdentity.ts'
import { calculateWorkbook } from '../contract/workbookCalculation.ts'
import { prepareArtifactSearchSmoke } from './artifactSearchSmoke.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('current Artifact search acceptance is kept out of the packaged application', () => {
  assert.equal(ignoreFromPackage('/desktop/artifactSearchSmoke.mjs'), true)
})

test('current-body smoke prepares Document, Sheet, workbook and Slides with exact later-field locators', () => {
  const helper = source('./artifactSearchSmoke.mjs')
  for (const label of ['document', 'sheet', 'workbook', 'slides']) {
    assert.ok(helper.includes(`label: '${label}'`), `smoke includes a generated ${label} fixture`)
  }
  for (const field of [
    'doc.block.1.p',
    'sheet.cell.1.1',
    'workbook.1.cell.0.1',
    'slides.1.bullet.1',
  ]) assert.ok(helper.includes(`field: '${field}'`), `smoke exercises exact locator ${field}`)
  assert.match(helper, /fixture\.path = `\/artifacts\/\$\{encodeURIComponent\(fixture\.id\)\}\/match\/0\/\$\{fixture\.field\}`/)
  assert.match(helper, /const bodies = await request\(page, '\/artifact-content'\)/,
    'the canonical API confirms each exact generated body before navigation')
  assert.match(helper, /assert\.deepEqual\(bodies\[fixture\.id\], fixture\.body/)
})

test('current-body preparation preserves all authored fixtures and assigns every Document block its canonical identity', async () => {
  const stamp = 'identity-lock'
  const artifactIds = ['search-document', 'search-sheet', 'search-workbook', 'search-slides']
  const expectedBodies = {
    'search-document': {
      type: 'doc', title: `Packaged search document ${stamp}`,
      blocks: [
        { id: docBlockId('search-document', 0, 0), p: 'Opening context. '.repeat(32).trim() },
        { id: docBlockId('search-document', 0, 1), p: `A later paragraph contains documentneedle${stamp}.` },
      ], revision: 0,
    },
    'search-sheet': {
      type: 'sheet', columns: ['Metric', 'Value'],
      rows: [['Opening', 'Ordinary'], ['Later', `sheetneedle${stamp}`]], revision: 0,
    },
    'search-workbook': {
      type: 'workbook', revision: 0, sheets: [
        { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Opening', '21']] },
        { id: 'details', name: 'Details', columns: ['Metric', 'Value', 'Twice overview'], rows: [['Later', `workbookneedle${stamp}`, { formula: "='Overview'!B1*2" }]] },
      ],
    },
    'search-slides': {
      type: 'slides', revision: 0, slides: [
        { title: 'Opening', bullets: ['Ordinary introduction'] },
        { title: 'Details', bullets: ['Other detail', `slidesneedle${stamp}`] },
      ],
    },
  }
  const request = async (_page: unknown, path: string, body?: { name: string }) => {
    if (path === '/artifacts') {
      const index = Object.keys(expectedBodies).findIndex(id => expectedBodies[id as keyof typeof expectedBodies].type ===
        (body?.name.includes('document') ? 'doc' : body?.name.includes('workbook') ? 'workbook' : body?.name.includes('slides') ? 'slides' : 'sheet'))
      assert.notEqual(index, -1, `stub recognizes create request ${body?.name}`)
      return { artifact: { id: artifactIds[index], name: body?.name } }
    }
    assert.equal(path, '/artifact-content')
    return expectedBodies
  }
  const fixtures = await prepareArtifactSearchSmoke({ page: {}, request, stamp })
  assert.deepEqual(fixtures.map(({ label, id, field, query }) => ({ label, id, field, query })), [
    { label: 'document', id: 'search-document', field: 'doc.block.1.p', query: `documentneedle${stamp}` },
    { label: 'sheet', id: 'search-sheet', field: 'sheet.cell.1.1', query: `sheetneedle${stamp}` },
    { label: 'workbook', id: 'search-workbook', field: 'workbook.1.cell.0.1', query: `workbookneedle${stamp}` },
    { label: 'slides', id: 'search-slides', field: 'slides.1.bullet.1', query: `slidesneedle${stamp}` },
  ])
  assert.deepEqual(Object.fromEntries(fixtures.map(fixture => [fixture.id, fixture.body])), expectedBodies,
    'the helper compares exact authored content and all canonical Document block IDs')
  const workbook = fixtures.find(fixture => fixture.label === 'workbook')
  assert.ok(workbook)
  assert.deepEqual(workbook.body.sheets[1].rows[0][2], { formula: "='Overview'!B1*2" },
    'the authored workbook keeps the exact cross-sheet source')
  assert.deepEqual(calculateWorkbook(workbook.body.sheets).find(sheet => sheet.id === 'details')?.rows
    .map(row => row.map(cell => cell.text)), [['Later', `workbookneedle${stamp}`, '42']])
})

test('current-body search verifies exact URLs, focused reveal, reload, Back, and Show match without writes or history reads', () => {
  const helper = source('./artifactSearchSmoke.mjs')
  assert.match(helper, /\[data-search-result="artifact-\$\{fixture\.id\}"\]/)
  assert.match(helper, /await expect\(page\)\.toHaveURL\(`\$\{origin\}\$\{fixture\.path\}`\)/)
  assert.match(helper, /data-artifact-search-reveal="ready"/)
  assert.match(helper, /data-artifact-search-match="true"/)
  assert.match(helper, /data-artifact-search-field', fixture\.field/)
  assert.match(helper, /await expect\(match\)\.toBeFocused\(\)/)
  assert.match(helper, /getByRole\('button', \{ name: 'Show match', exact: true \}\)/)
  assert.match(helper, /await page\.reload\(\)/)
  assert.match(helper, /await page\.goBack\(\)/)
  assert.match(helper, /await expect\(page\)\.toHaveURL\(`\$\{origin\}\$\{workbook\.path\}`\)/)
  assert.match(helper, /assert\.deepEqual\(mutations, \[\], 'current search, reveal, tab navigation, reload and Back do not mutate Artifacts'\)/)
  assert.match(helper, /assert\.deepEqual\(historyReads, \[\], 'current search never reads private saved versions'\)/)
})

test('current search body locks are read-only SQLite projections and survive the existing signed-in relaunch', () => {
  const helper = source('./artifactSearchSmoke.mjs')
  const history = source('./artifactHistorySmoke.mjs')
  assert.match(helper, /new DatabaseSync\(join\(profile, 'store\.db'\), \{ readOnly: true \}\)/)
  assert.match(helper, /prepare\('SELECT json FROM map_entries WHERE slice = \? AND key = \?'\)/)
  assert.match(helper, /statement\.get\('artifactBodies', fixture\.id\)/)
  assert.match(helper, /assert\.deepEqual\(body, fixture\.body/)
  assert.match(history, /await verifyArtifactSearchSmoke\(\{ page, origin, request, fixtures: searchFixtures, evidenceDirectory, phase: 'before-relaunch' \}\)/)
  assert.match(history, /await verifyArtifactSearchSmoke\(\{ page, origin, request, fixtures: searchFixtures, evidenceDirectory, phase: 'after-relaunch' \}\)/)
  assert.match(history, /const searchBodiesBeforeQuit = readSqliteSearchBodies\(profile, searchFixtures\)/)
  assert.match(history, /assert\.deepEqual\(readSqliteSearchBodies\(profile, searchFixtures\), searchBodiesBeforeQuit,[\s\S]*?before relaunch/)
  assert.match(history, /assert\.deepEqual\(readSqliteSearchBodies\(profile, searchFixtures\), searchBodiesBeforeQuit,[\s\S]*?ordinary signed-in relaunch preserves exact current search bodies without rewrites/)
})

test('authored workbook formula source and derived value are checked in the post-relaunch journey', () => {
  const helper = source('./artifactSearchSmoke.mjs')
  const history = source('./artifactHistorySmoke.mjs')
  assert.match(helper, /import \{ calculateWorkbook \} from '\.\.\/contract\/workbookCalculation\.ts'/)
  assert.match(helper, /formula: "='Overview'!B1\*2"/)
  assert.match(helper, /saved workbook keeps the exact cross-sheet formula source/)
  assert.match(helper, /relaunch\/search journey recalculates the named cross-sheet value from saved workbook content/)
  assert.match(helper, /getByLabel\('Formula source C1'\)\)\.toHaveText\("='Overview'!B1\*2"\)/)
  assert.match(helper, /formulaCell\.locator\('span'\)\.first\(\)\)\.toHaveText\('42'\)/)
  assert.match(history, /verifyArtifactSearchSmoke\(\{ page, origin, request, fixtures: searchFixtures, evidenceDirectory, phase: 'after-relaunch' \}\)/)
})

test('old current locators go stale after restore and remain unhighlighted before and after relaunch', () => {
  const helper = source('./artifactSearchSmoke.mjs')
  const history = source('./artifactHistorySmoke.mjs')
  assert.match(helper, /\/match\/\$\{oldRevision\}\/doc\.block\.0\.p/)
  assert.match(helper, /data-artifact-search-reveal="stale"/)
  assert.match(helper, /\[data-artifact-search-match\]/)
  assert.match(helper, /toHaveCount\(0\)/)
  assert.match(history, /await verifyStaleArtifactSearchSmoke\(\{ page, origin, artifactId: artifact\.id, oldRevision: 1,[\s\S]*?phase: 'before-relaunch' \}\)/)
  assert.match(history, /await verifyStaleArtifactSearchSmoke\(\{ page, origin, artifactId: artifact\.id, oldRevision: 1,[\s\S]*?phase: 'after-relaunch' \}\)/)
  const staleCheckAfterRestore = history.indexOf('await verifyStaleArtifactSearchSmoke({ page, origin, artifactId: artifact.id, oldRevision: 1,')
  assert.ok(history.indexOf('Restored version 0 as current version 2') < staleCheckAfterRestore,
    'the old revision is checked only after the confirmed restore advances current content')
})
