import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ignoreFromPackage } from './packager.config.mjs'

test('local Contribution MCP acceptance cannot ship its loopback fixture or widen release startup', () => {
  for (const path of ['desktop/contributionMcpSmoke.mjs', 'desktop/contributionMcpSmokeFixture.mjs', 'desktop/mcpLoopbackSmokePackage.mjs']) {
    assert.equal(ignoreFromPackage(path), true, `${path} is test authority, never shipped runtime`)
  }
  const startup = readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8')
  assert.equal(startup.split('allowLoopback: false,').length - 1, 1, 'release startup has exactly one public-only MCP choice')
  assert.equal(startup.includes('allowLoopback: true'), false)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['desktop:smoke:mcp-effects'], 'node desktop/contributionMcpSmoke.mjs')
  assert.ok(pkg.scripts['desktop:verify'].endsWith(' && npm run desktop:smoke:mcp-effects'), 'native verification includes the isolated fixture gate')
  const release = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8')
  assert.equal(release.includes('contributionMcpSmoke'), false, 'signed candidate acceptance never substitutes a modified fixture copy')
})
