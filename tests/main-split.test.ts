/** Locking tests: the MAIN workspace split's vocabulary + tree rules
 *  (universal split, docs/design/universal-split-workspace.md §2.1 + the
 *  Phase 6 equal-pages model) — the generic split math instantiated with the
 *  main-pane content: EQUAL pages, ONE close rule (last close → null, the
 *  background), the focus-driven context pane anchored beside its OWNING
 *  conversation, and the legacy-primary blob migration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPane, nodeAt, panes, prunePanes, replacePane, splitPane, pane, updatePaneContent, type PaneContent } from '../src/lib/splitFrame.ts'
import {
  closeMainPane,
  contextPaneContent,
  contextPaneId,
  findFocusDrivenContext,
  hostsSession,
  mainPaneKeep,
  migrateMainSplit,
  paneContentAlive,
  retargetDraftPanes,
  setFocusDrivenContextTree,
  unpinnedContent,
  withoutFocusDrivenContext,
  type MainPaneContent,
  type MainSplitNode,
} from '../src/lib/mainSplit.ts'
import type { Live } from '../src/data/liveSession.ts'

const projects: MainPaneContent = { kind: 'msection', id: 'projects' }
const artifacts: MainPaneContent = { kind: 'msection', id: 'artifacts' }
const auth: MainPaneContent = { kind: 'msession', id: 'auth-refactor' }

/** A minimal live for the aliveness/prune checks — only the arrays the predicate
 *  reads. */
const liveWith = (o: Partial<Live>): Live =>
  ({ workspaces: [], repos: [], connectors: [], attachments: [], ...o }) as Live

test('the generic tree instantiates with the main vocabulary — every pane an EQUAL page (Phase 6)', () => {
  const tree = splitPane(splitPane(pane(auth), '', 'row', projects), 'b', 'col', artifacts)
  assert.deepEqual(
    panes(tree).map((p) => p.content.kind),
    ['msession', 'msection', 'msection'],
  )
})

test('prunePanes keeps exactly what the predicate keeps — no kind is special-cased (UI-15: no chooser panes exist)', () => {
  const tree = splitPane(splitPane(pane(auth), '', 'row', artifacts), 'a', 'col', projects)
  const pruned = prunePanes(tree, (c) => c.kind !== 'msection')
  assert.deepEqual(
    panes(pruned).map((p) => p.content.kind),
    ['msession'],
    'both section panes pruned away; only the conversation stayed',
  )
})

test('ONE close rule: a sibling inherits the slot; the LAST close leaves the background (null)', () => {
  const tree = splitPane(pane(auth), '', 'row', projects) as MainSplitNode
  const one = closeMainPane(tree, 'b')
  assert.ok(one && one.kind === 'pane', 'closing a sibling leaves the survivor as a one-pane tree')
  assert.equal(one!.kind === 'pane' && one!.content.kind, 'msession')
  // Closing the last pane → null: the empty BACKGROUND, a legal state (the
  // owner's equal-pages model) — not an implicit un-split surface.
  assert.equal(closeMainPane(one!, ''), null)
  const three = splitPane(splitPane(pane(auth), '', 'row', projects), 'b', 'col', artifacts)
  const two = closeMainPane(three, 'bb')
  assert.ok(two && two.kind === 'split', 'two panes remain a tree')
  assert.deepEqual(panes(two).map((p) => p.content.kind), ['msession', 'msection'])
})

test('an msection pane carries its facet (`sub`) through the JSON round-trip — the rail-routes-a-facet case', () => {
  const faceted: MainPaneContent = { kind: 'msection', id: 'projects', sub: 'mine' }
  const tree = splitPane(pane(auth), '', 'row', faceted)
  const revived = JSON.parse(JSON.stringify(tree)) as MainSplitNode
  const leaf = panes(revived).find((p) => p.content.kind === 'msection')
  assert.equal(leaf && leaf.content.kind === 'msection' ? leaf.content.sub : undefined, 'mine')
})

