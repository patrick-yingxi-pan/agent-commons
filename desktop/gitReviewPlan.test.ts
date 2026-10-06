import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareGitEntries, planGitReview } from './gitReviewPlan.mjs'

const oidA = 'a'.repeat(40)
const oidB = 'b'.repeat(40)
const oidC = 'c'.repeat(64)
const head = (name: string, mode = '100644', oid = oidA) => ({ name, mode, oid })
const staged = (name: string, mode = '100644', oid = oidA, stage = 0) => ({ name, mode, oid, stage })
const side = (mode: string, oid: string) => ({ mode, oid })

test('review plan forms a sorted union with staged additions, deletions and modifications', () => {
  const plan = planGitReview(
    [head('z-deleted.txt'), head('m-modified.txt'), head('a-same.txt')],
    [staged('m-modified.txt', '100644', oidB), staged('y-added.txt', '100755', oidC), staged('a-same.txt')],
  )
  assert.deepEqual(plan, [
    { path: 'a-same.txt', head: side('100644', oidA), index: side('100644', oidA), conflicted: false, sparse: false },
    { path: 'm-modified.txt', head: side('100644', oidA), index: side('100644', oidB), conflicted: false, sparse: false },
    { path: 'y-added.txt', head: null, index: side('100755', oidC), conflicted: false, sparse: false },
    { path: 'z-deleted.txt', head: side('100644', oidA), index: null, conflicted: false, sparse: false },
  ])
})

test('conflict stages are represented as conflicted without inventing stage zero', () => {
  const plan = planGitReview(
    [head('conflicted.txt')],
    [staged('conflicted.txt', '100644', oidA, 1), staged('conflicted.txt', '100755', oidB, 2),
      staged('conflicted.txt', '100644', oidC, 3)],
  )
  assert.deepEqual(plan, [{
    path: 'conflicted.txt', head: side('100644', oidA), index: null, conflicted: true, sparse: false,
  }])
})

test('sparse directory rows and descendants remain visibly sparse rather than staged deletions', () => {
  const plan = planGitReview(
    [head('src/nested/omitted.txt'), head('src-other/ordinary.txt')],
    [staged('src', '040000', oidB), staged('src/nested/new.txt', '100644', oidC)],
  )
  assert.deepEqual(plan, [
    { path: 'src', head: null, index: side('040000', oidB), conflicted: false, sparse: true },
    { path: 'src-other/ordinary.txt', head: side('100644', oidA), index: null, conflicted: false, sparse: false },
    { path: 'src/nested/new.txt', head: null, index: side('100644', oidC), conflicted: false, sparse: true },
    { path: 'src/nested/omitted.txt', head: side('100644', oidA), index: null, conflicted: false, sparse: true },
  ])
})

test('entry comparison distinguishes edits, executable mode changes, type changes and presence', () => {
  assert.equal(compareGitEntries(null, side('100644', oidA)), 'added')
  assert.equal(compareGitEntries(side('100644', oidA), null), 'deleted')
  assert.equal(compareGitEntries(null, null), 'unchanged')
  assert.equal(compareGitEntries(side('100644', oidA), side('100644', oidA)), 'unchanged')
  assert.equal(compareGitEntries(side('100644', oidA), side('100755', oidA)), 'mode-changed')
  assert.equal(compareGitEntries(side('100644', oidA), side('100755', oidB)), 'modified')
  assert.equal(compareGitEntries(side('100644', oidA), side('100644', oidB)), 'modified')
  assert.equal(compareGitEntries(side('100644', oidA), side('120000', oidA)), 'type-changed')
  assert.equal(compareGitEntries(side('160000', oidA), side('040000', oidA)), 'type-changed')
})

test('full-index skip-worktree leaves stay unavailable independently of sparse-directory entries', () => {
  const plan = planGitReview([head('skipped.txt'), head('present.txt')], [
    { ...staged('skipped.txt'), skipWorktree: true }, { ...staged('present.txt'), skipWorktree: false },
  ])
  assert.deepEqual(plan.map(({ path, sparse }) => ({ path, sparse })), [
    { path: 'present.txt', sparse: false }, { path: 'skipped.txt', sparse: true },
  ])
  assert.throws(() => planGitReview([], [{ ...staged('invalid'), skipWorktree: 'true' }]), /review plan/i)
  assert.throws(() => planGitReview([], [{ ...staged('unmerged', '100644', oidA, 2), skipWorktree: true }]), /review plan/i)
})

test('review planning rejects malformed, duplicate, incompatible and over-limit input', () => {
  assert.throws(() => planGitReview(null as any, []), /review plan/i)
  for (const invalid of [
    head('../outside'), head('.git/config'), head('bad\\path'), head('empty-oid', '100644', ''),
    head('bad-mode', '100600'), head('upper-oid', '100644', 'A'.repeat(40)),
    head('zero-oid', '100644', '0'.repeat(40)),
  ]) assert.throws(() => planGitReview([invalid], []), /review plan/i)

  assert.throws(() => planGitReview([head('same'), head('same', '100755', oidB)], []), /review plan/i)
  assert.throws(() => planGitReview([], [staged('same'), staged('same', '100755', oidB)]), /review plan/i)
  assert.throws(() => planGitReview([], [staged('same', '100644', oidA, 0), staged('same', '100644', oidB, 2)]), /review plan/i)
  assert.throws(() => planGitReview([], [staged('sparse', '040000', oidA, 1)]), /review plan/i)
  assert.throws(() => planGitReview([], [staged('bad-stage', '100644', oidA, 4)]), /review plan/i)
  assert.throws(() => planGitReview(Array.from({ length: 501 }, (_, index) => head(`head-${index}`)), []), /review plan/i)
  assert.throws(() => planGitReview([], Array.from({ length: 501 }, (_, index) => staged(`index-${index}`))), /review plan/i)
  assert.throws(() => planGitReview(Array.from({ length: 300 }, (_, index) => head(`path-${index}`)),
    Array.from({ length: 300 }, (_, index) => staged(`other-${index}`))), /review plan/i)
})

test('entry comparison refuses malformed values rather than inventing a classification', () => {
  for (const [before, after] of [
    [undefined, side('100644', oidA)], [side('100600', oidA), side('100644', oidA)],
    [side('100644', 'A'.repeat(40)), side('100644', oidA)], [side('100644', '0'.repeat(40)), null],
  ]) assert.throws(() => compareGitEntries(before as any, after as any), /review plan/i)
})
