/** S9 — the reply CHAIN's shape (`src/lib/replyTree.ts`).
 *
 *  The recursive render is held at the DOM level by `e2e/social-anchors.spec.ts`.
 *  What lives here is the arithmetic underneath it, which is exactly the part
 *  that fails silently: a post that renders zero times because its parent is
 *  missing, a post that renders twice, a ring that never returns, an indent that
 *  eats a narrow pane one level at a time.
 *
 *  The depth CAP used to live on the write path (`resolveReplyTarget` re-parented
 *  a reply-to-a-reply onto the root) precisely because none of this existed. It
 *  came out when the renderer learned to draw a chain — so these are the
 *  assertions that make removing it safe. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ancestorsOf,
  buildReplyTree,
  descendantCount,
  foldOthers,
  replyIndentClass,
  MAX_INDENT_DEPTH,
  DISCARD_SLOT_CLASS,
  FOLD_GUTTER_CLASS,
} from './replyTree.ts'

/** A post, reduced to what the tree needs. */
const p = (id: string, replyTo?: string) => ({ id, ...(replyTo === undefined ? {} : { replyTo }) })

/** Walk the built tree and report every post in render order, so "renders
 *  exactly once" can be asserted against the LIST rather than trusted. */
function rendered(tree: ReturnType<typeof buildReplyTree<ReturnType<typeof p>>>): string[] {
  const out: string[] = []
  const visit = (node: { id: string }, guard: number) => {
    assert.ok(guard < 1000, 'the walk did not terminate — the tree has a ring in it')
    out.push(node.id)
    for (const c of tree.childrenOf.get(node.id) ?? []) visit(c, guard + 1)
  }
  for (const r of tree.roots) visit(r, 0)
  return out
}

test('a chain nests to its real depth — the cap is gone', () => {
  // The shape the removal of `resolveReplyTarget`'s flatten makes possible:
  // C answers B answers A. Under the old rule C was re-parented onto A, so it
  // rendered beside B as though it had answered the root — and rang A's bell.
  const tree = buildReplyTree([p('a'), p('b', 'a'), p('c', 'b'), p('d', 'c')])
  assert.deepEqual(
    tree.roots.map((x) => x.id),
    ['a'],
    'one root; every other post hangs off what it actually answered',
  )
  assert.deepEqual(tree.childrenOf.get('a')?.map((x) => x.id), ['b'])
  assert.deepEqual(tree.childrenOf.get('b')?.map((x) => x.id), ['c'])
  assert.deepEqual(tree.childrenOf.get('c')?.map((x) => x.id), ['d'])
  assert.equal(tree.childrenOf.get('d'), undefined, 'a leaf holds no key')
})

test('siblings and roots keep the order they arrived in — a thread is a chronology', () => {
  // The server serves posts in the order they were written, and the previous
  // one-level grouping REORDERED them: replies were pulled up under their
  // parent, so an answer from an hour ago rendered above a remark from a week
  // earlier (owner-reported 2026-08-11, with a screenshot of exactly that).
  // Nesting is allowed to move a post; sibling order is not.
  const tree = buildReplyTree([p('first'), p('r2', 'first'), p('second'), p('r1', 'first')])
  assert.deepEqual(tree.roots.map((x) => x.id), ['first', 'second'])
  assert.deepEqual(tree.childrenOf.get('first')?.map((x) => x.id), ['r2', 'r1'], 'answers in arrival order, not re-sorted')
})

test('an ORPHAN renders as a root rather than vanishing', () => {
  // Two ways to get one, and neither is a defect: the feed card's preview
  // carries a thread's TAIL without its head, and the server promotes real
  // orphans when a parent is retracted. Dropping either would silently hide
  // somebody's words — the failure a strict grouping makes and never reports.
  const tree = buildReplyTree([p('kept', 'retracted-or-absent'), p('root')])
  assert.deepEqual(rendered(tree), ['kept', 'root'], 'the orphan renders, in place')
})

test('every post renders EXACTLY once, whatever the pointers say', () => {
  // The invariant the render depends on and cannot check for itself. A cycle is
  // unreachable through the write path — a parent must already exist, and a new
  // post's id is unnameable — so this is defence against a corrupted snapshot or
  // a future writer. The cost of being wrong is a renderer that never returns.
  for (const [name, posts] of [
    ['a two-post ring', [p('a', 'b'), p('b', 'a')]],
    ['a self-reply', [p('solo', 'solo')]],
    ['a ring with a tail hanging off it', [p('a', 'c'), p('b', 'a'), p('c', 'b'), p('tail', 'c')]],
    ['a ring beside a real thread', [p('root'), p('kid', 'root'), p('x', 'y'), p('y', 'x')]],
  ] as const) {
    const tree = buildReplyTree(posts)
    const order = rendered(tree)
    assert.deepEqual(
      [...order].sort(),
      posts.map((x) => x.id).sort(),
      `${name}: every post appears, and none appears twice`,
    )
  }
})

