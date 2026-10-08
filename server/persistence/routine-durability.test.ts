/** Durable routine restart semantics. Boots through the real persistence →
 * rehydrate path in this file's isolated test process. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveState, STORE_VERSION } from './persist.ts'
import { SCHEDULED_TASKS } from '../data/cowork.ts'

const FILE = join(tmpdir(), `agent-commons-routine-durability-${process.pid}.json`)
process.env.DATA_FILE = FILE

after(() => {
  for (const file of [FILE, `${FILE}.tmp`]) {
    try { rmSync(file) } catch { /* already gone */ }
  }
})

test('rehydrate preserves execution-aware work for recovery and sweeps only legacy timer rows', async () => {
  const seed = structuredClone(SCHEDULED_TASKS[0])
  seed.runs = [
    {
      id: 'run-live-aware', status: 'running', duration: '—', reachedStep: 0,
      summary: 'Queued', at: 100, attempts: 1, maxAttempts: 3, nextAttemptAt: 500,
    },
    {
      id: 'run-live-legacy', status: 'running', duration: '—', reachedStep: 0,
      summary: 'Working', at: 90,
    },
  ]
  const waiting = structuredClone(seed)
  waiting.id = 'routine-capacity-waiting'
  waiting.runs = [{
    id: 'run-live-waiting', status: 'running', duration: '—', reachedStep: 0,
    summary: 'Queued', at: 101, attempts: 0, maxAttempts: 3, nextAttemptAt: 101,
  }]
  saveState({
    version: STORE_VERSION,
    sessions: [],
    bindings: [],
    workspaces: [],
    schedules: [seed, waiting],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 0, message: 0, schedule: 0, run: 2, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  })

  const { store } = await import('../store/index.ts')
  store.initPersistence()

  const task = store.listSchedules().find((candidate) => candidate.id === seed.id)!
  const aware = task.runs.find((run) => run.id === 'run-live-aware')!
  assert.deepEqual(
    { status: aware.status, attempts: aware.attempts, maxAttempts: aware.maxAttempts, nextAttemptAt: aware.nextAttemptAt },
    { status: 'running', attempts: 1, maxAttempts: 3, nextAttemptAt: 500 },
    'the worker owns recovery of execution-aware rows',
  )
  assert.deepEqual(store.pendingScheduleRuns(), [
    { taskId: seed.id, runId: aware.id, nextAttemptAt: 500 },
    { taskId: waiting.id, runId: waiting.runs[0].id, nextAttemptAt: 101 },
  ])
  const recoveredWaiting = store.listSchedules().find((candidate) => candidate.id === waiting.id)!.runs[0]
  assert.equal(recoveredWaiting.attempts, 0, 'waiting for worker capacity survives restart without spending an attempt')
  assert.equal(recoveredWaiting.status, 'running', 'queued work remains recoverable, not falsely interrupted')

  const legacy = task.runs.find((run) => run.id === 'run-live-legacy')!
  assert.equal(legacy.status, 'failed')
  assert.match(legacy.summary, /Interrupted by a server restart/)
})
