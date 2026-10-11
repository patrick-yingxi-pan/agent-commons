import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../tests/helpers/source.ts'
import { oauthSmokePatches } from './mcpOAuthSmoke.mjs'
import { ignoreFromPackage } from './packager.config.mjs'

test('OAuth fixture transforms only known networking/browser seams in an excluded disposable package helper', () => {
  const patches = oauthSmokePatches('http://127.0.0.1:49152')
  assert.equal(patches.length, 6)
  for (const patch of patches) {
    const source = readFileSync(join(ROOT, patch.path), 'utf8')
    assert.equal(source.split(patch.before).length - 1, 1, `unique packaged patch target ${patch.path}`)
  }
  assert.deepEqual([...new Set(patches.map(row => row.path))], ['desktop/mcpOAuthHttp.mjs', 'server/mcpHttpTransport.ts', 'desktop/main.mjs'])
  assert.ok(patches.every(row => !row.before.includes('allowLoopback')))
  for (const path of ['/desktop/mcpOAuthSmoke.mjs', '/desktop/mcpOAuthSmokeFixture.mjs', '/desktop/mcpOAuthMessagesSmokeFixture.mjs', '/desktop/mcpLoopbackSmokePackage.mjs']) {
    assert.equal(ignoreFromPackage(path), true)
  }
  assert.throws(() => oauthSmokePatches('https://public.example'), assert.AssertionError)
})
