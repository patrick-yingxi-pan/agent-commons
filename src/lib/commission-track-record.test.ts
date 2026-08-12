/** Surface-audit S8 — a standing Contributor's row should show what it actually did on
 *  THIS project (its local track record), not just the cross-project Award total that
 *  misreads as local. These lock the pure fold: count only `done` items, group by the
 *  resolving commission id, take the most recent `resolvedAt`, and ignore open/retracted
 *  or unattributed items. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvedByCommission } from './commissionTrackRecord.ts'
import type { OpenSubGoal } from '../../contract/index.ts'

const item = (o: Partial<OpenSubGoal>): OpenSubGoal =>
  ({ id: 'x', projectId: 'p', subGoal: 's', type: 'charge', target: 't', note: '', postedBy: 'A', postedAt: 0, status: 'open', ...o }) as OpenSubGoal

test('folds done items by resolving commission, counting + tracking the latest resolvedAt', () => {
  const map = resolvedByCommission([
    item({ status: 'done', resolvedBy: 'c1', resolvedAt: 100 }),
    item({ status: 'done', resolvedBy: 'c1', resolvedAt: 300 }),
    item({ status: 'done', resolvedBy: 'c2', resolvedAt: 200 }),
  ])
  assert.deepEqual(map.get('c1'), { count: 2, lastAt: 300 }, 'count + newest resolvedAt')
  assert.deepEqual(map.get('c2'), { count: 1, lastAt: 200 })
})

test('ignores open / retracted items and items with no resolver', () => {
  const map = resolvedByCommission([
    item({ status: 'open' }),
    item({ status: 'retracted', resolvedBy: 'c1' }), // not done
    item({ status: 'done' }), // done but no resolvedBy (never happens, but be robust)
    item({ status: 'done', resolvedBy: 'c9', resolvedAt: 5 }),
  ])
  assert.equal(map.has('c1'), false, 'a retracted item is not a resolution')
  assert.equal(map.size, 1)
  assert.deepEqual(map.get('c9'), { count: 1, lastAt: 5 })
})

test('an empty backlog yields no track records (row shows "no items taken yet")', () => {
  assert.equal(resolvedByCommission([]).size, 0)
})
