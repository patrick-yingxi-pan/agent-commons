import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT } from './helpers/source.ts'

test('the E2E reset removes only its exact live store and atomic recovery companions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-e2e-wipe-'))
  const store = join(directory, 'shard.json')
  const targets = [store, `${store}.tmp`, `${store}.corrupt`]
  const neighbour = join(directory, 'other-shard.json')
  try {
    for (const target of targets) writeFileSync(target, 'test-only')
    writeFileSync(neighbour, 'keep')
    const run = spawnSync(process.execPath, [join(ROOT, 'e2e', 'wipe-store.mjs')], {
      env: { ...process.env, DATA_FILE: store },
      encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr)
    for (const target of targets) assert.equal(existsSync(target), false, `${target} was removed`)
    assert.equal(existsSync(neighbour), true, 'another shard is untouched')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
