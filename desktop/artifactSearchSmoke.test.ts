import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

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
