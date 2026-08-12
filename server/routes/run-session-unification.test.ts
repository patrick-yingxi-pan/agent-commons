/** One session mint funnel: a human-created session ("New chat") and an
 *  agent-created one (a scheduled routine's run) are the SAME entity — persisted
 *  rows with one property set, one route surface, and one permission wall,
 *  differing only in the initiator stamp (`scheduledRunOf`). These tests lock the
 *  unification: no read-time synthesis, full configurability (rename / pin /
 *  model pick / follow-up turns) on run sessions, view-scoping (the sessions
 *  list is human conversations; runs surface through the Scheduled feed), and
 *  the identity cascades (run ↔ session, routine → its run sessions). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { runSessionId } from '../../contract/ids.ts'
import { DEFAULT_AGENT } from '../data/workers.ts'
import { call, callRaw } from '../testkit/http.ts'

/** Wait for one routine execution to finish (the store's own event bus). */
function runToCompletion(taskId: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = store.subscribe((e) => {
      if (e.type === 'run.finished' && e.taskId === taskId) {
        unsub()
        resolve()
      }
    })
    store.runSchedule(taskId)
  })
}

test('every seeded run is a persisted session row with the uniform property set', () => {
  const tasks = store.listSchedules()
  assert.ok(tasks.some((t) => t.runs.length > 0), 'the seed carries run history')
  for (const task of tasks) {
    for (const run of task.runs) {
      const s = store.getSession(runSessionId(task.id, run.id))
      assert.ok(s, `run ${run.id} of ${task.id} resolves through the ordinary by-id read`)
      // The uniform stamps a human createSession row also carries.
      assert.deepEqual(s.caps, ['chat'])
      assert.equal(s.agentId, DEFAULT_AGENT.id, 'bound to the default Agent like any new session')
      assert.equal(s.status, 'active')
      assert.equal(s.environment, 'local')
      assert.equal(s.createdAt, run.at, 'stamped with its run’s time, not the boot time')
      // The initiator stamp — the ONE difference from a human-created row.
      assert.deepEqual(s.scheduledRunOf, { taskId: task.id, taskName: task.name })
      // Tenancy mirrors the routine verbatim (an unstamped flagship seed keeps
      // the two-faces visibility rule).
      assert.equal(s.tenantId, task.tenantId)
      // The conversation: the prompt it ran, plus the recap once settled.
      assert.match(s.messages![0].content, /^Scheduled run — /)
      if (run.status !== 'running') {
        assert.ok(
          s.messages!.some((m) => m.role === 'assistant'),
          'a settled run carries its recap turn',
        )
      }
    }
  }
})

test('the sessions list scopes to human conversations; runs surface via the feed (same rows)', async () => {
  const list = (await call('GET', '/sessions')).json as any[]
  assert.ok(list.length > 0)
  assert.ok(
    list.every((s) => !s.scheduledRunOf && !s.id.startsWith('srun-')),
    'no agent-initiated (run) session in the sessions list',
  )
  // The feed serves the same PERSISTED row the by-id read serves — one source.
  const entries = store.recentRuns()
  assert.ok(entries.length > 0)
  for (const e of entries) {
    const row = store.getSession(e.session.id)
    assert.ok(row, 'every feed entry resolves through the ordinary by-id read')
    assert.equal(row!.title, e.session.title)
    assert.deepEqual(row!.scheduledRunOf, e.session.scheduledRunOf)
  }
})

test('runSchedule opens the conversation at start and lands the recap on finish', async () => {
  const task = store.listSchedules().find((t) => t.steps.length >= 1)!
  const run = store.runSchedule(task.id)!
  const sid = runSessionId(task.id, run.id)
  const live = store.getSession(sid)
  assert.ok(live, 'the session row exists the moment the run starts')
  assert.equal(live!.messages!.length, 1, 'the thread opens with the prompt it runs')
  assert.equal(live!.messages![0].role, 'user')

  await new Promise<void>((resolve) => {
    const unsub = store.subscribe((e) => {
      if (e.type === 'run.finished' && e.taskId === task.id) {
        unsub()
        resolve()
      }
    })
  })
  const settled = store.getSession(sid)!
  const recap = settled.messages!.find((m) => m.role === 'assistant')
  assert.ok(recap, 'the recap lands as the assistant turn when the run settles')
  assert.equal(settled.preview, recap!.content.slice(0, 120), 'preview refreshes like any thread')
})

