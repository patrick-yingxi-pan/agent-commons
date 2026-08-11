/** S9 — the reply CHAIN's shape (`src/lib/replyTree.ts`).
 *
 *  The recursive render is held at the DOM level by `e2e/social-layer.spec.ts`.
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
import { buildReplyTree, descendantCount, replyIndentClass, MAX_INDENT_DEPTH } from '../src/lib/replyTree.ts'

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
    assert.match(replyIndentClass(d), /\bpl-3\b/, `level ${d} still buys an indent`)
    assert.match(replyIndentClass(d), /max-sm:pl-2/, `level ${d} indents less where there is less room`)
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