test('migrateMainSplit strips every retired leaf kind — primary, mpicker, and runs-switcher context panes', () => {
  const legacyPrimary = { kind: 'primary', id: 'primary' } as unknown as MainPaneContent
  // A pre-Phase-6 blob: [primary | projects].
  const legacy = splitPane(pane(legacyPrimary), '', 'row', projects)
  const migrated = migrateMainSplit(legacy)
  assert.ok(migrated && migrated.kind === 'pane', 'the sibling inherits the whole slot')
  assert.equal(migrated!.kind === 'pane' && migrated!.content.kind, 'msection')
  // A blob that was ONLY the primary migrates to null — the boot flow re-opens
  // the remembered page as a concrete pane.
  assert.equal(migrateMainSplit(pane(legacyPrimary)), null)
  // A pre-UI-15 blob may hold CHOOSER panes — the mpicker picker and the
  // runs-switcher context pane (now the title bar's floating click-down).
  // Both strip; their content siblings survive.
  const mpicker = { kind: 'mpicker', id: 'mpk-1' } as unknown as MainPaneContent
  const runsPane = {
    kind: 'context-panel',
    id: 'srun-1 runs t1',
    sessionId: 'srun-1',
    panel: { kind: 'runs', id: 't1' },
  } as unknown as MainPaneContent
  const choosers = splitPane(splitPane(pane(auth), '', 'row', mpicker), 'b', 'col', runsPane)
  const clean = migrateMainSplit(choosers)
  assert.deepEqual(
    panes(clean).map((p) => p.content.kind),
    ['msession'],
    'both chooser leaves stripped; the conversation inherits',
  )
  // A REAL context pane is untouched — only the runs switcher is retired.
  const modernCtx = splitPane(pane(auth), '', 'row', contextPaneContent('auth-refactor', { kind: 'repo', id: 'repo-demo' }))
  assert.equal(migrateMainSplit(modernCtx), modernCtx)
  // A modern tree passes through untouched (same reference).
  const modern = splitPane(pane(auth), '', 'row', projects)
  assert.equal(migrateMainSplit(modern), modern)
})

test('a pane REPORTS its live location rev-stably: `at` lands in the content, `rev` untouched (no self-remount)', () => {
  const tree = splitPane(pane(auth), '', 'row', projects)
  // A ROUTE bumps rev (land fresh)…
  const routed = replacePane(tree, 'b', { kind: 'msection', id: 'projects', sub: 'mine' })
  const revAfterRoute = (nodeAt(routed, 'b') as { rev?: number }).rev
  assert.equal(revAfterRoute, 1, 'a route bumps the leaf revision')
  // …while the pane's own report of its live location must NOT (updatePaneContent).
  const reported = updatePaneContent(routed, 'b', {
    kind: 'msection',
    id: 'projects',
    sub: 'mine',
    at: { sub: 'mine', projectId: 'p-1' },
  })
  const leaf = nodeAt(reported, 'b') as { rev?: number; content: MainPaneContent }
  assert.equal(leaf.content.kind === 'msection' && leaf.content.at?.projectId, 'p-1', 'the live location landed')
  assert.equal(leaf.rev, revAfterRoute, 'rev untouched by the report — the pane never remounts from describing itself')
  // `at` round-trips persistence — a reload restores the pane's deep spot.
  const revived = JSON.parse(JSON.stringify(reported)) as MainSplitNode
  const rleaf = panes(revived).find((p) => p.path === 'b')!
  assert.deepEqual(rleaf.content.kind === 'msection' ? rleaf.content.at : null, { sub: 'mine', projectId: 'p-1' })
})

