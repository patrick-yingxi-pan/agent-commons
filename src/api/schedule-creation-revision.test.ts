import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ScheduledTask } from '../../contract/index.ts'
import {
  mergeAcknowledgedScheduleCreation,
  mergeScheduleCreationSnapshot,
} from './scheduleCreationRevision.ts'

const task = (id: string, revision = 0): ScheduledTask => ({
  id,
  revision,
  name: id,
  cadence: 'Daily · 9:00 AM',
  next: 'tomorrow',
  enabled: false,
  lastStatus: 'ok',
  subtitle: 'A routine',
  trigger: 'every day at 9:00 AM',
  prompt: `Run ${id}`,
  steps: [],
  delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Thread' },
  runs: [],
  model: 'Claude',
})

test('a routine creation acknowledgement inserts once and preserves a newer same-id face', () => {
  const existing = task('s-existing')
  const created = task('s-new-logical')
  assert.deepEqual(
    mergeAcknowledgedScheduleCreation([existing], created).map((candidate) => candidate.id),
    [created.id, existing.id],
  )

  const newer = { ...created, revision: 2, name: 'Renamed elsewhere' }
  assert.equal(
    mergeAcknowledgedScheduleCreation([newer, existing], created)[0],
    newer,
    'a late create response cannot rewind a definition that ambient sync advanced',
  )
})

test('a crossed creation read drops deleted baseline rows but keeps later local arrivals', () => {
  const deletedBaseline = task('s-baseline-deleted')
  const stable = task('s-stable')
  const newer = { ...stable, revision: 2, name: 'Newer local face' }
  const arrivedLater = task('s-local-later')
  const merged = mergeScheduleCreationSnapshot(
    [deletedBaseline, newer, arrivedLater],
    [stable],
    [deletedBaseline.id, stable.id],
  )

  assert.deepEqual(merged.map((candidate) => candidate.id), [stable.id, arrivedLater.id])
  assert.equal(merged[0], newer)
})
