import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { buildGitFileTestHelper } from './gitFileTestFixture.mjs'
import { gitFileExecutable } from './gitFilePaths.mjs'
import { ignoreFromPackage } from './packager.config.mjs'

test('native Git suites never compile into the shared development executable', () => {
  const offenders = readdirSync(new URL('.', import.meta.url))
    .filter(name => name.endsWith('.test.ts'))
    .filter(name => /buildGitFileHelper\(\s*\)/.test(readFileSync(new URL(name, import.meta.url), 'utf8')))
  assert.deepEqual(offenders, [])
  assert.equal(ignoreFromPackage('/desktop/gitFileTestFixture.mjs'), true)
})

test('native Git fixture builds use independent executable identities', { skip: process.platform !== 'darwin' }, () => {
  const first = buildGitFileTestHelper()!
  const second = buildGitFileTestHelper()!
  assert.notEqual(first, second)
  assert.notEqual(first, gitFileExecutable())
  assert.notEqual(second, gitFileExecutable())
  assert.notEqual(statSync(first).ino, statSync(second).ino)
  assert.equal(statSync(first).mode & 0o777, 0o755)
  assert.deepEqual(readFileSync(first), readFileSync(second), 'isolation must not change the native helper bytes')
})