test('retargetDraftPanes follows the materialized draft by CONTENT match — duplicates too; no-op returns the same tree', () => {
  const draftPane: MainPaneContent = { kind: 'msession', id: 'draft' }
  // [auth | [draft | draft]] — a duplicated draft pane must follow too.
  const tree = splitPane(splitPane(pane(auth), '', 'row', draftPane), 'b', 'col', draftPane)
  const next = retargetDraftPanes(tree, 'draft', 'sess-9')!
  assert.deepEqual(
    panes(next).map((p) => (p.content.kind === 'msession' ? p.content.id : p.content.kind)),
    ['auth-refactor', 'sess-9', 'sess-9'],
    'every draft conversation pane retargeted to the real id',
  )
  // Nothing showing the draft → the SAME reference back (no needless commit/persist).
  assert.equal(retargetDraftPanes(next, 'draft', 'sess-9'), next)
  assert.equal(retargetDraftPanes(null, 'draft', 'sess-9'), null)
  // The adoption SPREADS the content — a carried back stack (ADAPT-18)
  // survives it (a rebuild once dropped every extra field).
  const carried = retargetDraftPanes(
    pane<MainPaneContent>({ kind: 'msession', id: 'draft', back: [{ kind: 'msection', id: 'projects' }] }),
    'draft',
    'sess-9',
  )!
  const adopted = panes(carried)[0].content
  assert.deepEqual(
    adopted.kind === 'msession' ? adopted.back : null,
    [{ kind: 'msection', id: 'projects' }],
    'the back history rides through the draft adoption',
  )
})

// ── Context panels as FULL panes (universal split Phase 4) ───────────────────

const repoPanel: PaneContent = { kind: 'repo', id: 'repo-demo' }
const wsPanel: PaneContent = { kind: 'workspace', id: 'ws-demo' }

test('a context-panel pane tiles in the SAME tree as conversations and sections', () => {
  const tree = splitPane(pane(auth), '', 'row', contextPaneContent('auth-refactor', repoPanel))
  assert.deepEqual(
    panes(tree).map((p) => p.content.kind),
    ['msession', 'context-panel'],
    'one generic tree hosts every view kind — no separate right frame',
  )
})

test('context-pane identity dedups on (session, panel): a chip re-click focuses, never duplicates', () => {
  const a = contextPaneContent('auth-refactor', repoPanel)
  const b = contextPaneContent('auth-refactor', repoPanel)
  assert.equal(a.id, b.id, 'same session + same panel → same id')
  // findPane matches on (kind, id), so an existing pane is found and re-focused.
  const tree = splitPane(pane(auth), '', 'row', a)
  assert.equal(findPane(tree, b), 'b', 'the second click finds the first pane')
  // A different session or a different panel is a distinct pane.
  assert.notEqual(a.id, contextPaneContent('dashboard-perf', repoPanel).id)
  assert.notEqual(a.id, contextPaneContent('auth-refactor', wsPanel).id)
})

test('paneContentAlive: a detached repo dies; files survive on the KIND', () => {
  const withRepo = paneContentAlive(liveWith({ repos: [{ id: 'repo-demo' } as Live['repos'][number]] }))
  assert.equal(withRepo(repoPanel), true)
  assert.equal(withRepo({ kind: 'repo', id: 'gone' }), false, 'a detached repo collapses its pane')

  const withFile = paneContentAlive(
    liveWith({ attachments: [{ kind: 'file', id: 'f2' } as Live['attachments'][number]] }),
  )
  // The pane's id was the initially-clicked file; it survives on ANY file remaining.
  assert.equal(withFile({ kind: 'file', id: 'f1-clicked' }), true)
  assert.equal(withFile({ kind: 'photo', id: 'p1' }), false)
})

test('mainPaneKeep + prunePanes: a context pane collapses when its panel or session vanishes; siblings stay', () => {
  // auth | context(auth-refactor,repo) | context(dead-session,ws) | projects
  const tree = splitPane(
    splitPane(
      splitPane(pane(auth), '', 'row', contextPaneContent('auth-refactor', repoPanel)),
      'b',
      'row',
      contextPaneContent('dead-session', wsPanel),
    ),
    'bb',
    'row',
    projects,
  )
  const liveFor = (id: string): Live | undefined =>
    id === 'auth-refactor' ? liveWith({ repos: [{ id: 'repo-demo' } as Live['repos'][number]] }) : undefined
  const pruned = prunePanes(tree, mainPaneKeep(liveFor))
  assert.deepEqual(
    panes(pruned).map((p) => p.content.kind),
    ['msession', 'context-panel', 'msection'],
    'the conversation + live repo pane + section stayed; the gone-session context pane pruned away',
  )
  // The surviving context pane is the auth-refactor one (its repo is live).
  const cp = panes(pruned).find((p) => p.content.kind === 'context-panel')
  assert.equal(cp?.content.kind === 'context-panel' ? cp.content.sessionId : '', 'auth-refactor')
})

