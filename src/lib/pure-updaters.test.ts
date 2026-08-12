/** ── The layout store never notifies during React's render phase ─────────────
 *
 *  `notifyLayout` (src/lib/uiPrefs.ts) synchronously calls every live
 *  `useSectionFilter` subscriber — i.e. it is a setState on other components.
 *  Fired while React is rendering, that is the console error
 *
 *    Cannot update a component (SectionFilterMenu) while rendering a different
 *    component (…)
 *
 *  The rule has now been earned through BOTH of its doors, so this file locks
 *  both:
 *
 *  1. From inside a setState UPDATER (observed 2026-07-31, third arg `Sidebar`).
 *     React may run `setState(prev => …)` during render — it runs eagerly in the
 *     event only when the fiber has no other pending update; a busy queue
 *     replays it while rendering. Sidebar's four rail toggles persisted from
 *     inside their updaters. The write belongs beside the setState, not in it.
 *     → the tree-wide source scan below.
 *
 *  2. From a component BODY directly (observed 2026-08-08, third arg `App`).
 *     `setUiPrefScope` notified on every account switch, and App.tsx calls it
 *     in its render body by necessity — the scope must be set before the keyed
 *     <Workspace>'s children run their mount-time reads. The scan in (1) could
 *     never have caught this: there is no updater. The fix was structural — the
 *     scope switch stopped notifying at all — so the lock is behavioural.
 *     → `a scope switch does not notify` + the anti-stale pair below.
 *
 *  The anti-stale tests matter as much as the silence one: the cheap way to
 *  kill the warning would be to drop the notify and let readers keep the
 *  previous account's facets. */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { setLayout, setUiPrefScope, subscribeLayout } from './uiPrefs.ts'
import { ALL_FACET, saveSectionFilter, sectionFilterSnapshot } from './sectionFilter.ts'

// ── (1) the updater door — the tree-wide scan ────────────────────────────────

// A functional updater whose body reaches a notifying store writer before any
// nested block opens: `setX((v) => { … setLayout(` and friends. The writer list
// is every export that funnels into uiPrefs' notifyLayout — `setUiPrefScope` is
// deliberately NOT among them any more (it is pure; the tests below hold it so).
const IMPURE =
  /set[A-Z]\w*\(\s*\(\s*\w*\s*\)\s*=>\s*\{[^{}]*\b(?:setLayout|saveSectionFilter)\s*\(/g

test('no setState updater writes to the layout store (updaters run during render)', () => {
  const offenders: string[] = []
  for (const file of filesUnder('src')) {
    const src = stripComments(read(file))
    const hits = [...src.matchAll(IMPURE)]
    for (const hit of hits) {
      offenders.push(`${file.slice(ROOT.length + 1)}: ${hit[0].split('\n')[0].trim()}…`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a layout-store write inside a setState updater notifies live readers mid-render — persist in the handler, beside the setState call',
  )
})

test('the scan is not vacuous — it recognizes the shape it bans', () => {
  // The exact offender shape this lock was earned by (Sidebar's toggleSched).
  const bug = `const toggleSched = () =>
    setSchedOpen((v) => {
      setLayout('schedOpen', !v)
      return !v
    })`
  assert.ok(new RegExp(IMPURE.source).test(bug), 'the historical offender matches the pattern')
  const fixed = `const toggleSched = () => {
    setLayout('schedOpen', !schedOpen)
    setSchedOpen(!schedOpen)
  }`
  assert.ok(!new RegExp(IMPURE.source).test(fixed), 'the handler-side write does not')
})

// ── (2) the component-body door — the behavioural lock on the scope switch ───

beforeEach(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
  // sectionFilter's memo is module state — it outlives this shim swap, and its
  // store-side invalidator is a NOTIFY, not the storage object. Fire one, or a
  // test could read the previous test's value out of a store that no longer
  // holds it (the scope guard alone won't do it: two tests may share a scope).
  setLayout('__memo_reset__', 0)
})

test('a scope switch does not notify — App.tsx sets it during render', () => {
  let fired = 0
  const off = subscribeLayout(() => {
    fired++
  })
  try {
    setUiPrefScope('user-ada')
    setUiPrefScope('user-grace')
    setUiPrefScope(null) // the auth surface
    assert.equal(
      fired,
      0,
      'setUiPrefScope notified a live reader — from App.tsx’s render body that is a setState mid-render',
    )

    // …but a WRITE still must, or two trees reading one facet would drift.
    setLayout('railW', 300)
    assert.equal(fired, 1, 'a write from a handler still notifies live readers')
  } finally {
    off()
  }
})

test('the section-filter snapshot follows a scope switch it was never told about', () => {
  setUiPrefScope('user-ada')
  saveSectionFilter('artifacts', { facet: 'image', sortBy: 'alpha' })
  assert.deepEqual(sectionFilterSnapshot('artifacts'), { facet: 'image', sortBy: 'alpha' })

  // Grace never chose: she must see the neutral value, NOT Ada's memoized one.
  setUiPrefScope('user-grace')
  assert.deepEqual(
    sectionFilterSnapshot('artifacts'),
    { facet: ALL_FACET, sortBy: 'recency' },
    "the memo outlived the account switch — one account inherited another's facet",
  )

  // …and switching back finds Ada's choice where she left it (the whole point
  // of scoping the blob per account).
  setUiPrefScope('user-ada')
  assert.deepEqual(sectionFilterSnapshot('artifacts'), { facet: 'image', sortBy: 'alpha' })
})

test('the snapshot stays referentially stable within one account (useSyncExternalStore)', () => {
  // Deliberately the SAME scope and section the previous test left memoized, so
  // this also proves beforeEach's reset: a fresh store must read as fresh.
  setUiPrefScope('user-ada')
  const first = sectionFilterSnapshot('artifacts')
  assert.deepEqual(first, { facet: ALL_FACET, sortBy: 'recency' }, 'a memo survived into a store that never held it')
  assert.equal(sectionFilterSnapshot('artifacts'), first, 'a fresh object every read would re-render forever')

  // A write invalidates it — the live-value half of the same memo.
  saveSectionFilter('artifacts', { facet: 'sheet', sortBy: 'alpha' })
  const next = sectionFilterSnapshot('artifacts')
  assert.notEqual(next, first, 'the write must be visible to the next read')
  assert.deepEqual(next, { facet: 'sheet', sortBy: 'alpha' })
})
