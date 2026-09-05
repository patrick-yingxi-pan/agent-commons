import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

test('E2E browser contexts never pin one shard’s app port', () => {
  const e2e = join(ROOT, 'e2e')
  const offenders = readdirSync(e2e, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => /baseURL:\s*['"]http:\/\/(?:127\.0\.0\.1|localhost):\d+/.test(readFileSync(join(e2e, file), 'utf8')))

  assert.deepEqual(
    offenders,
    [],
    'a fixed app baseURL crosses into the wrong backend under a sharded sweep; inherit Playwright’s active shard instead',
  )
})