test('a context-panel pane round-trips JSON (sessionId + panel survive persistence)', () => {
  const tree = splitPane(pane(auth), '', 'row', contextPaneContent('auth-refactor', repoPanel))
  const revived = JSON.parse(JSON.stringify(tree)) as MainSplitNode
  const leaf = panes(revived).find((p) => p.content.kind === 'context-panel')
  assert.ok(leaf && leaf.content.kind === 'context-panel')
  assert.equal(leaf!.content.kind === 'context-panel' && leaf!.content.sessionId, 'auth-refactor')
  assert.deepEqual(leaf!.content.kind === 'context-panel' ? leaf!.content.panel : null, repoPanel)
  assert.equal(leaf!.content.id, contextPaneId('auth-refactor', repoPanel))
})

// ── The focused conversation's context panel folds into the tree (P4 → P6) ───

const panelOf = (c: MainPaneContent) => (c.kind === 'context-panel' ? c : null)

test('setFocusDrivenContextTree anchors the panel beside its OWNING conversation pane, marked focusDriven', () => {
  const base = pane(auth)
  const tree = setFocusDrivenContextTree(base, 'auth-refactor', repoPanel)
  assert.deepEqual(
    panes(tree).map((p) => p.content.kind),
    ['msession', 'context-panel'],
  )
  const ctx = panes(tree).find((p) => p.content.kind === 'context-panel')!
  assert.equal(panelOf(ctx.content)?.focusDriven, true, 'the focus-driven pane is marked focusDriven')
  assert.deepEqual(findFocusDrivenContext(tree)?.content.panel, repoPanel)
  // No pane shows the session (or only the background) → NO projection: an
  // absent subject is not an instruction.
  assert.equal(setFocusDrivenContextTree(base, 'other-session', repoPanel), base)
  assert.equal(setFocusDrivenContextTree(null, 'auth-refactor', repoPanel), null)
})

test('setFocusDrivenContextTree is a no-op when the panel is already open to the same (session, panel)', () => {
  const tree = setFocusDrivenContextTree(pane(auth), 'auth-refactor', repoPanel)
  assert.equal(setFocusDrivenContextTree(tree, 'auth-refactor', repoPanel), tree, 'same state → same reference (no churn/persist)')
})

test('setFocusDrivenContextTree swaps the panel in place on a session/panel change', () => {
  const dash: MainPaneContent = { kind: 'msession', id: 'dashboard-perf' }
  const base = splitPane(pane(auth), '', 'row', dash)
  const tree = setFocusDrivenContextTree(base, 'auth-refactor', repoPanel)
  const before = panes(tree).length
  const swapped = setFocusDrivenContextTree(tree, 'dashboard-perf', wsPanel)!
  assert.equal(panes(swapped).length, before, 'replaced in place — not added')
  const ctx = findFocusDrivenContext(swapped)!
  assert.equal(ctx.content.sessionId, 'dashboard-perf')
  assert.deepEqual(ctx.content.panel, wsPanel)
})

test('setFocusDrivenContextTree(null panel) closes the panel; the lone conversation remains (one-pane tree)', () => {
  const tree = setFocusDrivenContextTree(pane(auth), 'auth-refactor', repoPanel)
  const closed = setFocusDrivenContextTree(tree, 'auth-refactor', null)
  assert.ok(closed && closed.kind === 'pane', 'the conversation pane survives alone')
  assert.equal(closed!.kind === 'pane' && closed!.content.kind, 'msession')
})

test('splitting the owning pane never ORPHANS its context pane (found by flag, not position)', () => {
  // Open the panel, then the user duplicates the conversation (a section joins).
  const opened = setFocusDrivenContextTree(pane(auth), 'auth-refactor', repoPanel)!
  const ownPath = panes(opened).find((p) => p.content.kind === 'msession')!.path
  const withDup = splitPane(opened, ownPath, 'row', projects)
  // The context pane is no longer its owner's positional neighbor…
  const found = findFocusDrivenContext(withDup)
  assert.ok(found, 'still found by its focusDriven flag')
  assert.deepEqual(found!.content.panel, repoPanel)
  // …and reconciling the SAME focus adds no duplicate.
  const again = setFocusDrivenContextTree(withDup, 'auth-refactor', repoPanel)
  assert.equal(again, withDup, 'no duplicate context pane minted after the split')
  assert.equal(
    panes(withDup).filter((p) => p.content.kind === 'context-panel').length,
    1,
  )
})

