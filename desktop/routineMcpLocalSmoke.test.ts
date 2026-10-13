import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('local Routine acceptance cannot enter the shipped app or signed-candidate lane', () => {
  for (const path of ['desktop/routineMcpLocalSmoke.mjs', 'desktop/routineMcpLocalSmokePeer.mjs', 'desktop/routineMcpLocalRestoreFixture.mjs']) {
    assert.equal(ignoreFromPackage(path), true, `${path} must never ship`)
  }
  for (const name of ['./smoke.mjs', './release.mjs']) assert.doesNotMatch(source(name), /routineMcpLocalSmoke/)
  const smoke = source('./routineMcpLocalSmoke.mjs')
  assert.doesNotMatch(smoke, /_electron|\bstore\.\w+\(/, 'ordinary launch preserves real OS custody and real product APIs')
  for (const invariant of [
    'createMcpFixturePackage(executable', 'mcpStdioSmokePatches()', 'routineMcpLocalRestorePatches(',
    "name: 'Approve these tools'", "name: 'Back to choices'", "name: 'Revoke approval'",
    "name: 'Run now'", "name: 'Restore backup…'", "name: 'Back up now'",
    'full native relaunch preserves the signed-in person',
    'startup failure sent no tool call', 'explicit restore withdraws local-program approval',
    'actual restore replaced SQLite with the chosen earlier state',
    'safety backup preserves post-backup work',
    'restored queued work must be interrupted before admission',
    "name: 'Stop this run'", 'stopped child exits before another run is admitted',
    'Stop survives a full native relaunch without replay',
    'rendered Run now is durably acknowledged before reading its history',
    'assert.equal(queuedRun.runId, queuedStart.id)',
    "stored(profile, 'routineMcp')", "mode('hold-startup')", "mode('hold-call')",
  ]) assert.ok(smoke.includes(invariant), `local native acceptance must retain ${invariant}`)
})
