import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Commission acceptance is excluded, separately runnable and never signed-candidate smoke', () => {
  for (const path of ['desktop/commissionMcpSmoke.mjs', 'desktop/commissionMessagesSmokeFixture.mjs']) {
    assert.equal(ignoreFromPackage(path), true, `${path} must never ship`)
  }
  for (const path of ['./smoke.mjs', './release.mjs']) assert.doesNotMatch(source(path), /commissionMcpSmoke/)
  const scripts = JSON.parse(source('../package.json')).scripts
  assert.equal(scripts['desktop:smoke:commission-mcp'], 'node desktop/commissionMcpSmoke.mjs')
  assert.equal(scripts['desktop:verify'].split('npm run desktop:smoke:commission-mcp').length - 1, 1)
})

test('Commission packaged walk retains actual process, UI, custody and durable recovery evidence', () => {
  const smoke = source('./commissionMcpSmoke.mjs')
  for (const invariant of [
    'createMcpLoopbackSmokePackage(executable)',
    'original package refuses without contacting the peer',
    "name: 'Approve unattended work', exact: true",
    "name: 'Revoke approval', exact: true",
    "name: 'Refresh review', exact: true",
    "stored(profile, 'commissionMcp')", "stored(profile, 'usageReservations')",
    "toContainText('Outcome uncertain'", "status: 404",
    'process exit leaves submitted work pending for startup recovery',
    'ordinary account remains signed in across full native relaunch',
    'no hidden repeat model preparation', 'startup withdraws the interrupted grant',
    'window.agentCommonsDesktop.mcpCredentials.provision',
    'window.agentCommonsDesktop.data.createBackup()',
    'sourceAsarSha256: fixturePackage.sourceAsarSha256',
  ]) assert.ok(smoke.includes(invariant), `packaged evidence must retain ${invariant}`)
  assert.match(smoke, /await closePackagedDesktop\(run\)[\s\S]*?await launchPackagedDesktop\(fixturePackage\.executable, profile\)/)
  assert.doesNotMatch(smoke, /_electron|store\.\w+\(/, 'no in-memory product store or test bridge replaces the packaged workflow')
})