test('withoutFocusDrivenContext strips the TRANSIENT focus pane from storage but keeps PINNED context panes', () => {
  // [auth | context(focusDriven)] then a pinned context pane beside the conversation.
  const t1 = setFocusDrivenContextTree(pane({ kind: 'msession', id: 'S1' }), 'S1', repoPanel)!
  const ownPath = panes(t1).find((p) => p.content.kind === 'msession')!.path
  const pinned = unpinnedContent(contextPaneContent('S1', wsPanel, { focusDriven: true }))
  const t2 = splitPane(t1, ownPath, 'row', pinned)
  const persisted = withoutFocusDrivenContext(t2)
  const kinds = panes(persisted).map((p) => p.content.kind)
  assert.ok(kinds.includes('msession') && kinds.includes('context-panel'), 'the pinned pane persists beside the conversation')
  assert.equal(findFocusDrivenContext(persisted), null, 'the transient focus-driven pane is gone from storage')
  // A lone [conversation | its focus panel] persists as the one-pane tree.
  const lone = withoutFocusDrivenContext(t1)
  assert.ok(lone && lone.kind === 'pane' && lone.content.kind === 'msession')
})

test('unpinnedContent strips the focusDriven flag (a duplicated context pane becomes an independent pinned pane)', () => {
  const pinned = unpinnedContent(contextPaneContent('auth-refactor', repoPanel, { focusDriven: true }))
  assert.equal(panelOf(pinned)?.focusDriven, undefined)
  // findFocusDrivenContext then ignores it — a pinned pane is not the focus-driven one.
  const tree = splitPane(pane(auth), '', 'row', pinned)
  assert.equal(findFocusDrivenContext(tree), null)
  // Non-context content is returned unchanged.
  assert.deepEqual(unpinnedContent(projects), projects)
})

test('LIVE PRUNE: deleting a session evicts EVERY pane it hosts — conversation and context panes alike', () => {
  const ctxAuth: MainPaneContent = {
    kind: 'context-panel',
    id: 'auth-refactor repo repo-demo',
    sessionId: 'auth-refactor',
    panel: { kind: 'repo', id: 'repo-demo' },
  }
  // auth conversation | (auth's pinned context pane | projects)
  let t: MainSplitNode = splitPane(pane(auth), '', 'row', ctxAuth)
  t = splitPane(t, 'b', 'col', projects)
  const pruned = prunePanes(t, (c) => !hostsSession(c, 'auth-refactor'))
  assert.deepEqual(
    panes(pruned).map((p) => p.content),
    [projects],
    'both auth panes collapsed; the unrelated page inherits the surface',
  )
  // Pruning the LAST panes leaves the background (null) — the one close rule.
  assert.equal(prunePanes(pane(auth), (c) => !hostsSession(c, 'auth-refactor')), null)
  // No pane hosts the session ⇒ the SAME tree reference (no needless commit/persist).
  const untouched: MainSplitNode = splitPane(pane(projects), '', 'row', artifacts)
  assert.equal(prunePanes(untouched, (c) => !hostsSession(c, 'gone-id')), untouched)
})

test('the focus cue is recession, not decoration (owner directive 2026-07-21)', async () => {
  const { join } = await import('node:path')
  const { read, stripComments, ROOT } = await import('./helpers/source.ts')
  const src = stripComments(read(join(ROOT, 'src/components/MainSplit.tsx')))
  assert.ok(!src.includes('ring-accent'), 'the focused pane wears no accent ring (it read as noise, especially solo)')
  assert.match(
    src,
    /solo \|\| focused \? 'bg-canvas' : 'bg-sidebar'/,
    'focused and solo panes sit on the bright canvas; unfocused panes recede to the sidebar tone',
  )
})
