/** The modal focus-trap seam. Several dialogs declare `aria-modal="true"`, which
 *  obliges them to keep keyboard focus inside the dialog (WCAG 2.4.3) — Tab must
 *  not reach controls behind the backdrop. `useFocusTrap` (src/lib/useFocusTrap)
 *  is the one implementation every such dialog shares; its wrap decision lives in
 *  the pure, DOM-free `nextTrapFocus` so it can be exercised here (node --test has
 *  no DOM). Two contracts are pinned:
 *
 *   1. nextTrapFocus wraps at the ends, no-ops mid-list, and recaptures escaped
 *      focus — the core of the trap.
 *   2. every component that sets `aria-modal="true"` actually wires useFocusTrap —
 *      so a newly-added modal can't reintroduce the un-trapped-focus regression.
 *
 *  The DOM-bound behaviour the trap also provides (focus-in on open, Escape →
 *  close, focus-restore on close, the keydown wiring) has no DOM here and is
 *  verified in the running app, per the repo's testing convention. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTrapFocus } from '../src/lib/focusTrap.ts'
import { ROOT, filesUnder, read, stripComments } from './helpers/source.ts'

// ── 1. The wrap decision (pure) ──────────────────────────────────────────────
test('nextTrapFocus wraps forward from the last focusable to the first', () => {
  const nodes = ['first', 'mid', 'last']
  assert.equal(nextTrapFocus(nodes, 'last', false), 'first')
})

test('nextTrapFocus wraps backward (Shift+Tab) from the first focusable to the last', () => {
  const nodes = ['first', 'mid', 'last']
  assert.equal(nextTrapFocus(nodes, 'first', true), 'last')
})

test('nextTrapFocus no-ops mid-list — the browser advances focus natively', () => {
  const nodes = ['first', 'mid', 'last']
  assert.equal(nextTrapFocus(nodes, 'mid', false), null, 'Tab off a middle element')
  assert.equal(nextTrapFocus(nodes, 'mid', true), null, 'Shift+Tab off a middle element')
  assert.equal(nextTrapFocus(nodes, 'first', false), null, 'Tab off the first element')
  assert.equal(nextTrapFocus(nodes, 'last', true), null, 'Shift+Tab off the last element')
})

test('nextTrapFocus recaptures focus that has escaped the dialog to the nearest end', () => {
  const nodes = ['first', 'mid', 'last']
  assert.equal(nextTrapFocus(nodes, 'outside', false), 'first', 'Tab pulls back to the first')
  assert.equal(nextTrapFocus(nodes, 'outside', true), 'last', 'Shift+Tab pulls back to the last')
  assert.equal(nextTrapFocus(nodes, null, false), 'first', 'no active element → first')
})

test('nextTrapFocus on a single-focusable dialog keeps focus on that element', () => {
  assert.equal(nextTrapFocus(['only'], 'only', false), 'only')
  assert.equal(nextTrapFocus(['only'], 'only', true), 'only')
})

test('nextTrapFocus returns null when there is nothing to trap', () => {
  assert.equal(nextTrapFocus([], 'anything', false), null)
  assert.equal(nextTrapFocus([], null, true), null)
})

// ── 2. Every aria-modal dialog wires the shared trap ─────────────────────────
test('every component that declares aria-modal="true" wires useFocusTrap', () => {
  const modals = filesUnder('src')
    .map((f) => ({ rel: f.replace(ROOT, ''), src: stripComments(read(f)) }))
    .filter((m) => m.src.includes('aria-modal="true"'))

  // The known modals: IntroOverlay, New project / New artifact, the artifact
  // viewer, the search palette, and the Add-context browse window.
  assert.ok(
    modals.length >= 5,
    `expected the aria-modal dialogs; found only ${modals.length}: ${modals.map((m) => m.rel).join(', ')}`,
  )

  const untrapped = modals.filter((m) => !m.src.includes('useFocusTrap')).map((m) => m.rel)
  assert.deepEqual(
    untrapped,
    [],
    `aria-modal dialogs must trap focus via useFocusTrap (WCAG 2.4.3) but don't: ${untrapped.join(', ')}`,
  )
})
