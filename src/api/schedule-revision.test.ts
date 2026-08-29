import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ScheduledTask } from '../../contract/index.ts'
import { mergeScheduleDefinition } from './scheduleRevision.ts'

const task = (revision: number, name: string, runId: string): ScheduledTask => ({
  id: 'routine-1',
  revision,
  name,
  cadence: 'Daily',
  next: 'tomorrow',
  nextFireAt: revision * 1_000,
  enabled: true,
  lastStatus: 'ok',
  subtitle: 'A routine',
  trigger: 'Every day',
  prompt: `Prompt ${name}`,
  steps: [],
  delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Thread' },
  runs: [{ id: runId, status: 'ok', duration: '1s', reachedStep: 0, summary: runId, at: revision }],
  model: 'Claude',
  agentId: 'agent-default',
  providerId: 'provider-default',
  modelId: 'claude-opus-4-8',
  effort: 'High',
  missedFirePolicy: revision % 2 === 0 ? 'skip' : 'catch-up-once',
})

test('an older routine acknowledgement cannot rewind a newer definition', () => {
  const current = task(2, 'Newer', 'run-new')
  assert.equal(mergeScheduleDefinition(current, task(1, 'Older', 'run-old')), current)
})

test('an accepted definition acknowledgement preserves independently moving run state', () => {
  const current = task(2, 'Before', 'run-new')
  const merged = mergeScheduleDefinition(current, task(3, 'After', 'run-stale'))
  assert.equal(merged.name, 'After')
  assert.equal(merged.revision, 3)
  assert.equal(merged.nextFireAt, 3_000, 'the server-owned cadence cursor follows the accepted acknowledgement')
  assert.equal(merged.missedFirePolicy, 'catch-up-once', 'the authored downtime policy follows the accepted acknowledgement')
  assert.equal(merged.agentId, 'agent-default')
  assert.equal(merged.providerId, 'provider-default')
  assert.equal(merged.modelId, 'claude-opus-4-8')
  assert.equal(merged.effort, 'High')
  assert.equal(merged.runs, current.runs, 'run history remains the cache projection already on screen')
  assert.equal(merged.lastStatus, current.lastStatus)
})
