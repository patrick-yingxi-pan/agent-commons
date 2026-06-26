/** Scheduled-run lifecycle through the real store: a run relights its rail one step
 *  at a time (`run.progress`), finishes (`run.finished`), and — when the routine
 *  carries a standing "save <artifact> each run" approval — applies that graph edit
 *  unprompted (`relation.applied` by:'standing'). Drives the store's event bus
 *  directly, since these are ambient server pushes, not request/response. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'

/** A routine with >= 2 steps, fewest first, so the stepped wait stays short while
 *  still exercising more than one progress emit. */
function steppedTask() {
  const tasks = store.listSchedules()
  const withSteps = tasks.filter((t) => t.steps.length >= 2).sort((a, b) => a.steps.length - b.steps.length)
  return withSteps[0] ?? tasks.reduce((a, b) => (b.steps.length < a.steps.length ? b : a))
}

test('runSchedule steps the rail (run.progress 1..N), then finishes ok', async () => {
  const task = steppedTask()
  const steps = task.steps.length
  const progress = []
  let finished
  const done = new Promise((resolve) => {
    const unsub = store.subscribe((e) => {
      if (e.type === 'run.progress' && e.taskId === task.id) progress.push(e.reachedStep)
      if (e.type === 'run.finished' && e.taskId === task.id) {
        finished = e.run
        unsub()
        resolve()
      }
    })
  })

  const run = store.runSchedule(task.id)
  assert.equal(run?.status, 'running', 'a run mints as running')
  assert.ok(Number.isFinite(run?.at), 'a live run carries a real epoch-ms `at`, not 0/undefined')
  await done

  assert.deepEqual(
    progress,
    Array.from({ length: steps }, (_, i) => i + 1),
    'one progress event per step, monotonically increasing',
  )
  assert.equal(finished?.status, 'ok')
  assert.equal(finished?.reachedStep, steps, 'finishes with the rail fully lit')
})

// Run the routine once and resolve when its run finishes, capturing whether a
// standing relation.applied fired during the run.
function runOnce(taskId) {
  let standingOp
  const done = new Promise((resolve) => {
    const unsub = store.subscribe((e) => {
      if (e.type === 'relation.applied' && e.by === 'standing') standingOp = e.op
      if (e.type === 'run.finished' && e.taskId === taskId) {
        unsub()
        resolve()
      }
    })
  })
  store.runSchedule(taskId)
  return done.then(() => standingOp)
}

test('a standing "save artifact each run" approval saves an artifact unprompted (relation.applied by standing)', async () => {
  const task = steppedTask()
  // Approve once, in advance: this routine saves an artifact every run.
  store.applyRelationOp({
    kind: 'set-schedule-artifact',
    scheduleId: task.id,
    scheduleName: task.name,
    cadence: task.cadence,
    artifactName: 'Standing digest',
  })
  const before = store.relationGraph().extraArtifacts.length

  const op1 = await runOnce(task.id)
  assert.ok(op1, 'a relation.applied by:standing fired on the run')
  assert.equal(op1.kind, 'save-artifact', 'the standing effect is the artifact save')
  assert.equal(
    store.relationGraph().extraArtifacts.length,
    before + 1,
    'the first run mints the routine’s one delivered artifact — no confirmation card',
  )
})

test('a second standing run refreshes the same artifact, not appends one (bounded growth)', async () => {
  const task = steppedTask()
  const before = store.relationGraph().extraArtifacts.length

  const op2 = await runOnce(task.id)
  assert.ok(op2, 'the standing effect still fires on the second run')
  assert.equal(
    store.relationGraph().extraArtifacts.length,
    before,
    'the routine owns ONE live artifact, refreshed in place — the daemon cannot grow the store unbounded',
  )
})

test('a routine with no standing approval applies no standing effect on a run', async () => {
  const graph = store.relationGraph()
  const task = store
    .listSchedules()
    .filter((t) => !graph.scheduleArtifact[t.id])
    .reduce((a, b) => (b.steps.length < a.steps.length ? b : a))

  let sawStanding = false
  const done = new Promise((resolve) => {
    const unsub = store.subscribe((e) => {
      if (e.type === 'relation.applied' && e.by === 'standing') sawStanding = true
      if (e.type === 'run.finished' && e.taskId === task.id) {
        unsub()
        resolve()
      }
    })
  })

  store.runSchedule(task.id)
  await done

  assert.equal(sawStanding, false, 'no standing graph edit without a prior approval')
})
