import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

test('packaged artifact-history acceptance is excluded from the shipped application', () => {
  assert.equal(ignoreFromPackage('/desktop/artifactHistorySmoke.mjs'), true)
})

test('ordinary and extracted-release smoke await the artifact-history workflow', () => {
  const source = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes('await smokePackagedArtifactHistory({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })'))
})

test('packaged history acceptance exercises real storage, viewer walls, consent and process relaunch', () => {
  const source = readFileSync(new URL('./artifactHistorySmoke.mjs', import.meta.url), 'utf8')
  assert.equal([...source.matchAll(/await launch\(executable, profile\)/g)].length, 2,
    'acceptance includes independent initial and reopened application processes')
  assert.match(source, /new DatabaseSync\(join\(profile, 'store.db'\), \{ readOnly: true \}\)/)
  assert.match(source, /\.get\('artifactHistory', artifactId\)/)
  assert.match(source, /await close\(run\)/)
  assert.match(source, /await assert\.rejects\(fetch\(`\$\{oldOrigin\}\/api\/v1\/me`/)
  assert.match(source, /await rm\(profile, \{ recursive: true, force: true \}\)/)
  assert.doesNotMatch(source, /_electron|use-mock-keychain|saveState\(|startAttachmentSmokeEndpoint|store\.\w+\(/,
    'the ordinary launcher and shipped APIs are the only product authority')
  let previous = -1
  for (const stage of [
    'current-search-and-explicit-saved-search',
    'comparison-cancel-and-current-back',
    'unavailable-revision-no-fallback',
    'shared-and-foreign-privacy',
    'owner-confirmed-restore',
    'sqlite-and-ordinary-relaunch',
    'saved-search-and-receipt-replay-after-relaunch',
  ]) {
    const at = source.indexOf(`stage = '${stage}'`)
    assert.ok(at > previous, `packaged acceptance preserves the ordered ${stage} stage`)
    previous = at
  }
  for (const proof of [
    'assert.deepEqual(currentLibraryReads, []',
    'assert.deepEqual(mutations, []',
    "'Saved versions are available only to the artifact owner.'",
    'Restored version 0 as current version 2. You are still viewing saved version 0.',
    "'ordinary relaunch preserves the signed-in owner'",
    'assert.deepEqual(replay, restoreResult',
    'assert.deepEqual(finalSqliteHistory, historyBeforeQuit)',
    'asarSha256: asarHash',
  ]) assert.ok(source.includes(proof), `packaged acceptance must retain ${proof}`)
})