test('the branch count is the whole branch, not its first row', () => {
  // It is the number a FOLDED branch reports, and folding hides descendants
  // too — so counting direct children would tell the reader that two posts
  // disappeared when five did.
  const { childrenOf } = buildReplyTree([p('a'), p('b', 'a'), p('c', 'b'), p('d', 'b'), p('e', 'a')])
  assert.equal(descendantCount(childrenOf, 'a'), 4, 'b, c, d and e — every level below')
  assert.equal(descendantCount(childrenOf, 'b'), 2)
  assert.equal(descendantCount(childrenOf, 'e'), 0, 'a leaf has nothing to hide')
})

test('the indent CLAMPS, and the rail never stops', () => {
  // The trade the removed depth cap forced into the open: depth is real data, so
  // it is bounded where it is actually a problem — the horizontal budget of a
  // list that renders in a split pane and on the narrow tier.
  for (let d = 1; d <= MAX_INDENT_DEPTH; d += 1) {
    assert.match(replyIndentClass(d), /\bpl-2\b/, `level ${d} still buys an indent`)
    assert.match(replyIndentClass(d), /max-sm:pl-1\.5/, `level ${d} indents less where there is less room`)
  }
  assert.doesNotMatch(replyIndentClass(MAX_INDENT_DEPTH + 1), /\bpl-/, 'past the clamp it stops spending width')
  assert.doesNotMatch(replyIndentClass(40), /\bpl-/, 'and never resumes')
  // The hairline is unconditional: past the clamp it is the ONLY thing saying
  // "this answers the post above", so dropping it there would make a deep reply
  // read as a sibling of its own parent — the misattribution this whole slice
  // removed from the write path.
  for (const d of [1, MAX_INDENT_DEPTH, MAX_INDENT_DEPTH + 1, 40]) {
    assert.match(replyIndentClass(d), /border-l/, `level ${d} still draws the chain`)
  }
})

/** The Tailwind spacing number a class set carries on one tier: `w-4` → 4,
 *  `max-sm:w-3` → 3 on the narrow tier and nothing on the base one (the `:` in
 *  front of `w-` is not the word boundary the base pattern needs). Undefined
 *  when the tier does not set the property at all. */
function scale(classes: string, tier: 'base' | 'narrow', prop: string): number | undefined {
  const prefix = tier === 'narrow' ? 'max-sm:' : ''
  const m = new RegExp(`(?:^|\\s)${prefix}${prop}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`).exec(classes)
  return m ? Number(m[1]) : undefined
}

test('the fold caret sits ON the hairline it collapses, at both tiers', () => {
  // The owner's placement rule (2026-08-11): the fold control lines up with the
  // vertical rule its own branch hangs from. That is one relation held across
  // two unrelated strings — a gutter WIDTH here, a child list's MARGIN there —
  // so it is recomputed rather than restated. Nothing else in the suite, and no
  // screenshot anybody reviews at a glance, would catch a caret two pixels off
  // the line; it just reads as sloppiness of unknown origin.
  for (const tier of ['base', 'narrow'] as const) {
    const gutter = scale(FOLD_GUTTER_CLASS, tier, 'w')
    const margin = scale(replyIndentClass(1), tier, 'ml')
    assert.ok(gutter !== undefined, `the ${tier} tier gives the caret a slot`)
    assert.ok(margin !== undefined, `the ${tier} tier offsets the child list`)
    assert.equal(margin, gutter / 2, `${tier}: the rail lands on the caret's centre, not beside it`)
  }
})

test('the discard is the caret’s shadow on the VERTICAL axis, and costs the row nothing', () => {
  // The owner's placement rule, moved 2026-08-12: directly BELOW the caret, in
  // the caret's own column. Three properties, each of which was a live bug at
  // some point in this control's history — see the class's own comment.
  assert.match(DISCARD_SLOT_CLASS, /\babsolute\b/, 'out of flow, so a control that comes and goes moves nothing')
  assert.match(DISCARD_SLOT_CLASS, /\btop-full\b/, 'anchored below the caret’s box')
  assert.match(DISCARD_SLOT_CLASS, /\bleft-0\b/, 'and in the caret’s column, not offset from it')
  // The horizontal offsets of the previous placement, stated as absences: with
  // `left-0` in the string as well, a stray `right-full` would silently win and
  // put the control back beside the caret at a width nobody chose.
  assert.doesNotMatch(DISCARD_SLOT_CLASS, /\bright-full\b/, 'the left-hand shadow is gone, not merely overridden')
  assert.doesNotMatch(DISCARD_SLOT_CLASS, /\bm[rl]-/, 'no horizontal margin — the column is shared exactly')
  // `flex`, so the Tooltip's `inline-flex` child is not an inline box: an inline
  // child sits on a line box and takes its leading, which is the 4px drop that
  // cost a commit the last time this control was anchored explicitly.
  assert.match(DISCARD_SLOT_CLASS, /\bflex\b/, 'no line box, so no baseline leading under the anchor')
  // Cut on the narrow tier: `HOVER_REVEAL` pins hover-revealed controls visible
  // where there is no hover, so every folded stub would carry a permanent second
  // glyph 4px above the NEXT post's caret — two chevrons in one column belonging
  // to two different posts. The thread-level Unfold all covers that reach.
  assert.match(DISCARD_SLOT_CLASS, /\bmax-sm:hidden\b/, 'and absent where it would be pinned visible')
})

