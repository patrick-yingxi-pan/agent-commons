/** Locking tests: pane-local resolution of the section nav bridge
 *  (src/lib/paneNav.ts — ADAPT-17's pane-locality rule). Every entity door in a
 *  section page routes through ONE bridge (`useRelations().navigate`); hosted
 *  in a split pane, the SectionNavOverride resolves it against the PANE via
 *  this pure mapper. These lock:
 *    1. the id→detail mapping MIRRORS the root bridge (App.navigateToSection)
 *       shape for shape — the two must never diverge,
 *    2. a same-section target lands as pane FOCUS (in-place, back stack),
 *    3. a cross-section target RETARGETS the pane (never the primary),
 *    4. a bare section jump (no entity) stays IN THE PANE too — the section
 *       root (ADAPT-18: total in-pane routing, so every in-page door can
 *       carry the pane's back history; the equal-pages model has no primary
 *       to fall through to),
 *    5. the msection `seed` a retarget mints survives the JSON persistence
 *       round-trip. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paneNavTarget, seedFor } from '../src/lib/paneNav.ts'
import { panes, splitPane, pane } from '../src/lib/splitFrame.ts'
import type { MainPaneContent, MainSplitNode } from '../src/lib/mainSplit.ts'

test('seedFor mirrors the root bridge mapping (App.navigateToSection), shape for shape', () => {
  assert.deepEqual(seedFor('projects', 'p1'), { projectId: 'p1' })
  assert.deepEqual(seedFor('projects', 'p1', 'w1'), { projectId: 'p1', workItemId: 'w1' }, 'projects+subId = a work item page')
  assert.deepEqual(seedFor('scheduled', 't1'), { scheduleId: 't1' })
  assert.deepEqual(seedFor('contexts', 'c1'), { contextId: 'c1' })
  assert.deepEqual(seedFor('agents', 'nova'), { ownerName: 'nova' }, 'agents+id = an OWNER profile (agent pages route via the prop)')
  assert.deepEqual(seedFor('admin', 'user-grace'), { adminUserId: 'user-grace' }, "admin+id = an account's console detail (FWD-7 v1.1)")
  assert.equal(seedFor('projects'), null, 'no id = no entity detail')
  assert.equal(seedFor('artifacts', 'a1'), null, 'a section with no detail mapping stays unmapped')
})

test('a same-section entity door lands as pane FOCUS (the reported Contexts bug)', () => {
  const t = paneNavTarget('contexts', 'contexts', 'ctx-github')
  assert.deepEqual(t, { kind: 'focus', focus: { contextId: 'ctx-github' } })
  // An account row inside the maintainer console stays in the pane (back works).
  assert.deepEqual(paneNavTarget('admin', 'admin', 'user-grace'), {
    kind: 'focus',
    focus: { adminUserId: 'user-grace' },
  })
  // A work item inside the pane's own Projects section stays in the pane too.
  assert.deepEqual(paneNavTarget('projects', 'projects', 'p1', 'w1'), {
    kind: 'focus',
    focus: { projectId: 'p1', workItemId: 'w1' },
  })
})

test('a cross-section entity door RETARGETS the pane, seeded with the detail', () => {
  // An owner byline inside a Projects pane: the pane goes to the profile.
  assert.deepEqual(paneNavTarget('projects', 'agents', 'nova'), {
    kind: 'retarget',
    section: 'agents',
    seed: { ownerName: 'nova' },
  })
  // A linked-context chip inside a Projects pane.
  assert.deepEqual(paneNavTarget('projects', 'contexts', 'ctx-1'), {
    kind: 'retarget',
    section: 'contexts',
    seed: { contextId: 'ctx-1' },
  })
})

test('a bare section jump stays in the pane — the section root, never a fall-through', () => {
  // Cross-section: retarget to the target's root (empty seed) — the host
  // pushes the outgoing page onto the carried back stack (ADAPT-18).
  assert.deepEqual(paneNavTarget('projects', 'artifacts'), { kind: 'retarget', section: 'artifacts', seed: {} })
  assert.deepEqual(
    paneNavTarget('projects', 'artifacts', 'a1'),
    { kind: 'retarget', section: 'artifacts', seed: {} },
    'an unmapped detail lands at the root too',
  )
  // Same-section: the empty focus — back to the pane's own root, through the
  // local stack (back returns to the detail you left).
  assert.deepEqual(paneNavTarget('projects', 'projects'), { kind: 'focus', focus: {} })
})

test('an msection seed survives the JSON persistence round-trip', () => {
  const seeded: MainPaneContent = { kind: 'msection', id: 'agents', seed: { ownerName: 'nova' } }
  const tree = splitPane(pane<MainPaneContent>({ kind: 'msession', id: 'auth-refactor' }), '', 'row', seeded)
  const revived = JSON.parse(JSON.stringify(tree)) as MainSplitNode
  const leaf = panes(revived).find((p) => p.content.kind === 'msection')
  assert.deepEqual(leaf && leaf.content.kind === 'msection' ? leaf.content.seed : null, { ownerName: 'nova' })
})
