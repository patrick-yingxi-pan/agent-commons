/** The ONE resize primitive is keyboard-operable (WCAG 2.1.1, invariant UI-11,
 *  docs/ui-invariants.md): every drag-resizable divider — rail width, panel width,
 *  the rail's pane-height gutters — is a focusable `role="separator"` that axis
 *  arrow keys step through the SAME start → move → end pipeline a pointer drag
 *  runs, wearing a distinct accessible name. Because every divider routes through
 *  `ResizeHandle`, locking the funnel + enumerating its call sites covers the
 *  class; `e2e/keyboard-resize.spec.ts` proves the wiring in a real browser. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments, concatSource } from './helpers/source.ts'

const handle = stripComments(read(join(ROOT, 'src', 'components', 'ResizeHandle.tsx')))

test('the handle is a focusable, labeled, VALUED separator', () => {
  assert.match(handle, /role="separator"/)
  assert.match(handle, /tabIndex=\{0\}/, 'the strip is in the tab order')
  assert.match(handle, /aria-label=\{label\}/, 'the accessible name comes from the required label prop')
  assert.match(handle, /aria-orientation=\{horizontal \? 'horizontal' : 'vertical'\}/)
  // The required props keep a call site from shipping a nameless or value-less
  // separator (aria-valuenow is REQUIRED on a focusable separator — WCAG 4.1.2:
  // without it a screen reader hears nothing per step, and "pinned at the clamp"
  // is indistinguishable from motion).
  assert.match(handle, /label: string/)
  assert.match(handle, /value: number\s*\n\s*min: number\s*\n\s*max: number/)
  assert.match(handle, /aria-valuenow=\{Math\.round\(value\)\}/)
  assert.match(handle, /aria-valuemin=\{Math\.round\(min\)\}/)
  assert.match(handle, /aria-valuemax=\{Math\.round\(max\)\}/)
})

test('axis arrow keys run the same gesture pipeline as a pointer drag', () => {
  // The handler must be defined AND wired: deleting the JSX attribute alone would
  // leave every divider keyboard-dead while the definition-only scans stay green
  // (a mutation run proved it — the orphaned const even typechecks).
  assert.match(handle, /onKeyDown=\{onKeyDown\}/, 'the keydown handler is wired to the element')
  const key = handle.slice(handle.indexOf('const onKeyDown'), handle.indexOf('const edge'))
  assert.ok(key.length > 0, 'a dedicated onKeyDown handler exists')
  // Horizontal (pane-height) handles answer Up/Down; vertical (width) handles
  // Left/Right — and unhandled keys fall through untouched.
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
    assert.match(key, new RegExp(`'${k}'`), `${k} is handled`)
  assert.match(key, /if \(dir === 0\) return/, 'other keys fall through')
  assert.match(key, /e\.preventDefault\(\)/, 'a handled arrow must not scroll the pane')
  // One press = one complete gesture, so every call site's clamp + persistence
  // applies to keyboard exactly as to pointer (no parallel resize path).
  assert.match(key, /onStart\?\.\(\)\s*\n\s*onMove\(next\)\s*\n\s*onEnd\?\.\(\)/)
  // Shift steps coarse; after the first press the sequence CHAINS off the last
  // coordinate it sent — never re-reading the rect, which lies to a rapid second
  // press when the container animates its size (the panel's does) — and checks
  // the COMMITTED value for what the last press realized, walking a clamp-cut
  // step's remainder back so there's no banked overshoot to unwind.
  assert.match(key, /e\.shiftKey \? KEY_COARSE : 1/)
  assert.match(key, /const realized = value - last\.value/, 'the committed value reports what landed')
  assert.match(key, /\? last\.next\s*\n\s*: last\.next - slope \* \(last\.req - realized\)/, 'chain exactly, or reconcile the clamp cut')
  assert.match(handle, /onBlur=\{\(\) => \(keyLast\.current = null\)\}/, 'the chain ends with focus')
  // Mid-pointer-drag, a key press must NOT run its own gesture: its onEnd would
  // drop the call site's dragging flag while the pointer listeners are still live,
  // and the rest of the drag would animate behind the cursor.
  assert.match(key, /if \(pointerActive\.current\) return/)
})

test('the panel keeps its dragging flag through the one-tick keyboard gesture', () => {
  // start → move → end batch into ONE commit; dropping dragging in that batch would
  // spring-animate every keyboard step, and the handle (a child of the animated
  // motion.div) would report a lagging rect — the next press then re-snaps to the
  // stale position and key-repeat crawls at spring speed instead of stepping.
  // Deferring the drop one frame keeps keyboard on the pointer path's duration:0.
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'PanelShell.tsx')))
  assert.match(panel, /requestAnimationFrame\(\(\) => setDragging\(false\)\)/)
  assert.match(panel, /cancelAnimationFrame\(dropDragRaf\.current\)/, 'the deferred drop is cleaned up on unmount')
})

test('every call site names its divider, and no two names collide', () => {
  const components = concatSource('src/components')
  // The enumeration: each divider surface passes its own label. TypeScript makes
  // the prop required; this pins the SPECIFIC names so a rename that collides
  // (two separators reading the same) fails loudly.
  const labels = [...components.matchAll(/label="(Resize [^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(labels.sort(), [
    'Resize Scheduled pane',
    'Resize Sections pane',
    'Resize panel',
    'Resize sidebar',
    'Resize split frame',
  ])
  assert.equal(new Set(labels).size, labels.length, 'separator names are pairwise distinct')
  // The pane gutter forwards its label into the shared handle rather than
  // hardcoding one (the funnel stays the single naming door).
  const sidebar = read(join(ROOT, 'src', 'components', 'Sidebar.tsx'))
  assert.match(sidebar, /<ResizeHandle\s+side="bottom"\s+label=\{label\}/)
  // The split frames' pane dividers name themselves per split-node PATH (a
  // template label) — pairwise distinct by construction, so they satisfy the
  // same no-collision rule the static names above pin. Two frames, two
  // distinct template prefixes (right panel vs the main workspace split).
  const splitFrame = read(join(ROOT, 'src', 'components', 'SplitFrame.tsx'))
  assert.match(splitFrame, /label=\{`Resize split panes \(\$\{path \|\| 'root'\}\)`\}/)
  const mainSplit = read(join(ROOT, 'src', 'components', 'MainSplit.tsx'))
  assert.match(mainSplit, /label=\{`Resize view panes \(\$\{path \|\| 'root'\}\)`\}/)
})

test('a gesture persists the value it just produced — the move handler refreshes the ref, and onEnd reads it', () => {
  // A keyboard press runs move → end in ONE tick, before React re-renders, so a
  // persist ref refreshed only at render would store the PREVIOUS size (found live:
  // the pane rendered 356 while storage said 288 — a reload snapped it back). Every
  // resize owner must write its ref where the value is born, not just at render —
  // AND its onEnd must persist THE REF, not the render-stale state closure (an
  // innocuous-looking "read state instead of ref" cleanup reintroduces the bug).
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.match(sidebar, /sectionsHRef\.current = h\s*\n\s*setSectionsH\(h\)/)
  assert.match(sidebar, /scheduledHRef\.current = h\s*\n\s*setScheduledH\(h\)/)
  assert.match(sidebar, /setLayout\('railSectionsH', sectionsHRef\.current\)/)
  assert.match(sidebar, /setLayout\('railScheduledH', scheduledHRef\.current\)/)
  const layoutHook = stripComments(read(join(ROOT, 'src', 'controller', 'useLayout.ts')))
  assert.match(layoutHook, /leftWRef\.current = w\s*\n\s*setLeftW\(w\)/)
  assert.match(layoutHook, /setLayout\('leftW', leftWRef\.current\)/)
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'PanelShell.tsx')))
  assert.match(panel, /widthRef\.current = w\s*\n\s*setWidth\(w\)/)
  assert.match(panel, /setLayout\('rightW', widthRef\.current\)/)
})

test('each divider announces the same range its clamp enforces (no drifting bounds)', () => {
  // The value/min/max wiring per call site: the rail reads useLayout's exported
  // LEFT_MIN/LEFT_MAX, the panel its PANEL_MIN/PANEL_MAX, and each pane gutter the
  // EFFECTIVE height + the same paneMax ceiling dragPane clamps to.
  const sidebar = stripComments(read(join(ROOT, 'src', 'components', 'Sidebar.tsx')))
  assert.match(sidebar, /value=\{railW\}\s*\n\s*min=\{LEFT_MIN\}\s*\n\s*max=\{LEFT_MAX\}/)
  assert.match(sidebar, /value=\{paneOf\('sections'\)!\.height\}\s*\n\s*max=\{paneMax\('sections', paneInputs, avail\)\}/)
  assert.match(sidebar, /value=\{paneOf\('scheduled'\)!\.height\}\s*\n\s*max=\{paneMax\('scheduled', paneInputs, avail\)\}/)
  assert.match(sidebar, /min=\{RAIL_PANE_MIN\}/, 'the gutter floor is the pane min')
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'PanelShell.tsx')))
  assert.match(panel, /value=\{width\}\s*\n\s*min=\{PANEL_MIN\}\s*\n\s*max=\{PANEL_MAX\}/)
})

test('the focus cue rides the app-wide focus-visible ring, not a bespoke outline-off', () => {
  // src/index.css gives every [tabindex]:not([tabindex="-1"]) element the accent
  // focus ring; the strip must not opt out of it.
  assert.doesNotMatch(handle, /outline-none/, 'the handle keeps the shared focus ring')
  const css = read(join(ROOT, 'src', 'index.css'))
  assert.match(css, /\[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible/, 'the ring covers tabindex widgets')
})
