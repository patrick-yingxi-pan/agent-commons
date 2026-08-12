/** Locking tests: the pane back-history model (src/lib/paneHistory.ts —
 *  ADAPT-18, the back-history rule). Every page opened by clicking WITHIN a
 *  page carries a back affordance to its origin: in-page doors push the
 *  outgoing page (with its whole chain) onto the target's `back` stack, the
 *  affordance pops it, and browser Back/Forward walk the same model. These
 *  lock:
 *    1. `paneLocOf` — the live-page projection (a section pane's reported
 *       `at` wins; a context pane addresses as its OWNING conversation; a
 *       session's title is carried, resolved when you leave it),
 *    2. `pushedBack` — carried stack + folded in-section stack + live page,
 *       adjacent-duplicate collapse, the BACK_MAX cap,
 *    3. `contentForLoc` — a back entry restores the page it named (and the
 *       stack survives the JSON persistence round-trip),
 *    4. `planPop` — popstate order: pop the focused pane's own back top,
 *       else refocus a pane already showing the address, else plain route,
 *    5. `scrubBackStacks` — a pruned subject vanishes from history too. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACK_MAX,
  contentForLoc,
  navLocationOfLoc,
  paneLocOf,
  planPop,
  pushedBack,
  samePaneLoc,
  scrubBackStacks,
  withBackPush,
} from './paneHistory.ts'
import { hostsSession, paneLocationPath, type MainPaneContent, type MainSplitNode, type PaneLoc } from './mainSplit.ts'
import { pane, panes, splitPane } from './splitFrame.ts'

const titleOf = (id: string) => (id === 's1' ? 'Auth refactor' : 'Conversation')

test('paneLocOf projects the LIVE page: at wins, panels address as their conversation, titles are carried', () => {
  // A section pane's reported location wins over the stale door seed.
  assert.deepEqual(
    paneLocOf({
      kind: 'msection',
      id: 'projects',
      seed: { projectId: 'p-old' },
      at: { sub: 'mine', projectId: 'p1' },
    }),
    { kind: 'msection', id: 'projects', sub: 'mine', seed: { projectId: 'p1' } },
  )
  // No detail, no sub → the bare section root.
  assert.deepEqual(paneLocOf({ kind: 'msection', id: 'artifacts' }), { kind: 'msection', id: 'artifacts' })
  // A conversation carries its resolved title (nav.ts: resolved when you leave it).
  assert.deepEqual(paneLocOf({ kind: 'msession', id: 's1' }, titleOf), { kind: 'msession', id: 's1', title: 'Auth refactor' })
  // A context-panel pane is not a page — it addresses as its OWNING conversation.
  assert.deepEqual(
    paneLocOf({ kind: 'context-panel', id: 's1 repo r1', sessionId: 's1', panel: { kind: 'repo', id: 'r1' } }, titleOf),
    { kind: 'msession', id: 's1', title: 'Auth refactor' },
  )
})

test('pushedBack folds carried + in-section stacks + the live page, deduped and capped', () => {
  const origin: MainPaneContent = {
    kind: 'msection',
    id: 'projects',
    back: [{ kind: 'msession', id: 's1', title: 'Auth refactor' }],
    hist: [{}, { projectId: 'p1' }],
    at: { sub: null, projectId: 'p1', workItemId: 'w1' },
  }
  assert.deepEqual(pushedBack(origin), [
    { kind: 'msession', id: 's1', title: 'Auth refactor' },
    { kind: 'msection', id: 'projects' }, // the empty hist entry = the list page
    { kind: 'msection', id: 'projects', seed: { projectId: 'p1' } },
    { kind: 'msection', id: 'projects', seed: { projectId: 'p1', workItemId: 'w1' } },
  ])
  // Adjacent duplicates collapse (the nav.ts pushLocation rule)…
  const dup: MainPaneContent = {
    kind: 'msection',
    id: 'projects',
    back: [{ kind: 'msection', id: 'projects', seed: { projectId: 'p1' } }],
    hist: [{ projectId: 'p1' }],
    at: { sub: null, projectId: 'p2' },
  }
  assert.deepEqual(pushedBack(dup), [
    { kind: 'msection', id: 'projects', seed: { projectId: 'p1' } },
    { kind: 'msection', id: 'projects', seed: { projectId: 'p2' } },
  ])
  // …and the chain is capped at BACK_MAX, dropping the OLDEST.
  const long: MainPaneContent = {
    kind: 'msession',
    id: 's9',
    back: Array.from({ length: BACK_MAX + 10 }, (_, i) => ({ kind: 'msession' as const, id: `s${i}` })),
  }
  const capped = pushedBack(long)
  assert.equal(capped.length, BACK_MAX)
  assert.deepEqual(capped[capped.length - 1], { kind: 'msession', id: 's9' }, 'the live page is the top')
  assert.deepEqual(capped[0], { kind: 'msession', id: `s${BACK_MAX + 10 - (BACK_MAX - 1)}` }, 'the oldest dropped')
})

test('withBackPush is the ONE push funnel: origin chain rides the target; a same-page re-click pushes no self-loop', () => {
  const origin: MainPaneContent = { kind: 'msection', id: 'projects', at: { sub: null, projectId: 'p1' } }
  const landed = withBackPush(origin, { kind: 'msession', id: 's1' })
  assert.deepEqual(landed, {
    kind: 'msession',
    id: 's1',
    back: [{ kind: 'msection', id: 'projects', seed: { projectId: 'p1' } }],
  })
  // Re-clicking the page already shown (the active run in the run switcher):
  // the live entry is dropped — history stands as it was, no self-loop.
  const run: MainPaneContent = { kind: 'msession', id: 'srun-1', back: [{ kind: 'msession', id: 'srun-0' }] }
  assert.deepEqual(withBackPush(run, { kind: 'msession', id: 'srun-1' }), {
    kind: 'msession',
    id: 'srun-1',
    back: [{ kind: 'msession', id: 'srun-0' }],
  })
  // …and with no remaining history the target lands clean (no empty array).
  assert.deepEqual(withBackPush({ kind: 'msession', id: 's2' }, { kind: 'msession', id: 's2' }), {
    kind: 'msession',
    id: 's2',
  })
})

test('contentForLoc restores the page a back entry names — and the stack survives JSON persistence', () => {
  const loc: PaneLoc = { kind: 'msection', id: 'scheduled', sub: null, seed: { scheduleId: 't1' } }
  const rest: PaneLoc[] = [{ kind: 'msession', id: 's1', title: 'Auth refactor' }]
  assert.deepEqual(contentForLoc(loc, rest), {
    kind: 'msection',
    id: 'scheduled',
    sub: null,
    seed: { scheduleId: 't1' },
    back: rest,
  })
  assert.deepEqual(contentForLoc({ kind: 'msession', id: 's1' }, []), { kind: 'msession', id: 's1' })
  // The stack rides the persisted tree (plain JSON).
  const tree = pane<MainPaneContent>({ kind: 'msession', id: 's2', back: rest })
  const revived = JSON.parse(JSON.stringify(tree)) as MainSplitNode
  const leaf = panes(revived)[0].content
  assert.deepEqual(leaf.kind !== 'context-panel' ? leaf.back : null, rest)
})

test('navLocationOfLoc names the destination for the one label resolver', () => {
  assert.deepEqual(navLocationOfLoc({ kind: 'msession', id: 's1', title: 'Auth refactor' }), {
    kind: 'session',
    sessionId: 's1',
    title: 'Auth refactor',
  })
  const nav = navLocationOfLoc({ kind: 'msection', id: 'projects', seed: { projectId: 'p1' } })
  assert.equal(nav.kind, 'section')
  if (nav.kind === 'section') {
    assert.equal(nav.projectId, 'p1')
    assert.equal(nav.scheduleId, null, 'absent detail ids are explicit nulls (NavLocation shape)')
  }
})

test('planPop: pop the focused back top, else refocus a showing pane, else route', () => {
  // Pane 'a' = a project page whose back top is the conversation it was
  // opened from; pane 'b' = that very conversation (a split duplicate case).
  const projectPage: MainPaneContent = {
    kind: 'msection',
    id: 'projects',
    seed: { projectId: 'p1' },
    back: [{ kind: 'msession', id: 's1', title: 'Auth refactor' }],
  }
  const tree = splitPane(pane<MainPaneContent>(projectPage), '', 'row', { kind: 'msession', id: 's2' })

  // 1) The address matches the focused pane's back top → POP it (stack spent).
  const pop = planPop(tree, 'a', '/s/s1')
  assert.equal(pop.kind, 'pop')
  if (pop.kind === 'pop') {
    assert.equal(pop.path, 'a')
    assert.deepEqual(pop.content, { kind: 'msession', id: 's1' })
  }
  // 2) No back match, but another pane SHOWS the address → refocus it (a
  //    focus-hop history entry must never clobber the focused pane).
  const focus = planPop(tree, 'a', '/s/s2')
  assert.deepEqual(focus, { kind: 'focus', path: 'b' })
  // 3) Nothing matches → the plain focused-pane route.
  assert.deepEqual(planPop(tree, 'a', '/s/elsewhere'), { kind: 'route' })
  // The pop arm compares CANONICAL paths — the same projection the address
  // bar uses (paneLocationPath), so a deep section entry matches too.
  const deep: MainPaneContent = {
    kind: 'msession',
    id: 's3',
    back: [{ kind: 'msection', id: 'projects', seed: { projectId: 'p1', workItemId: 'w1' } }],
  }
  const t2 = pane<MainPaneContent>(deep)
  const pop2 = planPop(t2, '', '/projects/p1/work/w1')
  assert.equal(pop2.kind, 'pop')
  if (pop2.kind === 'pop') assert.equal(paneLocationPath(pop2.content), '/projects/p1/work/w1')
})

test('planPop pops over an IN-SECTION hop too — the carried stack survives (the review-caught amputation)', () => {
  // A conversation's breadcrumb opened the project page (back = [conv]),
  // then a local drill opened its work item (hist = [{projectId}]). Browser
  // Back targets the project page: the pop must come from the FOLDED chain,
  // restoring the page WITH its carried conversation entry — the plain route
  // arm would have amputated it.
  const c: MainPaneContent = {
    kind: 'msection',
    id: 'projects',
    back: [{ kind: 'msession', id: 's1', title: 'Auth refactor' }],
    hist: [{ projectId: 'p1' }],
    at: { sub: null, projectId: 'p1', workItemId: 'w1' },
  }
  const plan = planPop(pane<MainPaneContent>(c), '', '/projects/p1')
  assert.equal(plan.kind, 'pop')
  if (plan.kind === 'pop') {
    assert.deepEqual(plan.content, {
      kind: 'msection',
      id: 'projects',
      seed: { projectId: 'p1' },
      back: [{ kind: 'msession', id: 's1', title: 'Auth refactor' }],
    })
  }
})

test('scrubBackStacks drops a pruned subject from every history too (live-prune companion)', () => {
  const tree = pane<MainPaneContent>({
    kind: 'msection',
    id: 'projects',
    seed: { projectId: 'p1' },
    back: [
      { kind: 'msession', id: 'dead' },
      { kind: 'msection', id: 'artifacts' },
    ],
  })
  const keep = (c: MainPaneContent) => !hostsSession(c, 'dead')
  const scrubbed = scrubBackStacks(tree, keep)
  const leaf = panes(scrubbed)[0].content
  assert.deepEqual(leaf.kind !== 'context-panel' ? leaf.back : null, [{ kind: 'msection', id: 'artifacts' }])
  // Reference-preserving when nothing changes (no needless persist).
  assert.equal(scrubBackStacks(scrubbed, keep), scrubbed)
  // Removing an entry re-collapses neighbors it made adjacent-identical —
  // the pushedBack dedup invariant holds post-scrub (one click per page).
  const sandwich = pane<MainPaneContent>({
    kind: 'msession',
    id: 's9',
    back: [
      { kind: 'msection', id: 'projects', seed: { projectId: 'p1' } },
      { kind: 'msession', id: 'dead' },
      { kind: 'msection', id: 'projects', seed: { projectId: 'p1' } },
    ],
  })
  const collapsed = panes(scrubBackStacks(sandwich, keep))[0].content
  assert.deepEqual(collapsed.kind !== 'context-panel' ? collapsed.back : null, [
    { kind: 'msection', id: 'projects', seed: { projectId: 'p1' } },
  ])
})

test('samePaneLoc is page identity — a carried title is chrome, not identity', () => {
  assert.ok(samePaneLoc({ kind: 'msession', id: 's1', title: 'A' }, { kind: 'msession', id: 's1', title: 'B' }))
  assert.ok(
    samePaneLoc(
      { kind: 'msection', id: 'projects', seed: { projectId: 'p1' } },
      { kind: 'msection', id: 'projects', sub: null, seed: { projectId: 'p1' } },
    ),
    'absent and null sub are the same page',
  )
  assert.ok(!samePaneLoc({ kind: 'msession', id: 's1' }, { kind: 'msection', id: 'projects' }))
})
