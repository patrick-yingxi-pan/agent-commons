/** Dispatch is the one-off counterpart to Scheduled: POST /dispatch kicks off a
 *  single on-demand agent run that lands in the feed 'running' and finishes 'done'
 *  a beat later (broadcasting dispatch.changed so the feed updates live). These
 *  lock the create route + the running→done simulation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { manualDispatchRunId } from '../dispatchIdentity.ts'

test('POST /dispatch kicks off a one-off run — lands running, newest-first in the feed', async () => {
  const before = await call('GET', '/dispatch')
  assert.equal(before.status, 200)
  const beforeCount = before.json.length

  const res = await call('POST', '/dispatch', { title: 'Triage tickets', detail: 'cluster + reply' })
  assert.equal(res.status, 200)
  assert.equal(res.json.status, 'running', 'a dispatch lands running')
  assert.equal(res.json.title, 'Triage tickets')
  assert.ok(res.json.id.startsWith('d-new-'), 'server-minted id')
  // The "time ago" stamp is a real timestamp, not a frozen string — server/ isn't
  // typechecked, so this guards the field whose construction once regressed.
  assert.ok(Number.isFinite(res.json.startedAt), 'startedAt is a real epoch-ms timestamp')

  const after = await call('GET', '/dispatch')
  assert.equal(after.json.length, beforeCount + 1, 'prepended to the feed')
  assert.equal(after.json[0].id, res.json.id, 'newest first')
})

test('POST /dispatch 400s without a title', async () => {
  const res = await call('POST', '/dispatch', { detail: 'no title' })
  assert.equal(res.status, 400)
})

test('a keyed Dispatch owns one tenant-scoped durable row beyond response-cache lifetime', async () => {
  const me = (await call('GET', '/me')).json
  const key = `durable-dispatch-${Date.now().toString(36)}`
  const created = await call(
    'POST',
    '/dispatch',
    { title: 'Durable one-off task', detail: 'Keep one logical run.' },
    { 'idempotency-key': key },
  )
  const expectedId = manualDispatchRunId(me.tenant.id, key)
  assert.equal(created.status, 200)
  assert.equal(created.json.id, expectedId)

  const replay = store.addDispatch(
    'A changed retry body cannot create another row',
    undefined,
    me.tenant.id,
    expectedId,
  )
  assert.equal(replay.id, expectedId)
  assert.equal(
    store.listDispatch(me.tenant.id).filter((run) => run.id === expectedId).length,
    1,
    'persisted identity, rather than only the HTTP response cache, deduplicates retry',
  )
})

test('addDispatch finishes the run done a beat later and broadcasts dispatch.changed each time', async () => {
  let changes = 0
  let finished = false
  const done = new Promise<void>((resolve) => {
    const off = store.subscribe((e) => {
      if (e.type !== 'dispatch.changed') return
      changes += 1
      if (store.listDispatch()[0]?.status === 'done') {
        finished = true
        off()
        resolve()
      }
    })
  })
  const run = store.addDispatch('Simulated task')
  assert.equal(run.status, 'running', 'starts running')
  await done
  assert.equal(finished, true, 'the run reaches done')
  assert.ok(changes >= 2, 'broadcasts on create and on finish')
})
