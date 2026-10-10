import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Routine MCP native acceptance fixtures are excluded and separate from signed-candidate smoke', () => {
  for (const path of ['desktop/routineMcpSmoke.mjs', 'desktop/routineMcpSmokeFixture.mjs', 'desktop/routineMessagesSmokeFixture.mjs']) {
    assert.equal(ignoreFromPackage(path), true, `${path} must never ship`)
  }
  const smoke = source('./smoke.mjs')
  assert.doesNotMatch(smoke, /routineMcpSmoke/, 'loopback-mutated acceptance cannot run against the signed candidate path')
  const acceptance = source('./routineMcpSmoke.mjs')
  for (const invariant of [
    'createMcpLoopbackSmokePackage(executable)',
    'getByRole(\'button\', { name: \'Approve these tools\', exact: true })',
    'getByRole(\'button\', { name: \'Revoke approval\', exact: true })',
    'startRoutineMessagesSmokeFixture()',
    'startRoutineMcpSmokePeer()',
    'persistedRoutineMcp(profile)',
    'ordinary account remains signed in across full native relaunch',
  ]) assert.ok(acceptance.includes(invariant), `native evidence must retain ${invariant}`)
  assert.match(acceptance, /await close\(run\)[\s\S]*?await launch\(fixturePackage\.executable, profile\)/)
  assert.match(acceptance, /peer\.calls\.length, 1/)
  assert.doesNotMatch(acceptance, /_electron|store\.\w+\(/, 'the smoke uses the real packaged host/API, not a product test bridge')
  const release = source('./release.mjs')
  assert.doesNotMatch(release, /routineMcpSmoke/)
})

test('local acceptance peers are loopback-only and model tool-use is tied to the reviewed capability', () => {
  const peer = source('./routineMcpSmokeFixture.mjs')
  const model = source('./routineMessagesSmokeFixture.mjs')
  assert.match(peer, /server\.listen\(0, '127\.0\.0\.1'/)
  assert.match(peer, /params\?\.name !== ROUTINE_MCP_SMOKE_TOOL\.name/)
  assert.match(model, /server\.listen\(0, '127\.0\.0\.1'/)
  assert.match(model, /description\?\.includes\('Unattended Routine permission'\)/)
  assert.match(model, /holdFinal\(\)/)
})
