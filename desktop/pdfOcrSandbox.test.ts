import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPdfOcrHelper, pdfOcrHelperBuildPlan } from './pdfOcrHelperBuild.mjs'

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 512 * 1024 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}

function probe(plan, input) {
  const result = spawnSync(plan.brokerExecutablePath, [], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000, maxBuffer: 512 * 1024,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

async function eventually(read, message) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await delay(25)
  }
  assert.fail(message)
}

test('real XPC sandbox denies non-container files/network and terminates an uncooperative decoder with its broker', {
  skip: process.platform !== 'darwin',
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-pdf-sandbox-'))
  const outputPath = join(directory, 'PDF OCR.app')
  const plan = pdfOcrHelperBuildPlan({ outputPath })
  const server = createServer(socket => { socket.destroy() })
  let child
  try {
    buildPdfOcrHelper({ outputPath })
    // Only the decoder is substituted. The actual production broker/service,
    // signature policy and generated entitlements remain in this signed bundle.
    const engine = fileURLToPath(new URL('./native/pdf-ocr.m', import.meta.url))
    const replacement = fileURLToPath(new URL('./native/pdf-ocr-sandbox-probe.m', import.meta.url))
    assert.ok(plan.serviceArgs.includes(engine))
    command(plan.compiler, plan.serviceArgs.map(arg => arg === engine ? replacement : arg))
    // osx-sign discovers the XPC main Mach-O rather than the .xpc directory.
    // codesign must reseal the actual bundle when invoked on that executable.
    command(plan.signer, [...plan.serviceSignArgs.slice(0, -1), plan.serviceExecutablePath])
    command(plan.signer, ['--verify', '--strict', '--deep', plan.serviceBundlePath])
    command(plan.signer, plan.brokerSignArgs)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const sentinel = join(directory, 'generated-private-sentinel')
    writeFileSync(sentinel, 'sandbox must not read this generated file', { flag: 'wx', mode: 0o600 })
    assert.ok(readFileSync(sentinel).length > 0)
    const input = { path: sentinel, port: server.address().port }
    const result = probe(plan, input)
    assert.equal(result.status, 'ready')
    const observed = JSON.parse(result.text)
    assert.deepEqual({ ...observed, pid: undefined }, { fileOpened: false, fileError: 1, fileWritten: false, writeError: 1, connected: false, networkError: 1, pid: undefined })
    assert.ok(observed.pid > 1)

    child = spawn(plan.brokerExecutablePath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(JSON.stringify({ wait: true }))
    const servicePID = await eventually(() => {
      const ps = command('/bin/ps', ['-axo', 'pid=,comm=']).stdout
      const line = ps.split('\n').find(line => line.trim().endsWith(plan.serviceExecutablePath))
      return line ? Number(line.trim().split(/\s+/)[0]) : null
    }, 'the authenticated XPC service started its deliberately stuck decoder')
    const closed = once(child, 'close')
    child.kill('SIGKILL')
    await closed
    child = undefined
    await eventually(() => {
      try { process.kill(servicePID, 0); return false } catch (error) { return error.code === 'ESRCH' }
    }, 'broker death must terminate the real service process, not merely fence its result')
    assert.equal(probe(plan, input).status, 'ready', 'a fresh authenticated service works after forced cancellation')

    // An intact enclosing bundle is not enough: changing the transport's
    // signature must fail the service's pinned peer requirement at message time.
    const originalTransport = readFileSync(plan.brokerExecutablePath)
    command(plan.signer, ['--force', '--sign', '-', '--identifier', 'com.agentcommons.test.untrusted', plan.brokerExecutablePath])
    command(plan.signer, plan.brokerSignArgs)
    const rejectedPeer = spawnSync(plan.brokerExecutablePath, [], {
      input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000, maxBuffer: 512 * 1024,
    })
    assert.equal(rejectedPeer.error, undefined)
    assert.notEqual(rejectedPeer.status, 0, 'the real XPC service refuses a different signed transport')
    assert.equal(rejectedPeer.stdout, '')
    writeFileSync(plan.brokerExecutablePath, originalTransport)
    command(plan.signer, plan.brokerSignArgs)
    assert.equal(probe(plan, input).status, 'ready')

    // Watch the denial assertion fail with the test-only service unsandboxed;
    // this generated bundle never contains the production PDF decoder.
    command(plan.signer, ['--force', '--sign', '-', '--entitlements', plan.brokerEntitlementPath, plan.serviceBundlePath])
    command(plan.signer, plan.brokerSignArgs)
    const unconfined = JSON.parse(probe(plan, input).text)
    assert.equal(unconfined.fileOpened, true)
    assert.equal(unconfined.fileWritten, true)
    assert.equal(unconfined.connected, true)
    assert.throws(() => assert.equal(unconfined.fileOpened, false), assert.AssertionError)
    command(plan.signer, plan.serviceSignArgs)
    command(plan.signer, plan.brokerSignArgs)
    assert.equal(JSON.parse(probe(plan, input).text).fileOpened, false)

    // Tampering the nested resource invalidates the enclosing broker seal.
    const info = readFileSync(plan.serviceInfoPath, 'utf8')
    writeFileSync(plan.serviceInfoPath, info.replace('PDF OCR Service', 'Tampered Service'))
    assert.deepEqual(probe(plan, input), { status: 'unavailable' })
  } finally {
    if (child) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed }
    await new Promise(resolve => server.close(resolve))
    rmSync(directory, { recursive: true, force: true })
  }
})
