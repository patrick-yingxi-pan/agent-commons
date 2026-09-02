import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DispatchRun } from '../../contract/index.ts'
import { mergeAcknowledgedDispatchRun, mergeDispatchSnapshot } from './dispatchRevision.ts'

const run = (id: string, status: DispatchRun['status'], startedAt: number): DispatchRun => ({
  id,
  title: id,
  detail: `${status} detail`,
  status,
  startedAt,
})

test('a Dispatch acknowledgement inserts one row without rewinding same-id ambient truth', () => {
  const existing = run('d-new-existing', 'done', 10)
  const incoming = run('d-new-manual', 'running', 20)
  const inserted = mergeAcknowledgedDispatchRun([existing], incoming)
  assert.deepEqual(inserted.map((item) => item.id), [incoming.id, existing.id])

  const settled = { ...incoming, status: 'done' as const, detail: 'Completed.' }
  assert.equal(
    mergeAcknowledgedDispatchRun([settled, existing], incoming)[0],
    settled,
    'a delayed running acknowledgement cannot replace terminal feed state',
  )
})

test('a crossed Dispatch read preserves newer completion and rows absent from the older snapshot', () => {
  const settled = run('d-new-shared', 'done', 20)
  const localOnly = run('d-new-local', 'running', 30)
  const older = run('d-new-shared', 'running', 20)
  const serverOnly = run('d-new-server', 'done', 10)
  const merged = mergeDispatchSnapshot([localOnly, settled], [older, serverOnly])

  assert.deepEqual(merged.map((item) => item.id), [localOnly.id, settled.id, serverOnly.id])
  assert.equal(merged[1], settled)
})
