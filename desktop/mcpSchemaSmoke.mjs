/** Packaged MCP JSON Schema worker acceptance.
 *
 * A harness-created fixed driver runs in Electron's utility-process Node
 * environment and imports the shipped validator through app.getAppPath(). The
 * product main/preload/renderer gain no test bridge, and this phase performs no
 * external I/O or tool execution.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron } from '@playwright/test'
import { packagedExecutable } from './smokePaths.mjs'

const TIMEOUT_MS = 30_000
const RESULT_TYPE = 'agent-commons:mcp-schema-smoke'
const DRIVER_SOURCE = `
const send = value => process.parentPort?.postMessage(value)
try {
  const modulePath = process.argv.at(-1)
  if (!process.parentPort || !modulePath) throw new Error('missing utility-process authority')
  const { pathToFileURL } = await import('node:url')
  const { createRequire } = await import('node:module')
  const { validateMcpSchema } = await import(pathToFileURL(modulePath).href)
  // Resolve from the shipped validator's ASAR path so this probes the exact
  // dependency the packaged worker uses, never the harness or checkout tree.
  const fastUri = createRequire(modulePath)('fast-uri')
  const encodedHost = '//%41.example'
  const plainHost = '//a.example'
  const uriNormalization = {
    parsedHost: fastUri.parse(encodedHost).host,
    plainParsedHost: fastUri.parse(plainHost).host,
    normalizedEqual: fastUri.normalize(encodedHost) === fastUri.normalize(plainHost),
    equal: fastUri.equal(encodedHost, plainHost),
  }
  const objectSchema = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] }
  const valid = await validateMcpSchema(objectSchema, { value: { count: 7 } })
  const invalid = await validateMcpSchema(objectSchema, { value: { count: '7' } })
  const schemeRelativeSchema = {
    $id: 'https://schemas.example/root',
    type: 'object', required: ['value'],
    properties: { value: { $ref: '//schemas.example/embedded/integer' } },
    $defs: { integer: { $id: '//%53chemas.example/embedded/integer', type: 'integer' } },
  }
  const schemeRelativeValid = await validateMcpSchema(schemeRelativeSchema, { value: { value: 7 } })
  const schemeRelativeInvalid = await validateMcpSchema(schemeRelativeSchema, { value: { value: '7' } })
  const unregisteredSchemeRelative = await validateMcpSchema({ $ref: '//remote.example/unregistered-schema' })
  const pathological = { type: 'string', pattern: '^(a+)+$' }
  const attack = { value: 'a'.repeat(42) + '!' }
  const timeout = await validateMcpSchema(pathological, attack, { timeoutMs: 100 })
  const afterTimeout = await validateMcpSchema(objectSchema, { value: { count: 8 } })
  const controllers = Array.from({ length: 4 }, () => new AbortController())
  const occupied = controllers.map(controller => validateMcpSchema(pathological, attack, {
    signal: controller.signal, timeoutMs: 5000,
  }))
  const saturated = await validateMcpSchema(objectSchema, { value: { count: 9 } })
  for (const controller of controllers) controller.abort('packaged fixture cancellation')
  const terminating = await validateMcpSchema(objectSchema, { value: { count: 10 } })
  const cancelled = await Promise.all(occupied)
  const recovered = await validateMcpSchema(objectSchema, { value: { count: 11 } })
  send({ type: '${RESULT_TYPE}', ok: true, runtimeUndici: process.versions.undici, results: {
    uriNormalization, valid, invalid, schemeRelativeValid, schemeRelativeInvalid,
    unregisteredSchemeRelative, timeout, afterTimeout, saturated, terminating, cancelled, recovered,
  } })
} catch (error) {
  send({ type: '${RESULT_TYPE}', ok: false, stage: 'driver', message: error instanceof Error ? error.message.slice(0, 512) : 'unknown' })
  process.exitCode = 1
}
`

async function runPackagedDriver(app, driverPath) {
  const modulePath = join(await app.evaluate(({ app }) => app.getAppPath()), 'server', 'mcpSchema.ts')
  return app.evaluate(async ({ app, utilityProcess }, input) => {
    const child = utilityProcess.fork(input.driverPath, [input.modulePath], {
      cwd: app.getPath('userData'),
      env: {},
      serviceName: 'Agent Commons Schema Acceptance',
      stdio: 'pipe',
    })
    child.stdout?.resume()
    child.stderr?.resume()
    const result = await new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off?.('message', onMessage)
        if (error) reject(error)
        else resolve(value)
      }
      const onMessage = message => {
        if (message?.type !== input.resultType) return
        if (message.ok === true) finish(null, message)
        else finish(new Error(`Packaged schema driver failed (${message?.stage ?? 'unknown'}).`))
      }
      const timer = setTimeout(() => {
        child.kill()
        finish(new Error('Packaged schema driver timed out.'))
      }, input.timeoutMs)
      child.on('message', onMessage)
      child.once('exit', (code) => finish(new Error(`Packaged schema driver exited before acknowledgement (${code}).`)))
    })
    child.kill()
    return { packaged: app.isPackaged, result }
  }, { driverPath, modulePath, resultType: RESULT_TYPE, timeoutMs: TIMEOUT_MS })
}

export function assertReviewedEmbeddedUndici(runtimeUndici) {
  assert.match(runtimeUndici, /^\d+\.\d+\.\d+$/, 'the packaged utility process reports its embedded Undici version')
  const [major, minor, patch] = runtimeUndici.split('.').map(Number)
  assert.equal(runtimeUndici, [major, minor, patch].join('.'), 'the embedded version is canonical')
  // Electron 44 embeds the reviewed 7.x line. The 7.30.1 security release fixes
  // GHSA-2m5v-pch6-74hx and related advisories; larger majors need a fresh review.
  assert.ok(major === 7 && (minor > 30 || (minor === 30 && patch >= 1)),
    'the packaged Node runtime must include the Undici 7.30.1 security fixes')
}

export async function smokePackagedMcpSchema({ executable = packagedExecutable() } = {}) {
  if (!existsSync(executable)) throw new Error(`Packaged desktop executable is missing: ${executable}`)
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'agent-commons-schema-worker-'))
  const userDataPath = join(fixtureRoot, 'profile')
  const driverPath = join(fixtureRoot, 'schema-driver.mjs')
  let app
  try {
    await writeFile(driverPath, DRIVER_SOURCE, { flag: 'wx', mode: 0o600 })
    app = await _electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userDataPath}`],
      chromiumSandbox: true,
      timeout: TIMEOUT_MS,
    })
    const page = await app.firstWindow({ timeout: TIMEOUT_MS })
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: TIMEOUT_MS })
    const actual = await runPackagedDriver(app, driverPath)
    assert.equal(actual.packaged, true, 'schema acceptance must launch the packaged application')
    // npm audit cannot see Node's embedded copy. Probe the executable, not the
    // separate npm package used by the Electron downloader.
    const runtimeUndici = actual.result.runtimeUndici
    assertReviewedEmbeddedUndici(runtimeUndici)
    assert.deepEqual(actual.result, {
      type: RESULT_TYPE,
      ok: true,
      runtimeUndici,
      results: {
        uriNormalization: {
          parsedHost: 'a.example', plainParsedHost: 'a.example', normalizedEqual: true, equal: true,
        },
        valid: { ok: true },
        invalid: { ok: false, code: 'invalid_value' },
        schemeRelativeValid: { ok: true },
        schemeRelativeInvalid: { ok: false, code: 'invalid_value' },
        unregisteredSchemeRelative: { ok: false, code: 'invalid_schema' },
        timeout: { ok: false, code: 'limit' },
        afterTimeout: { ok: true },
        saturated: { ok: false, code: 'unavailable' },
        terminating: { ok: false, code: 'unavailable' },
        cancelled: Array.from({ length: 4 }, () => ({ ok: false, code: 'cancelled' })),
        recovered: { ok: true },
      },
    })
    console.log(`[desktop-schema-smoke] packaged ASAR validator · canonical URI hosts · embedded Undici ${runtimeUndici} · Ajv 2020-12 · timeout/cancellation · bounded-capacity recovery`)
  } finally {
    await app?.close().catch(() => {})
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}
