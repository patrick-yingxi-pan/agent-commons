import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Commission acceptance is excluded, separately runnable and never signed-candidate smoke', () => {
  for (const path of ['desktop/commissionMcpSmoke.mjs', 'desktop/commissionMessagesSmokeFixture.mjs',
    'desktop/routineMcpLocalRestoreFixture.mjs']) {
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
    'createMcpFixturePackage(executable, [',
    "{ path: 'scripts/start.mjs', before: 'allowLoopback: false,', after: 'allowLoopback: true,' }",
    'routineMcpLocalRestorePatches({ controlPath: restoreControl, tracePath: restoreTrace })',
    'original package refuses without contacting the peer',
    "name: 'Approve unattended work', exact: true",
    "name: 'Revoke approval', exact: true",
    "name: 'Refresh review', exact: true",
    "stored(profile, 'commissionMcp')", "stored(profile, 'usageReservations')",
    "toContainText('Outcome uncertain'", "status: 404",
    'graceful shutdown durably records uncertainty before process exit',
    'ordinary account remains signed in across full native relaunch',
    'no hidden repeat model preparation', 'shutdown withdraws the interrupted grant',
    'window.agentCommonsDesktop.mcpCredentials.provision',
    'window.agentCommonsDesktop.data.createBackup()',
    "name: 'Restore backup…', exact: true",
    'real native Commission restore exits successfully',
    'native restore makes exactly one fresh safety copy',
    'actual restore replaced SQLite with the chosen earlier state',
    'restore retains every interrupted receipt field except its terminal status and finish time',
    'queued work has no claim before restore',
    'restored open work is blocked even without an earlier claim',
    'reapproval cannot admit restored queued work',
    'only new work can earn another completion after restore',
    'sourceAsarSha256: fixturePackage.sourceAsarSha256',
  ]) assert.ok(smoke.includes(invariant), `packaged evidence must retain ${invariant}`)
  assert.match(smoke, /await closePackagedDesktop\(run\)[\s\S]*?await launchPackagedDesktop\(fixturePackage\.executable, profile\)/)
  assert.doesNotMatch(smoke, /_electron|\bstore\.\w+\(/, 'no in-memory product store or test bridge replaces the packaged workflow')
})
