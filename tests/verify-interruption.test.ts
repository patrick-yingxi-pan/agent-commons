import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConnection } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createVerifyInterruptionFixture, removeVerifyInterruptionFixture,
  startFixtureVerifier, waitForFixtureFile } from './helpers/verifyInterruptionFixture.mjs'

async function within<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`verify ${signal} drains its active owned lane before failing and publishing nothing`, { skip: process.platform === 'win32', timeout: 30_000 }, async () => {
    let fixture = await createVerifyInterruptionFixture()
    let verifier = startFixtureVerifier(fixture)
    let socket: ReturnType<typeof createConnection> | undefined
    try {
      // Establish that this fixture would otherwise complete green and publish
      // measured shard weights; absence after interruption must be meaningful.
      const baseline = await within(verifier.closed, 10_000, 'green fixture verifier')
      assert.equal(baseline.code, 0, verifier.output())
      const weights = JSON.parse(await readFile(join(fixture.root, '.data', 'spec-weights.json'), 'utf8'))
      assert.deepEqual(Object.keys(weights).sort(), ['e2e/first.spec.ts', 'e2e/second.spec.ts'])
      assert.match(verifier.output(), /all 2 lanes green/)
      await removeVerifyInterruptionFixture(fixture, verifier)

      fixture = await createVerifyInterruptionFixture()
      verifier = startFixtureVerifier(fixture, { holdTypecheck: true })
      const ready = JSON.parse(await waitForFixtureFile(join(fixture.state, 'ready.json')))
      await waitForFixtureFile(join(fixture.state, 'npx-finished'))
      const e2eDeadline = Date.now() + 3_000
      while (!/ok\s+e2e/.test(verifier.output())) {
        assert.ok(Date.now() < e2eDeadline, 'the fixture E2E lane must finish before interruption')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.equal(verifier.child.exitCode, null, 'the typecheck lane is still active while E2E has completed')

      socket = createConnection({ host: '127.0.0.1', port: ready.port })
      socket.on('error', () => {})
      await within(new Promise<void>((resolve, reject) => {
        socket!.once('connect', resolve)
        socket!.once('error', reject)
      }), 3_000, 'the lane-owned loopback socket')
      await waitForFixtureFile(join(fixture.state, 'accepted'))

      // Only the verifier receives this signal. Its active npm lane must be
      // interrupted by the verifier, not by the test's process group.
      verifier.child.kill(signal)
      const signalPath = join(fixture.state, `signal-${signal}`)
      const observed = await Promise.race([
        waitForFixtureFile(signalPath, 3_000).then(() => 'lane-signaled', () => 'signal-not-forwarded'),
        verifier.closed.then(() => 'verifier-returned-early'),
      ])
      assert.equal(observed, 'lane-signaled',
        `the verifier must forward ${signal} to its owned lane and wait for cleanup; ${verifier.output()}`)
      assert.equal(verifier.child.exitCode, null,
        'the verifier must remain alive while the lane drains its held connection')
      assert.equal(await readFile(join(fixture.state, 'drained')).catch(() => undefined), undefined,
        'server.close must still be waiting for the test-owned socket')

      socket.destroy()
      socket = undefined
      await waitForFixtureFile(join(fixture.state, 'drained'))
      const result = await within(verifier.closed, 5_000, 'verifier exit after lane drain')
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143,
        'an interrupted verification is never green, even when its child drains with exit 0')
      await waitForFixtureFile(join(fixture.state, 'exited'))

      const steps = await readFile(join(fixture.state, 'steps.log'), 'utf8')
      assert.match(steps, /npm run typecheck/)
      assert.doesNotMatch(steps, /npm run build/)
      assert.equal(await readFile(join(fixture.state, 'node-test-started')).catch(() => undefined), undefined,
        'the checks lane stops before its next step')
      assert.equal(await readFile(join(fixture.state, 'build-started')).catch(() => undefined), undefined,
        'no build step starts after interruption')
      assert.equal(await readFile(join(fixture.root, '.data', 'spec-weights.json')).catch(() => undefined), undefined,
        'an interrupted run never publishes measured success weights')
      assert.doesNotMatch(verifier.output(), /all 2 lanes green/)
    } finally {
      await removeVerifyInterruptionFixture(fixture, verifier, socket)
    }
  })
}

test('verifier publishes no success weights when clean-exit lanes miss required coverage', {
  skip: process.platform === 'win32', timeout: 20_000,
}, async () => {
  const fixture = await createVerifyInterruptionFixture()
  let verifier = startFixtureVerifier(fixture, { reportedPasses: 1 })
  const weightsPath = join(fixture.root, '.data', 'spec-weights.json')
  try {
    assert.equal((await within(verifier.closed, 5_000, 'coverage failure')).code, 1)
    assert.match(verifier.output(), /shards ran 1 of 2 e2e tests/)
    assert.equal(await readFile(weightsPath).catch(() => undefined), undefined)

    // Mutate only the disposable runner. Same clean-exit lane output, but
    // publishing before coverage validation must expose the forbidden cache.
    const source = await readFile(fixture.runner, 'utf8')
    const guard = 'if (!coverage.shortfall) recordWeights(results)'
    assert.ok(source.includes(guard))
    await writeFile(fixture.runner, source.replace(guard, 'recordWeights(results)'))
    verifier = startFixtureVerifier(fixture, { reportedPasses: 1 })
    assert.equal((await within(verifier.closed, 5_000, 'mutated coverage failure')).code, 1)
    assert.equal(Object.keys(JSON.parse(await readFile(weightsPath, 'utf8'))).length, 2,
      'removing the publication guard violates the cache-absence oracle')
  } finally {
    await removeVerifyInterruptionFixture(fixture, verifier)
  }
})
