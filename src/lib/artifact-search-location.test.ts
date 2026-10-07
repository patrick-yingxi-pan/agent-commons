import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactSubLocationKey, parseArtifactSubLocation } from './artifactSearchLocation.ts'

test('artifact nav sub-locations strictly distinguish current matches from retained-version matches', () => {
  assert.deepEqual(parseArtifactSubLocation(undefined), {})
  assert.deepEqual(parseArtifactSubLocation('match/0/doc.title'), { match: '0/doc.title' })
  assert.deepEqual(parseArtifactSubLocation('history/0'), { revision: 0 })
  assert.deepEqual(parseArtifactSubLocation('history/0/match/doc.title'), { revision: 0, match: '0/doc.title' })
  assert.deepEqual(parseArtifactSubLocation('history/12/match/workbook.2.cell.4.5'), { revision: 12, match: '12/workbook.2.cell.4.5' })
})

test('malformed and mismatched artifact locators are rejected rather than guessed', () => {
  for (const value of [
    'match/00/doc.title', 'match/1/doc.block.00.p', 'match/1/doc.title/extra',
    'history/00', 'history/-1', 'history/1/match/doc.title/extra',
    'history/1/match/doc.block.00.p',
  ]) assert.equal(parseArtifactSubLocation(value), undefined, value)
  assert.equal(artifactSubLocationKey({ revision: 1, match: '2/doc.title' }), undefined)
  assert.equal(artifactSubLocationKey({ match: '01/doc.title' }), undefined)
})

test('artifact nav sub-location serialization keeps current revision separate from history route revision', () => {
  assert.equal(artifactSubLocationKey({ match: '0/doc.title' }), 'match/0/doc.title')
  assert.equal(artifactSubLocationKey({ revision: 0 }), 'history/0')
  assert.equal(artifactSubLocationKey({ revision: 0, match: '0/doc.title' }), 'history/0/match/doc.title')
})
