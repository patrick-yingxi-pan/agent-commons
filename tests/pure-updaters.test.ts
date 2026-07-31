/** ── State updaters are pure — a store write happens in the handler, never
 *  inside the updater (or an initializer) ─────────────────────────────────────
 *
 *  React may run a `setState(prev => …)` updater during the RENDER phase (it
 *  runs eagerly in the event only when the fiber has no other pending update;
 *  a busy queue replays it while rendering). A uiPrefs write inside one —
 *  `setLayout` / `setUiPrefScope` / `saveSectionFilter` — synchronously
 *  notifies every live `useSectionFilter` subscriber, which is a setState on
 *  OTHER components mid-render: the React "Cannot update a component
 *  (SectionFilterMenu) while rendering a different component (Sidebar)"
 *  console error (observed 2026-07-31; the message's third arg placed the bad
 *  call inside Sidebar, whose four rail toggles persisted from inside their
 *  updaters). The write belongs beside the setState call, not inside it.
 *
 *  Tree-wide scan (UI-16's lesson): any src/ file that puts a notifying store
 *  writer inside a functional-updater block fails here, naming the offender. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, ROOT, stripComments } from './helpers/source.ts'

// A functional updater whose body reaches a notifying store writer before any
// nested block opens: `setX((v) => { … setLayout(` and friends. The writer
// list is every export that funnels into uiPrefs' notifyLayout.
const IMPURE =
  /set[A-Z]\w*\(\s*\(\s*\w*\s*\)\s*=>\s*\{[^{}]*\b(?:setLayout|setUiPrefScope|saveSectionFilter)\s*\(/g

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
