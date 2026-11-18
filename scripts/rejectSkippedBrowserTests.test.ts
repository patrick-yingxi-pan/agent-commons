import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

test('the verifier reporter fails skipped browser cases and names each one', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'browser-skip-reporter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const playwright = createRequire(import.meta.url).resolve('@playwright/test')
  const cli = join(dirname(playwright), 'cli.js')
  const projectConfig = new URL('../playwright.config.ts', import.meta.url).href

  // Exercise Playwright's own skip/fixme outcomes without launching a browser.
  writeFileSync(join(root, 'playwright.config.mjs'), `
import config from ${JSON.stringify(projectConfig)}
export default { ...config, testDir: '.', outputDir: './test-results', webServer: undefined, retries: 0 }
`)
  writeFileSync(join(root, 'coverage.spec.cjs'), `
const { test } = require(${JSON.stringify(playwright)})
test.skip(false, 'inactive file annotation')
test('regular case', () => {})
test('inactive conditional case', () => { test.skip(false, 'condition is false') })
test.skip('declared skip', () => {})
test.fixme('declared fixme', () => {})
test('runtime skip', () => { test.skip(true, 'condition is true') })
`)

  function run(grep?: string) {
    const args = [cli, 'test', '--config', 'playwright.config.mjs']
    if (grep) args.push('--grep', grep)
    const result = spawnSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, VERIFY_BROWSER_COVERAGE: '1', E2E_HOST_FACTOR: '1', PWTEST_CACHE_DIR: join(root, 'cache'),
      },
    })
    assert.ifError(result.error)
    return { code: result.status, output: result.stdout + result.stderr }
  }

  const passing = run('regular case|inactive conditional case')
  assert.equal(passing.code, 0, passing.output)
  assert.match(passing.output, /2 passed/)

  const mixed = run()
  assert.equal(mixed.code, 1, mixed.output)
  for (const title of ['declared skip', 'declared fixme', 'runtime skip']) {
    assert.match(mixed.output, new RegExp(`Browser test skipped during verification: [^\\r\\n]*${title}`))
  }

  const allSkipped = run('declared skip|declared fixme')
  assert.equal(allSkipped.code, 1, allSkipped.output)
  assert.match(allSkipped.output, /Browser test skipped during verification: [^\r\n]*declared skip/)
  assert.match(allSkipped.output, /Browser test skipped during verification: [^\r\n]*declared fixme/)
})