test('a run session is fully configurable through the same routes (rename / pin / model pick / turns)', async () => {
  // A flagship (untenanted) routine — the helper calls as the default tenant,
  // and a foreign tenant's run session must 404 (the same wall as any session).
  const task = store.listSchedules().find((t) => t.runs.length > 0 && !t.tenantId)!
  const sid = runSessionId(task.id, task.runs[0].id)

  const got = await call('GET', `/sessions/${sid}`)
  assert.equal(got.status, 200, 'the ordinary by-id read serves it')

  // Same permission wall as any session: a tenanted routine's run session 404s
  // (not 403 — existence must not leak) for a foreign caller.
  const foreign = store.listSchedules().find((t) => t.runs.length > 0 && t.tenantId && t.tenantId !== 'tenant-acme')
  if (foreign) {
    const fid = runSessionId(foreign.id, foreign.runs[0].id)
    const denied = await call('GET', `/sessions/${fid}`)
    assert.equal(denied.status, 404, 'a foreign tenant’s run session is invisible by id')
  }

  const patched = await call('PATCH', `/sessions/${sid}`, { title: 'Renamed run thread', pinned: true })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.title, 'Renamed run thread')
  assert.equal(patched.json.pinned, true)
  // The feed reflects the rename — it reads the same row, not a synthesis.
  const entry = store.recentRuns().find((e) => e.session.id === sid)
  if (entry) assert.equal(entry.session.title, 'Renamed run thread')

  // A follow-up turn persists, exactly like a human session's.
  const before = (await call('GET', `/sessions/${sid}`)).json.messages.length
  const sent = await callRaw('POST', `/sessions/${sid}/messages`, { text: 'What did this run change?' })
  assert.equal(sent.status, 200)
  const after = (await call('GET', `/sessions/${sid}`)).json.messages
  assert.equal(after.length, before + 2, 'the follow-up user + assistant turn persisted')
})

test('deleting a run session retires its run; deleting a routine retires its run sessions', async () => {
  // Fresh routine with settled run history, through the store's own mutators
  // (untenanted, so the default-tenant helper calls reach it).
  const seedTask = store.listSchedules().find((t) => t.runs.length > 0 && !t.tenantId)!
  const { id: _drop, tenantId: _t, ...seed } = JSON.parse(JSON.stringify(seedTask)) as any
  const task = store.addSchedule(seed)
  assert.ok(task.runs.length > 0)
  const sid = runSessionId(task.id, task.runs[0].id)
  assert.ok(store.getSession(sid), 'addSchedule materializes its runs’ sessions through the funnel')

  const removed = await call('DELETE', `/sessions/${sid}`)
  assert.equal(removed.status, 200)
  const fresh = store.listSchedules().find((t) => t.id === task.id)!
  assert.ok(
    fresh.runs.every((r) => runSessionId(task.id, r.id) !== sid),
    'the run left its routine’s history with its conversation',
  )

  const rest = fresh.runs.map((r) => runSessionId(task.id, r.id))
  store.removeSchedule(task.id)
  for (const id of rest) {
    assert.equal(store.getSession(id), undefined, 'the routine’s run sessions go with it')
  }
})

test('renaming a routine renames its run sessions (no stale mirror)', () => {
  const seedTask = store.listSchedules().find((t) => t.runs.length > 0)!
  const { id: _drop, ...seed } = JSON.parse(JSON.stringify(seedTask)) as any
  const task = store.addSchedule(seed)
  const sid = runSessionId(task.id, task.runs[0].id)
  store.updateSchedule(task.id, { name: 'Renamed routine' })
  const s = store.getSession(sid)!
  assert.equal(s.title, 'Renamed routine')
  assert.equal(s.scheduledRunOf!.taskName, 'Renamed routine')
  store.removeSchedule(task.id)
})

