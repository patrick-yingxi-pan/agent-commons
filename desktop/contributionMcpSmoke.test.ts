import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

test('local Contribution MCP acceptance cannot ship its loopback fixture or widen release startup', () => {
  const smoke = readFileSync(new URL('./contributionMcpSmoke.mjs', import.meta.url), 'utf8')
  for (const path of ['desktop/contributionMcpSmoke.mjs', 'desktop/contributionMcpSmokeFixture.mjs', 'desktop/mcpLoopbackSmokePackage.mjs']) {
    assert.equal(ignoreFromPackage(path), true, `${path} is test authority, never shipped runtime`)
  }
  assert.match(smoke, /smokePackagedAutomationPosture\(\{ executable, launch: launchPackagedDesktop, close: closePackagedDesktop \}\)/,
    'the native acceptance checks automation posture against the original executable')
  assert.match(smoke, /features\?\.simulatedAutomation, false/)
  for (const path of ['/dispatch', '/projects/${project.project.id}/effects', '/agents/${agent.id}/proxy']) {
    assert.ok(smoke.includes(path), `the packaged release gate probes ${path}`)
  }
  assert.ok(smoke.includes("assert.equal(posted.status, 'open', 'a valid native work post stays open despite an eligible standing Agent')"))
  assert.ok(smoke.includes("assert.equal(a2a.result?.status?.state, 'submitted', 'accepted A2A work stays submitted, not synthetically completed')"))
  assert.match(smoke, /await rm\(profile, \{ recursive: true, force: true \}\)/,
    'the release-posture fixture profile is cleaned independently of loopback acceptance')
  const startup = readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8')
  assert.equal(startup.split('allowLoopback: false,').length - 1, 1, 'release startup has exactly one public-only MCP choice')
  assert.equal(startup.includes('allowLoopback: true'), false)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['desktop:smoke:mcp-effects'], 'node desktop/contributionMcpSmoke.mjs')
  assert.equal(pkg.scripts['desktop:verify'].split(' && ').filter(command => command === 'npm run desktop:smoke:mcp-effects').length, 1,
    'native verification includes the isolated fixture gate exactly once')
  const release = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8')
  assert.equal(release.includes('contributionMcpSmoke'), false, 'signed candidate acceptance never substitutes a modified fixture copy')
})
