import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('local Commission packaged acceptance stays out of the shipped app and signed-candidate lane', () => {
  assert.equal(ignoreFromPackage('desktop/commissionMcpLocalSmoke.mjs'), true)
  for (const name of ['./smoke.mjs', './release.mjs']) assert.doesNotMatch(source(name), /commissionMcpLocalSmoke/)
  const scripts = JSON.parse(source('../package.json')).scripts
  assert.equal(scripts['desktop:smoke:commission-local-mcp'], 'node desktop/commissionMcpLocalSmoke.mjs')
  assert.equal(scripts['desktop:verify'].split('npm run desktop:smoke:commission-local-mcp').length - 1, 1)
})

test('local Commission acceptance proves authored stdio, explicit owner consent and durable no-replay recovery', () => {
  const smoke = source('./commissionMcpLocalSmoke.mjs')
  for (const invariant of [
    "join(ROOT, 'desktop', 'routineMcpLocalSmokePeer.mjs')",
    'createMcpFixturePackage(executable, [...mcpStdioSmokePatches()',
    'routineMcpLocalRestorePatches({ controlPath: restoreControl, tracePath: restoreTrace })',
    'fixturePackage.sourceAsarSha256', 'fixturePackage.fixtureAsarSha256',
    'I understand and explicitly approve unattended local-program launch. Agent Commons does not sandbox this program; it may have normal OS access and possible startup effects.',
    "getByRole('checkbox', { name: 'I understand and explicitly approve unattended local-program launch.",
    "getByRole('button', { name: 'Approve unattended work', exact: true })).toBeDisabled()",
    'approval.localPrograms, true', "transport, 'stdio'", "method === 'tools/call'",
    "mode('hold-startup')", 'model.preparations.length, 2',
    'startup failure sends no tools/call after the one known success',
    'revoke removes permission but retains exact local transport provenance',
    "name: 'Restore backup…', exact: true", 'actual restore replaced SQLite with selected earlier state',
    'backup assertion selects the exact current policy revision',
    'restore preserves the exact known successful public receipt', 'restore preserves the exact known failed private claim',
    'restore changes only the pending public receipt state and finish time',
    'restore changes only the pending private receipt state and finish time',
    'every restored open work identity is blocked', 'actual native restore retains every exact settled model usage reservation',
    'completedWork.status', 'Commission contribution credit', 'failure-trace.json',
    'restore revokes approval but retains exact frozen local provenance',
    'renewal cannot replay represented pending work', 'renewal cannot admit restored queued work',
    'localConnectionIds', 'sourceAsarSha256: fixturePackage.sourceAsarSha256',
  ]) assert.ok(smoke.includes(invariant), `packaged local Commission evidence must retain ${invariant}`)
  assert.doesNotMatch(smoke, /_electron|\bstore\.\w+\(/, 'the acceptance uses the packaged app and real product routes')
  assert.match(smoke, /await closePackagedDesktop\(run\)[\s\S]*?await launchPackagedDesktop\(fixturePackage\.executable, profile\)/)
})
