/** Durable scheduler orchestration: cursor adoption, downtime policy, exact
 *  fire identity, and overlap behavior through the narrow scheduler port. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { ScheduledRun, ScheduledTask } from '../contract/index.ts'
import { runSchedulerPass, type SchedulerPort } from './scheduler.ts'

const NOW = Date.parse('2026-06-26T15:05:00.000Z')

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'routine-1',
    name: 'Routine',
    cadence: 'Every hour',
    next: 'legacy label',
    enabled: true,
    lastStatus: 'pending',
    subtitle: 'Test',
    trigger: 'every hour',
    prompt: 'Do the work',
    steps: [],
    delivery: { tool: { id: 'notes', label: 'Notes', tone: 'native' }, target: 'Notes' },
    runs: [],
    model: 'Default',
    timezone: 'UTC',
    ...overrides,
  }
}

function harness(row: ScheduledTask) {
  const calls = { ran: [] as number[], skipped: [] as number[], cursors: [] as number[] }
  const port: SchedulerPort = {
    listSchedules: () => [row],
    runSchedule: (_id, options) => {
      const scheduledFor = options?.scheduledFor
      if (scheduledFor === undefined) return undefined
      calls.ran.push(scheduledFor)
      const run: ScheduledRun = {
        id: `run-${scheduledFor}`,
        status: 'running',
        duration: '—',
        reachedStep: 0,
        summary: 'Running',
        at: options?.startedAt ?? NOW,
        scheduledFor,
      }
      row.runs.unshift(run)
      return run
    },
    recordSkippedScheduleFire: (_id, scheduledFor, at = NOW) => {
      calls.skipped.push(scheduledFor)
      const run: ScheduledRun = {
        id: `skip-${scheduledFor}`,
        status: 'skipped',
        duration: '0s',
        reachedStep: 0,
        summary: 'Skipped',
        at,
        scheduledFor,
      }
      row.runs.unshift(run)
      return run
    },
    setScheduleNextFire: (_id, nextFireAt) => {
      calls.cursors.push(nextFireAt)
      row.nextFireAt = nextFireAt
      return row
    },
    reapStaleRunners: () => {},
  }
  return { port, calls }
}

test('a legacy enabled routine adopts its first future cursor without firing', () => {
  const row = task()
  const { port, calls } = harness(row)
  const result = runSchedulerPass(port, { now: NOW, booting: true })
  assert.deepEqual(calls.ran, [])
  assert.deepEqual(calls.skipped, [])
  assert.equal(row.nextFireAt, Date.parse('2026-06-26T16:00:00.000Z'))
  assert.equal(result.nextWakeAt, row.nextFireAt)
})

test('the default boot policy records one visible skip and advances beyond now', () => {
  const missed = Date.parse('2026-06-26T14:00:00.000Z')
  const row = task({ nextFireAt: missed })
  const { port, calls } = harness(row)
  runSchedulerPass(port, { now: NOW, booting: true })
  assert.deepEqual(calls.skipped, [missed])
  assert.deepEqual(calls.ran, [])
  assert.equal(row.nextFireAt, Date.parse('2026-06-26T16:00:00.000Z'))
})

test('catch-up-once executes one overdue fire and skips backlog replay', () => {
  const missed = Date.parse('2026-06-25T10:00:00.000Z')
  const row = task({ nextFireAt: missed, missedFirePolicy: 'catch-up-once' })
  const { port, calls } = harness(row)
  runSchedulerPass(port, { now: NOW, booting: true })
  assert.deepEqual(calls.ran, [missed])
  assert.equal(row.nextFireAt, Date.parse('2026-06-26T16:00:00.000Z'))
})

test('a live due occurrence fires, but a manual in-flight run cannot consume it', () => {
  const due = Date.parse('2026-06-26T15:00:00.000Z')
  const row = task({ nextFireAt: due })
  const { port, calls } = harness(row)
  port.runSchedule = () => ({
    id: 'manual', status: 'running', duration: '—', reachedStep: 0, summary: 'Manual', at: NOW,
  })
  runSchedulerPass(port, { now: NOW })
  assert.deepEqual(calls.cursors, [], 'the due cursor remains for a retry')

  const fresh = harness(task({ nextFireAt: due }))
  runSchedulerPass(fresh.port, { now: NOW })
  assert.deepEqual(fresh.calls.ran, [due])
  assert.equal(fresh.port.listSchedules()[0].nextFireAt, Date.parse('2026-06-26T16:00:00.000Z'))
})

test('the live driver uses one-shot recursion rather than overlapping intervals', () => {
  const source = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8')
  assert.match(source, /setTimeout\(tick,/)
  assert.doesNotMatch(source, /setInterval\(/)
})

test('a refused occurrence that pauses its routine cannot regain a future cursor', () => {
  const due = Date.parse('2026-06-26T15:00:00.000Z')
  const row = task({ nextFireAt: due })
  const { port, calls } = harness(row)
  port.listSchedules = () => [structuredClone(row)]
  port.runSchedule = () => {
    row.enabled = false
    row.next = 'Paused — review configuration'
    delete row.nextFireAt
    return { id: 'refused', status: 'failed', duration: '0s', reachedStep: 0,
      summary: 'Not started', at: NOW, scheduledFor: due, attempts: 0 }
  }
  assert.deepEqual(runSchedulerPass(port, { now: NOW }), { nextWakeAt: undefined })
  assert.deepEqual(calls.cursors, [])
  assert.equal(row.nextFireAt, undefined)
  assert.equal(row.next, 'Paused — review configuration')
})

test('unexpected admission faults still stop the scheduler rather than masquerading as a refused routine', () => {
  const { port } = harness(task({ nextFireAt: NOW - 1 }))
  const failure = new Error('storage or programming fault')
  port.runSchedule = () => { throw failure }
  assert.throws(() => runSchedulerPass(port, { now: NOW }), error => error === failure)
})
