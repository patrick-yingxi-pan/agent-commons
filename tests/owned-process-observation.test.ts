/** Cross-runner shutdown must distinguish actual close from unconfirmed exit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './helpers/source.ts'
import { observeChild, stopOwnedChildren } from '../scripts/childProcessLifecycle.mjs'

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 123, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    signals: [] as string[], unreferenced: false,
    kill(signal: string) { this.signals.push(signal); return true },
    unref() { this.unreferenced = true },
  })
}

test('owned observation waits for close rather than leader exit', async () => {
  const child = fakeChild()
  const owned = observeChild(child)
  child.emit('exit', 0, null)
  assert.equal(owned.closed, false, 'exit alone does not close inherited pipes')
  assert.equal(owned.stopped, false)
  child.emit('close', 0, null)
  assert.deepEqual(await owned.outcome, { closed: true, code: 0, signal: null })
  assert.equal(owned.stopped, true)
  owned.signal('SIGKILL')
  assert.deepEqual(child.signals, [], 'a closed direct child is never signaled again')
})

async function assertUnconfirmed(stop: typeof stopOwnedChildren) {
  const child = fakeChild()
  const owned = observeChild(child)
  const result = await stop([owned], { graceMs: 0, killWaitMs: 0 })
  assert.equal(result.complete, false, 'sending KILL is not confirmation of shutdown')
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.deepEqual(await owned.outcome, { closed: false, code: 1, signal: null })
  assert.equal(owned.closed, false, 'bounded abandonment never fabricates a close event')
  assert.equal(child.stdout.destroyed && child.stderr.destroyed && child.stdin.destroyed, true)
  assert.equal(child.unreferenced, true)
}

test('unconfirmed cleanup is bounded and explicitly failed, never a synthetic close', async () => {
  await assertUnconfirmed(stopOwnedChildren)
  // Exercise the failure oracle on an isolated module, never mutate the tree:
  // treating a sent KILL as completion must fail this exact behavioral assertion.
  const source = readFileSync(join(ROOT, 'scripts/childProcessLifecycle.mjs'), 'utf8')
  const subject = 'const complete = await stoppedWithin(owned, killWaitMs, errors)'
  assert.ok(source.includes(subject), 'the cleanup-confirmation mutation has a subject')
  const mutant = await import(`data:text/javascript,${encodeURIComponent(source.replace(subject, 'const complete = true'))}`)
  await assert.rejects(assertUnconfirmed(mutant.stopOwnedChildren), /sending KILL is not confirmation/)
})
