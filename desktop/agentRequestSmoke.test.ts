import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

test('the excluded Agent Requests acceptance helper parses before native launch', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('./agentRequestSmoke.mjs', import.meta.url))], { stdio: 'pipe' })
})

test('private Agent Requests packaged acceptance is mandatory locally and excluded from shipped application', () => {
  assert.equal(ignoreFromPackage('/desktop/agentRequestSmoke.mjs'), true)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['desktop:smoke:agent-requests'], 'node desktop/agentRequestSmoke.mjs')
  assert.equal(pkg.scripts['desktop:verify'].split(' && ').filter(command => command === 'npm run desktop:smoke:agent-requests').length, 1)

  const source = readFileSync(new URL('./agentRequestSmoke.mjs', import.meta.url), 'utf8')
  for (const required of [
    'createMcpFixturePackage(executable, mcpStdioSmokePatches())',
    'launchPackagedDesktop(fixture.executable, profile)',
    "api(page, '/auth/signup'",
    "api(page, '/auth/session'",
    "api(page, '/agent-request-options')",
    "api(page, `/agent-requests/${first.id}`)",
    "name: 'Run once', exact: true",
    "name: 'Share reply', exact: true",
    "execution.status, 'uncertain'",
    'toolCalls(afterRestart).length, 2',
    'fixture?.close()',
  ]) assert.ok(source.includes(required), `packaged acceptance retains ${required}`)
  assert.equal(source.includes('mcpStdioSmokeReviewCount'), false, 'Agent Requests reuses the exact stdio setup fixture')
  assert.equal(source.includes("process.env[GATE] = '1'"), true, 'only the disposable stdio fixture gate is enabled')
  assert.equal(source.includes('assert.deepEqual(storedRequest(profile, second.id), recovered)'), false,
    'stored private rows are compared through their persisted lifecycle, not their different public view shape')
})