test('deleting a routine mid-run leaves no zombie: the late finish beat mints nothing', async () => {
  const seedTask = store.listSchedules().find((t) => t.runs.length > 0 && !t.tenantId)!
  const { id: _drop, tenantId: _t, ...seed } = JSON.parse(JSON.stringify(seedTask)) as any
  const task = store.addSchedule(seed)
  const run = store.runSchedule(task.id)!
  const sid = runSessionId(task.id, run.id)
  assert.ok(store.getSession(sid), 'the row exists while running')
  store.removeSchedule(task.id)
  assert.equal(store.getSession(sid), undefined, 'the cascade removed it')
  // Wait past the finish beat — the timer closed over the deleted task/run and
  // must NOT settle it back into existence as an orphaned persisted row.
  await new Promise((r) => setTimeout(r, (task.steps.length + 2) * 400))
  assert.equal(store.getSession(sid), undefined, 'no zombie session after the late beat')
})

test('a follow-up reply landing mid-run does not swallow the recap (idempotency keys on the recap id)', async () => {
  const seedTask = store.listSchedules().find((t) => t.runs.length > 0 && !t.tenantId)!
  const { id: _drop, tenantId: _t, ...seed } = JSON.parse(JSON.stringify(seedTask)) as any
  const task = store.addSchedule(seed)
  const finished = new Promise<void>((resolve) => {
    const unsub = store.subscribe((e) => {
      if (e.type === 'run.finished' && e.taskId === task.id) {
        unsub()
        resolve()
      }
    })
  })
  const run = store.runSchedule(task.id)!
  const sid = runSessionId(task.id, run.id)
  // A follow-up assistant turn arrives while the run is still executing.
  store.appendMessage(sid, { id: 'm-a-999', role: 'assistant', content: 'mid-run follow-up' })
  await finished
  const messages = store.getSession(sid)!.messages!
  assert.ok(messages.some((m) => m.id === 'm2'), 'the recap still lands as its own turn')
  assert.ok(messages.some((m) => m.id === 'm-a-999'), 'the follow-up is kept too')
  store.removeSchedule(task.id)
})

test('run history is bounded: past the cap the oldest runs retire with their session rows', () => {
  const seedTask = store.listSchedules().find((t) => t.runs.length > 0 && !t.tenantId)!
  const { id: _drop, tenantId: _t, ...seed } = JSON.parse(JSON.stringify(seedTask)) as any
  const template = seed.runs[0]
  seed.runs = Array.from({ length: 60 }, (_, i) => ({ ...template, id: `bulk-${i}`, at: 100_000 - i }))
  const task = store.addSchedule(seed)
  assert.equal(task.runs.length, 50, 'history capped at 50')
  assert.ok(store.getSession(runSessionId(task.id, 'bulk-0')), 'a retained run keeps its session')
  assert.equal(store.getSession(runSessionId(task.id, 'bulk-59')), undefined, 'a retired run’s session went with it')
  store.removeSchedule(task.id)
})

test('an existing run row re-stamps its routine’s code-owned facts (tenancy, initiator name)', () => {
  const seedTask = store.listSchedules().find((t) => t.runs.length > 0 && !t.tenantId)!
  const { id: _drop, tenantId: _t, ...seed } = JSON.parse(JSON.stringify(seedTask)) as any
  const task = store.addSchedule(seed)
  const sid = runSessionId(task.id, task.runs[0].id)
  assert.equal(store.getSession(sid)!.tenantId, undefined, 'starts unstamped like its routine')
  // Simulate a code-seed evolution (P9): the routine re-tenants between builds.
  const live = store.listSchedules().find((t) => t.id === task.id)!
  live.tenantId = 'tenant-restamp'
  store.recentRuns() // any ensure-path read re-stamps the existing rows
  assert.equal(store.getSession(sid)!.tenantId, 'tenant-restamp', 'the run thread follows its routine’s wall')
  store.removeSchedule(task.id)
})

test('run-now twice converges on distinct rows; the funnel is idempotent per run', async () => {
  const task = store.listSchedules().reduce((a, b) => (b.steps.length < a.steps.length ? b : a))
  await runToCompletion(task.id)
  await runToCompletion(task.id)
  const fresh = store.listSchedules().find((t) => t.id === task.id)!
  const ids = fresh.runs.map((r) => runSessionId(fresh.id, r.id))
  assert.equal(new Set(ids).size, ids.length, 'one deterministic session per run')
  for (const id of ids) assert.ok(store.getSession(id), 'each run resolves to its own persisted row')
})
