import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ScheduledTask } from '../../contract/index.ts'
import {
  mergeAcknowledgedScheduleRun,
  mergeScheduleRuntimeSnapshot,
} from './scheduleRunRevision.ts'

const task = (revision: number, runId: string): ScheduledTask => ({
  id: 'routine-1',
  revision,
  name: 'Current definition',
  cadence: 'Daily',
  next: 'tomorrow',
  enabled: true,
  lastStatus: 'ok',
  subtitle: 'A routine',
  trigger: 'Every day',
  prompt: 'Prompt',
  steps: [],
  delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Thread' },
  runs: [{ id: runId, status: 'ok', duration: '1s', reachedStep: 0, summary: runId, at: revision }],
  model: 'Claude',
})

test('a Run-now acknowledgement inserts one run without replacing routine definition state', () => {
  const current = task(3, 'run-existing')
  const incoming = {
    id: 'run-manual-new',
    status: 'running' as const,
    duration: '—',
    reachedStep: 0,
    summary: 'Queued on demand…',
    at: 100,
  }
  const merged = mergeAcknowledgedScheduleRun(current, incoming)
  assert.equal(merged.name, current.name)
  assert.equal(merged.revision, current.revision)
  assert.deepEqual(merged.runs.map((run) => run.id), ['run-manual-new', 'run-existing'])
  assert.equal(mergeAcknowledgedScheduleRun(merged, incoming), merged, 'an acknowledgement replay is referentially stable')
})

test('a stale queued acknowledgement cannot rewind a run already settled by ambient state', () => {
  const current = task(3, 'run-manual-new')
  current.runs[0] = { ...current.runs[0]!, status: 'ok', reachedStep: 3, summary: 'Delivered.' }
  const queued = { ...current.runs[0]!, status: 'running' as const, reachedStep: 0, summary: 'Queued on demand…' }
  const merged = mergeAcknowledgedScheduleRun(current, queued)
  assert.equal(merged, current)
  assert.equal(merged.runs[0]!.status, 'ok')
  assert.equal(merged.runs[0]!.summary, 'Delivered.')
})

test('runtime reconciliation accepts new runs while preserving newer same-run progress', () => {
  const current = task(4, 'run-shared')
  current.runs[0] = { ...current.runs[0]!, status: 'running', attempts: 2, reachedStep: 2, summary: 'Running attempt 2 of 3…' }
  const incoming = task(4, 'run-new')
  incoming.runs.push({ ...current.runs[0]!, attempts: 0, reachedStep: 0, summary: 'Queued on demand…' })
  const merged = mergeScheduleRuntimeSnapshot(current, incoming)
  assert.deepEqual(merged.runs.map((run) => run.id), ['run-new', 'run-shared'])
  assert.equal(merged.runs[1]!.attempts, 2)
  assert.equal(merged.runs[1]!.summary, 'Running attempt 2 of 3…')
})

test('runtime reconciliation cannot rewind terminal health with an older same-run read', () => {
  const current = task(5, 'run-shared')
  const incoming = task(5, 'run-shared')
  incoming.lastStatus = 'failed'
  incoming.runs[0] = { ...incoming.runs[0]!, status: 'running', duration: '—', summary: 'Queued on demand…' }
  const merged = mergeScheduleRuntimeSnapshot(current, incoming)
  assert.equal(merged.runs[0]!.status, 'ok')
  assert.equal(merged.lastStatus, 'ok')
})
