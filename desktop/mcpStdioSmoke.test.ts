import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { mcpStdioSmokePatches, parseMcpStdioSmokeOptions } from './mcpStdioSmoke.mjs'

test('packaged local stdio acceptance and repository-owned peer are excluded from shipped application', () => {
  for (const path of ['/desktop/mcpStdioSmoke.mjs', '/desktop/mcpStdioSmokePeer.mjs',
    '/desktop/mcpLoopbackSmokePackage.mjs', '/desktop/mcpOAuthMessagesSmokeFixture.mjs']) {
    assert.equal(ignoreFromPackage(path), true, `${path} is acceptance-only`)
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['desktop:smoke:stdio'], 'node desktop/mcpStdioSmoke.mjs')
  assert.equal(pkg.scripts['desktop:verify'].split(' && ').filter(command => command === 'npm run desktop:smoke:stdio').length, 1,
    'the mandatory complete desktop verifier runs the local stdio acceptance exactly once')
})

test('fixture-only native approval patch is exact, unique, and confined to a disposable ASAR copy', () => {
  const patches = mcpStdioSmokePatches()
  assert.equal(patches.length, 1)
  assert.deepEqual(patches.map(row => row.path), ['desktop/main.mjs'])
  const source = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  assert.equal(source.split(patches[0].before).length - 1, 1, 'native review call is one exact fixture patch target')
  assert.match(patches[0].after, /launch\.executable === process\.env\.AC_MCP_STDIO_FIXTURE_EXECUTABLE/)
  assert.match(patches[0].after, /launch\.cwd === process\.env\.AC_MCP_STDIO_FIXTURE_CWD/)
  assert.match(patches[0].after, /JSON\.stringify\(launch\.args\) === process\.env\.AC_MCP_STDIO_FIXTURE_ARGS/)
  assert.match(patches[0].after, /JSON\.stringify\(launch\.env\) === process\.env\.AC_MCP_STDIO_FIXTURE_ENV/)
  assert.equal(patches[0].after.includes('showMessageBox'), false, 'the fixture explicitly is not an actual native-dialog acceptance')
  const transformed = source.replace(patches[0].before, patches[0].after)
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: transformed, encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'the disposable packaged main remains valid JavaScript')
})

test('native review is explicit, runs the original package without fixture consent, and checks its ASAR digest', () => {
  assert.deepEqual(parseMcpStdioSmokeOptions([]), { nativeReview: false })
  assert.deepEqual(parseMcpStdioSmokeOptions(['--native-review']), { nativeReview: true })
  assert.throws(() => parseMcpStdioSmokeOptions(['--native-review', '--unknown']), /Usage:/)
  const source = readFileSync(new URL('./mcpStdioSmoke.mjs', import.meta.url), 'utf8')
  assert.match(source, /if \(!nativeReview\) copied = await createMcpFixturePackage/)
  assert.match(source, /launchPackagedDesktop\(copied\?\.executable \?\? executable, profile\)/)
  assert.equal(source.split('launchPackagedDesktop(copied?.executable ?? executable, profile)').length - 1, 2,
    'both initial startup and durable relaunch use the original executable in native-review mode')
  assert.match(source, /for \(const key of GATE_KEYS\) delete process\.env\[key\]/)
  assert.match(source, /if \(!nativeReview\) \{[\s\S]*?process\.env\[GATE\] = '1'/)
  assert.match(source, /native-review-ready connection=/)
  assert.match(source, /setup\.getByRole\('button', \{ name: 'Review & inspect', exact: true \}\)\.click\(\{ timeout: 30_000 \}\)/)
  assert.match(source, /const sourceAsarSha256 = nativeReview \? await asarSha256\(sourceAsar\) : undefined/)
  assert.match(source, /await asarSha256\(sourceAsar\) !== sourceAsarSha256/)
})

test('packaged stdio setup uses exact textbox names for controlled JSON settings', () => {
  const source = readFileSync(new URL('./mcpStdioSmoke.mjs', import.meta.url), 'utf8')
  assert.match(source, /getByLabel\('Transport'\)\.selectOption\('stdio'\)/,
    'a nested select contributes option text to label lookup, matching the browser-proven selector')
  assert.match(source, /getByRole\('textbox', \{ name: 'Arguments \(JSON array\)', exact: true \}\)\.fill/)
  assert.match(source, /getByRole\('textbox', \{ name: 'Environment \(JSON object\)', exact: true \}\)\.fill/)
  assert.doesNotMatch(source, /getByLabel\('(Arguments|Environment) \(JSON/)
})

test('packaged stdio driver and local peer remain syntactically valid isolated fixtures', () => {
  for (const path of ['./mcpStdioSmoke.mjs', './mcpStdioSmokePeer.mjs']) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(path, import.meta.url))], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout || `${path} must parse`)
  }
  const peer = readFileSync(new URL('./mcpStdioSmokePeer.mjs', import.meta.url), 'utf8')
  assert.match(peer, /server\/discover/)
  assert.match(peer, /tools\/call/)
  assert.doesNotMatch(peer, /fetch\(|https?\.request|createConnection|process\.env\.(?:PATH|HOME)/,
    'the peer has no network fallback or ambient executable authority')
})