test('“only this” is the fold TOGGLE pressed on every other thread — it never reaches inside one', () => {
  //      a            f
  //     ╱ ╲            ╲
  //    b   e            g
  //   ╱ ╲
  //  c   d
  const posts = [p('a'), p('b', 'a'), p('c', 'b'), p('d', 'b'), p('e', 'a'), p('f'), p('g', 'f')]
  const tree = buildReplyTree(posts)

  // The revision this test was rewritten for (owner directive 2026-08-11). The
  // first cut folded EVERYTHING off the reading line at every depth, which
  // quietly made "only this" a fold-all of every other branch: open one of them
  // afterwards and you got a stub whose answers were stubs too, with whatever
  // you had arranged in there gone. Now it presses the toggle on the siblings
  // and stops.
  const folded = foldOthers(tree, 'b', new Set())
  assert.ok(!folded.has('a'), 'the ancestor stays open — folding it would take b down with it')
  assert.ok(!folded.has('b'), 'the post itself')
  for (const kid of ['c', 'd']) assert.ok(!folded.has(kid), `${kid} — soloing shows the branch entire`)
  assert.deepEqual([...folded].sort(), ['e', 'f'], 'the siblings at each level of the line, and nothing below them')
  assert.ok(!folded.has('g'), 'g is INSIDE a folded sibling — its own state is not this act’s business')

  // Every interior it is handed comes back untouched — the branch it folds AND
  // the branch it spares. This is the invertibility contract: press the
  // sibling's caret afterwards and you get back exactly what you had, and your
  // own branch is the arrangement you left in it, not a freshly flattened one.
  const withInterior = foldOthers(tree, 'b', new Set(['g', 'c']))
  assert.ok(withInterior.has('g'), 'a fold inside a branch it folds survives')
  assert.ok(withInterior.has('c'), 'and so does one inside the branch it spares — “only this” is not an unfold-all')
  // What it DOES open is the line, because a folded ancestor (or a folded
  // target) would hide the very post you asked to be shown.
  const buried = foldOthers(tree, 'b', new Set(['a', 'b']))
  for (const open of ['a', 'b']) assert.ok(!buried.has(open), `${open} is on the line and must be visible`)

  // From a ROOT it is exactly "fold the other roots", the case the directive names.
  assert.deepEqual([...foldOthers(tree, 'a', new Set())], ['f'])
  // From the deepest post, every ancestor survives — the chain back up to the
  // surface is what makes the post reachable at all — and each contributes its
  // own unchosen children.
  const deep = [p('a'), p('b', 'a'), p('c', 'b'), p('d', 'c'), p('aunt', 'b'), p('other')]
  assert.deepEqual([...foldOthers(buildReplyTree(deep), 'd', new Set())].sort(), ['aunt', 'other'])
})

test('the chain ABOVE a post is what has to stay open for it to be on screen', () => {
  // Whoever folds an ancestor folds the post, whatever they meant to do — which
  // is why the two callers that must not lose a post share this walk instead of
  // each writing their own. The composer guard is the one that fails silently
  // without it: sparing the post someone is answering, while leaving its parent
  // free to fold, hides the draft just as completely and reads as though it
  // works (found reviewing this change, not by running it).
  const posts = [p('a'), p('b', 'a'), p('c', 'b'), p('d', 'c'), p('sibling', 'a'), p('other')]
  const tree = buildReplyTree(posts)
  assert.deepEqual([...ancestorsOf(tree, 'd')].sort(), ['a', 'b', 'c'], 'every level up, not just the parent')
  assert.deepEqual([...ancestorsOf(tree, 'b')], ['a'])
  assert.deepEqual([...ancestorsOf(tree, 'a')], [], 'a root has nothing above it')
  assert.deepEqual([...ancestorsOf(tree, 'other')], [], 'nor does an unrelated root')
  assert.deepEqual([...ancestorsOf(tree, 'nonexistent')], [], 'and an id the tree never saw is not an error')
  // A ring costs one pass, not the tab — the guard `foldOthers` relies on too.
  const ring = {
    roots: [],
    childrenOf: new Map([
      ['x', [p('y')]],
      ['y', [p('x')]],
    ]),
  }
  assert.deepEqual([...ancestorsOf(ring, 'x')].sort(), ['x', 'y'].filter((i) => i !== 'x'))
})

test('“only this” terminates on a ring rather than hanging the click', () => {
  // `buildReplyTree` cuts every ring before the renderer sees one, so this can
  // only arrive through a corrupted snapshot or a future writer — the same
  // reasoning the builder's own guard states. Hand-built, because the builder
  // would (correctly) refuse to produce it: x and y each claim the other.
  const ring = {
    roots: [p('z')],
    childrenOf: new Map([
      ['x', [p('y')]],
      ['y', [p('x')]],
    ]),
  }
  const folded = foldOthers(ring, 'x', new Set())
  assert.deepEqual([...folded], ['z'], 'the ring is walked once and the unrelated root folds')
})
