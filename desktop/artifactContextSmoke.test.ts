import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { readSqliteArtifactContext } from './artifactContextSmoke.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('packaged Artifact context acceptance helper stays out of the shipped application', () => {
  assert.equal(ignoreFromPackage('/desktop/artifactContextSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/artifactContextSmoke.test.ts'), true)
})

test('ordinary packaged Discussion run invokes a separate Artifact context workflow and keeps both in the real profile', () => {
  const discussion = source('./discussionContextSmoke.mjs')
  assert.match(discussion, /import \{ smokePackagedArtifactContext \} from '\.\/artifactContextSmoke\.mjs'/)
  assert.equal([...discussion.matchAll(/await smokePackagedArtifactContext\(/g)].length, 1)
  assert.match(discussion, /await verifyConversationSearchSmoke\([\s\S]*?phase: 'after-relaunch'[\s\S]*?\n\s*run = await smokePackagedArtifactContext/)
  assert.match(discussion, /smokePackagedArtifactContext\(\{ run, executable, profile, launch, close, request, owner, providerId: provider\.id, fixture \}/)
  assert.match(discussion, /finally[\s\S]*await close\(run\)/,
    'the caller owns cleanup of the final relaunched packaged process')
})

test('Artifact acceptance proves rendered exact-copy boundaries, model input, and ordinary relaunch', () => {
  const smoke = source('./artifactContextSmoke.mjs')
  assert.match(smoke, /page\.getByRole\('button', \{ name: 'Add context', exact: true \}\)/)
  assert.match(smoke, /Attach saved copy/)
  assert.match(smoke, /getByRole\('button', \{ name: 'Refresh copy', exact: true \}\)/)
  assert.match(smoke, /Remove Artifact context/)
  assert.match(smoke, /artifactSnapshotText|exactSnapshotText/)
  assert.match(smoke, /artifact_kind: snapshot\.artifactKind[\s\S]*revision: snapshot\.revision[\s\S]*text: snapshotText/)
  assert.match(smoke, /Artifact entries are frozen saved copies of the complete readable body/)
  assert.match(smoke, /destination reader has no source Artifact grant/)
  assert.match(smoke, /const deletion = await api\(page, `\/artifacts\/\$\{source\.id\}`,[\s\S]*permanently deletes the reviewed source/)
  assert.match(smoke, /await close\(run\)[\s\S]*await launch\(executable, profile\)/)
  assert.match(smoke, /SQLite rehydration does not recapture or alter the saved Artifact/)
  assert.match(smoke, /rendered-detach/)
  assert.doesNotMatch(smoke, /_electron|use-mock-keychain|mock-keychain|store\.\w+\(/)
})

test('SQLite reader returns only the exact Artifact snapshot from the addressed workspace', () => {
  const profile = mkdtempSync(join(tmpdir(), 'artifact-context-sqlite-test-'))
  const database = new DatabaseSync(join(profile, 'store.db'))
  const snapshot = {
    version: 1,
    snapshotId: 'snapshot-exact',
    capturedAt: '2026-10-08T12:00:00.000Z',
    artifactId: 'artifact-exact',
    title: 'Exact artifact',
    artifactKind: 'doc',
    revision: 7,
    body: { type: 'doc', title: 'Exact artifact', blocks: [{ id: 'block-a', p: 'Exact saved bytes.' }] },
  }
  try {
    database.exec('CREATE TABLE map_entries (slice TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL)')
    database.prepare('INSERT INTO map_entries (slice, key, json) VALUES (?, ?, ?)').run('workspaces', 'session-exact', JSON.stringify({
      attachments: [{ id: 'artifact::artifact-exact', kind: 'artifact', label: 'Exact artifact', artifactSnapshot: snapshot }],
    }))
    assert.deepEqual(readSqliteArtifactContext(profile, 'session-exact', 'artifact-exact'), snapshot)
    assert.throws(() => readSqliteArtifactContext(profile, 'session-other', 'artifact-exact'), /SQLite retains the exact destination workspace/)
    assert.throws(() => readSqliteArtifactContext(profile, 'session-exact', 'artifact-other'), /SQLite retains the exact Artifact attachment identity/)
  } finally {
    database.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
