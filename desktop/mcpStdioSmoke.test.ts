import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import vm from 'node:vm'
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
  assert.equal(patches.length, 2)
  assert.deepEqual(patches.map(row => row.path), ['desktop/main.mjs', 'desktop/main.mjs'])
  const source = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8')
  for (const patch of patches) assert.equal(source.split(patch.before).length - 1, 1, 'each native review patch target is unique')
  const consent = patches[1]
  assert.match(consent.after, /launch\.executable === process\.env\.AC_MCP_STDIO_FIXTURE_EXECUTABLE/)
  assert.match(consent.after, /launch\.cwd === process\.env\.AC_MCP_STDIO_FIXTURE_CWD/)
  assert.match(consent.after, /JSON\.stringify\(launch\.args\) === process\.env\.AC_MCP_STDIO_FIXTURE_ARGS/)
  assert.match(consent.after, /JSON\.stringify\(launch\.env\) === process\.env\.AC_MCP_STDIO_FIXTURE_ENV/)
  assert.equal(consent.after.includes('showMessageBox'), false, 'the fixture explicitly is not an actual native-dialog acceptance')
  const transformed = patches.reduce((text, patch) => text.replace(patch.before, patch.after), source)
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: transformed, encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'the disposable packaged main remains valid JavaScript')
})

test('disposable consent cancels first and approves only the second exact fixture review', async () => {
  const launch = { executable: '/fixture/node', cwd: '/fixture', args: ['peer.mjs'], env: { TRACE: '/fixture/trace' } }
  const process = { env: { AC_MCP_STDIO_FIXTURE_ALLOW: '1', AC_MCP_STDIO_FIXTURE_EXECUTABLE: launch.executable,
    AC_MCP_STDIO_FIXTURE_CWD: launch.cwd, AC_MCP_STDIO_FIXTURE_ARGS: JSON.stringify(launch.args),
    AC_MCP_STDIO_FIXTURE_ENV: JSON.stringify(launch.env) } }
  const patch = mcpStdioSmokePatches()[1].after
  async function responses(source: string) {
    const review = vm.runInNewContext(`let mcpStdioSmokeReviewCount = 0;
      async function review(launch) { ${source}}); return result.response }; review`, { process, mainWindow: null })
    const output = []
    for (const field of ['executable', 'cwd', 'args', 'env']) output.push(await review({ ...launch, [field]: 'wrong' }))
    output.push(await review(launch), await review(launch), await review(launch))
    return output
  }
  assert.deepEqual(await responses(patch), [0, 0, 0, 0, 0, 1, 0])
  const mutant = patch.replace('++mcpStdioSmokeReviewCount === 2', 'true')
  assert.notEqual(mutant, patch)
  await assert.rejects(async () => assert.deepEqual(await responses(mutant), [0, 0, 0, 0, 0, 1, 0]), assert.AssertionError)
})

test('both packaged modes prove cancellation before a fresh configuration and approval', () => {
  const source = readFileSync(new URL('./mcpStdioSmoke.mjs', import.meta.url), 'utf8')
  const assertCancellation = (text: string) => {
    const cancelled = text.indexOf('data-mcp-stdio-phase="cancelled"')
    const reopened = text.indexOf('setup = await configure()', cancelled)
    assert.ok(cancelled > 0 && reopened > cancelled, 'fresh configuration follows the rendered cancellation')
    const refusal = text.slice(cancelled, reopened)
    for (const requirement of [
      'assert.deepEqual(await api(page, `/mcp-connections/${connectionId}`), connection',
      'assert.deepEqual(storedStdioConnection(profile, connectionId), savedBeforeCancel',
      'await assertNoLaunch()', "name: 'Close', exact: true",
    ]) assert.ok(refusal.includes(requirement), `cancelled setup must prove: ${requirement}`)
    for (const path of ['tracePath', 'grantPath']) {
      assert.ok(text.includes(`assert.rejects(readFile(${path}), { code: 'ENOENT' }`), `${path} must be absent, not merely unreadable`)
    }
    assert.equal(text.split('await assertNoLaunch()').length - 1, 2, 'no-process/custody precondition is checked before and after Cancel')
  }
  assertCancellation(source)
  const mutant = source.replaceAll('await assertNoLaunch()', 'void 0')
  assert.notEqual(mutant, source)
  assert.throws(() => assertCancellation(mutant), assert.AssertionError)
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
