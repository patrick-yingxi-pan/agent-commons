/** ── The reply chain (social S9) ─────────────────────────────────────────────
 *  Posts arrive as a flat list carrying parent pointers (`DiscussionPost.replyTo`).
 *  This turns that into the tree a thread is actually shaped like, and answers
 *  the two questions a recursive render cannot answer for itself: how far to
 *  indent, and how much is hidden behind a folded branch.
 *
 *  Pure and framework-free so the parts that fail SILENTLY are held by
 *  `src/lib/reply-tree.test.ts` rather than by a screenshot: an orphan that
 *  vanishes, a cycle that hangs the renderer, an indent that eats a narrow pane.
 *
 *  **Depth is bounded HERE, not on the wire.** The server used to cap replies at
 *  one level, because one indent was all the surface could draw — and that cap
 *  discarded authorship to protect a layout, recording a post that answered Ada
 *  as answering Grace. The cap came out (owner directive 2026-08-11); the
 *  horizontal budget it was really about is a rendering problem, so it is solved
 *  where rendering happens, by a clamp and a reader who can fold a branch. */

/** The minimum a post must be for this module: an id, and who it answered. */
export interface ReplyLike {
  id: string
  replyTo?: string
}

export interface ReplyTree<P extends ReplyLike> {
  /** Top-level posts, in the order given — a discussion's spine is its
   *  chronology, and the server serves posts in the order they were written. */
  roots: P[]
  /** Answers to one post, in the order given. Absent key = a leaf. */
  childrenOf: Map<string, P[]>
}

/** Fold a flat post list into its reply tree.
 *
 *  Two shapes get treated as roots, both deliberately:
 *
 *  - **An orphan** — a post whose parent is not in THIS list. A preview
 *    projection legitimately carries a thread's tail without its head, and the
 *    server promotes real orphans on retract; either way the words are somebody's
 *    and must render, not vanish.
 *  - **A post in a cycle.** The write path cannot build one (a parent must
 *    already exist, and a new post's id is unnameable), so this is defence
 *    against a corrupted snapshot or a future writer — but the cost of being
 *    wrong is a renderer that never returns, and the cost of the guard is one
 *    pass. The FIRST member reached becomes a root and the edge into it is cut,
 *    so the rest of the ring hangs beneath it exactly once.
 *
 *  The invariant both serve, and the one the lock states: **every post appears
 *  exactly once**, whatever the pointers say. */
export function buildReplyTree<P extends ReplyLike>(posts: readonly P[]): ReplyTree<P> {
  const present = new Set(posts.map((p) => p.id))
  const childrenOf = new Map<string, P[]>()
  const roots: P[] = []
  for (const p of posts) {
    // `parent === p.id` is a self-reply — a one-post cycle, caught here so the
    // rescue pass below never has to consider the degenerate ring.
    if (p.replyTo === undefined || p.replyTo === p.id || !present.has(p.replyTo)) {
      roots.push(p)
      continue
    }
    const kids = childrenOf.get(p.replyTo)
    if (kids) kids.push(p)
    else childrenOf.set(p.replyTo, [p])
  }

  // Reachability, from the roots down. Anything left over is in a ring.
  const placed = new Set<string>()
  const walk = (p: P) => {
    if (placed.has(p.id)) return
    placed.add(p.id)
    for (const c of childrenOf.get(p.id) ?? []) walk(c)
  }
  for (const r of roots) walk(r)
  for (const p of posts) {
    if (placed.has(p.id)) continue
    // Cut the edge that made it unreachable, THEN promote — promoting alone
    // leaves the ring intact and the walk below re-enters it forever.
    const siblings = childrenOf.get(p.replyTo as string)
    if (siblings) {
      const i = siblings.indexOf(p)
      if (i >= 0) siblings.splice(i, 1)
    }
    roots.push(p)
    walk(p)
  }
  return { roots, childrenOf }
}

/** Every answer hanging below a post, at every depth — NOT including the post.
 *  Iterative and `seen`-guarded: a 200-post thread may legitimately be a
 *  200-deep chain, and a corrupted snapshot may be a ring.
 *
 *  Three callers want this set rather than its size: the folded post's count,
 *  the branch fold (fold a post and everything under it in one act), and the
 *  cascade delete's "may I remove all of these?" question. */
export function descendantsOf<P extends ReplyLike>(childrenOf: Map<string, P[]>, id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const next = stack.pop() as string
    for (const c of childrenOf.get(next) ?? []) {
      if (out.has(c.id) || c.id === id) continue
      out.add(c.id)
      stack.push(c.id)
    }
  }
  return out
}

/** How many answers hang below a post — the number a folded post reports, since
 *  folding hides the whole branch and not just its first row. */
export function descendantCount<P extends ReplyLike>(childrenOf: Map<string, P[]>, id: string): number {
  return descendantsOf(childrenOf, id).size
}

/** Whether the per-post unfold-all has anything to discard here — the render
 *  gate for the control `DISCARD_SLOT_CLASS` places.
 *
 *  A branch is the post PLUS everything under it, and the control opens all of
 *  it, so the question is whether any of that is folded. Two ways to be:
 *
 *  - the post itself is folded (`hidden`) — the case it was built for, and it
 *    stands there whether or not the interior is clean, so the control has a
 *    predictable place rather than a clever one;
 *  - the post is OPEN and something inside it is folded (owner directive
 *    2026-08-12). That case was missing, and it is the one where the caret is
 *    least able to help: an open post's caret folds it, and unfolding restores
 *    the same buried stubs, so a reader looking at a branch they have picked
 *    apart by hand had no control that would flatten it. "Unfold all" at the
 *    thread's head is the only thing that would, and it discards the fold state
 *    of every OTHER branch to do it.
 *
 *  Pure, and separated from the component for the reason `src/lib/CLAUDE.md`
 *  gives: `node --test` has no DOM, so a predicate left inline in the JSX can
 *  only ever be source-scanned. Here its truth table is testable. */
export function branchHasFold(hidden: boolean, kin: ReadonlySet<string>, folded: ReadonlySet<string>): boolean {
  if (kin.size === 0) return false
  if (hidden) return true
  // Iterate the FOLD SET and ask the branch, not the other way round: a reader
  // folds a handful of posts where a branch may hold 199, and this runs once per
  // row per render. Same answer either way; one of them is O(what you clicked).
  for (const id of folded) if (kin.has(id)) return true
  return false
}

/** Levels that still buy horizontal space. Past this the chain keeps NESTING —
 *  the relation is real, and re-attributing a deep reply to its grandparent is
 *  the falsehood the depth cap was removed for — but it stops spending width it
 *  cannot get back. At 17px a step (13px on the narrow tier) five levels cost
 *  85px / 65px, which the narrowest pane this app renders can still afford.
 *
 *  Why a clamp and not a "continue this thread" link: a discussion here is
 *  capped at 200 posts and typically holds a dozen, so a depth this list cannot
 *  show is rare — and paying for the rare case with a navigation that hides the
 *  common one is the wrong trade. The reader's own fold is the escape hatch. */
export const MAX_INDENT_DEPTH = 5

/** The fold caret's slot at the head of EVERY post row — a fixed width, reserved
 *  whether or not a caret is showing, so a caret that only appears on hover never
 *  nudges the words beside it.
 *
 *  Its half-width is the child list's left margin below (`replyIndentClass`),
 *  which is what puts the caret ON the hairline its own branch hangs from — the
 *  control and the thing it collapses are one vertical line (owner directive,
 *  2026-08-11). Two numbers that must agree and live in different strings are two
 *  numbers that will drift, so `src/lib/reply-tree.test.ts` recomputes the relation
 *  rather than restating it: nothing else would notice a caret sitting two pixels
 *  off the rail. */
export const FOLD_GUTTER_CLASS = 'w-4 max-sm:w-3 shrink-0'

/** The unfold-all's placement: **out of flow, directly BELOW the caret, in the
 *  caret's own column** (owner directive 2026-08-12 — *"positioned immediately
 *  below the corresponding fold/unfold button and vertically aligned with it,
 *  instead of being left to it and horizontally aligned"*).
 *
 *  **It is still the caret's SHADOW**, and the shadow rule is what survived the
 *  move: a sibling at a FIXED offset from the caret, **identical at every
 *  depth**, following the toggle it modifies rather than holding a position of
 *  its own. Only the axis changed — the offset used to be left, and is now
 *  down. So the two controls now share a centre **column** where they shared a
 *  centre **line**, which is the caret's own hairline (`FOLD_GUTTER_CLASS` is
 *  half the child list's margin), and the pair reads as one vertical run: fold
 *  here, and below it, open everything under here.
 *
 *  Why down beats left, having built both: to the caret's left is the one place
 *  in this row that belongs to nothing — it is the parent branch's rail and the
 *  page's own padding — so the control sat in a margin at depth 0 and inside
 *  someone else's indent below that. Underneath is the space its own branch
 *  occupies, which is what it acts on.
 *
 *  `absolute left-0 top-full` is exactly that and nothing more — offset from
 *  the gutter it lives in, so it inherits the gutter's indent for free. Which
 *  is why the gutter is `relative`. `flex` on the slot, not decoration: the
 *  Tooltip's `inline-flex` span would otherwise sit on a text baseline and take
 *  that line box's leading, the same 4px error the vertical note below records.
 *  Sized to the caret too: same width, height and radius, two controls of one
 *  kind reading as a pair.
 *
 *  **No gap, deliberately.** `top-full` abuts the gutter's 16px box exactly, so
 *  the glyphs sit ~4px apart (each is 12px in a 16px box) and the control ends
 *  precisely where the next row's caret box begins. A stub is one line tall and
 *  the rows are 12px apart, so any positive margin here puts a hover-revealed
 *  control on top of the NEXT post's caret — the collision is only reachable on
 *  a folded post, which is the state this control mostly renders in.
 *
 *  Five spellings were tried; three were wrong, and the wrong ones are the
 *  content of this comment (the fourth is the left-hand shadow this replaced,
 *  which was right about the relation and wrong about the axis):
 *
 *  1. **In flow, conditional.** Stubs landed at two x positions depending on
 *     what was folded inside them — 341 and 373, one above the other.
 *  2. **A reserved in-flow slot.** Aligned the stubs with each other by pushing
 *     all of them 32px right of the OPEN rows (357 → 389): "folding a post
 *     indents it". Invisible unless you compare a folded row with an unfolded
 *     one, which the fix for (1) never did.
 *  3. **One column down the page**, each control walked left by its own row's
 *     indent. Tidy, defensible, and *not a shadow* — the gap to the caret grew
 *     by a level of indent every step down the tree, so the one relationship
 *     the control has to the thing it modifies was the one thing that changed.
 *
 *  The lesson under all three: this control's position is not a layout decision
 *  to be optimised. It is a fixed relation to another control, and every
 *  attempt to improve on it broke the relation. That is also why moving the
 *  offset from left to down was a small change: the relation was already the
 *  thing being held, and it is held on the other axis now.
 *
 *  Room, measured rather than assumed: the gutter column below a row is empty
 *  for the whole height of the post — it is the run the child list's hairline
 *  will occupy — so the binding case is not space but the NEXT row, which the
 *  no-gap note above sizes against.
 *
 *  **Hidden on the narrow tier**, still, for a different reason than before.
 *  The old one was horizontal (2px from the screen edge) and the move retires
 *  it. The one that replaces it: `HOVER_REVEAL` pins hover-revealed controls
 *  visible where there is no hover, so every folded stub would grow a permanent
 *  second glyph 4px above the next post's caret — two chevrons in one column,
 *  belonging to two different posts. The thread-level "Unfold all" does the
 *  same job one tap further away, so the cut costs reach, not capability.
 *
 *  **`top-full` is an anchor, and it had to become one.** Setting no `top` used
 *  to be deliberate: an abspos box with no vertical anchor keeps its STATIC
 *  position — where it would have sat in flow — which inside the gutter's
 *  `items-center` row was already the caret's line, and `top-0` (added once as
 *  the supposed *fix* for a 4px drop) was in fact its cause, because Tooltip's
 *  `inline-flex` span lands on a text baseline and takes that line box's
 *  leading. Anchoring below means that leading is back in play, which is what
 *  `flex` on the slot removes — the child is no longer an inline box, so there
 *  is no line box to inherit a baseline from. The 4px is measured by the same
 *  assertion as before (`e2e/social-anchors.spec.ts`), rotated: it now checks
 *  the shared centre COLUMN and a constant vertical gap.
 *
 *  Four pixels is invisible in a screenshot and reads as unexplained
 *  sloppiness. Only that assertion finds it — which is also how the mistake
 *  above was caught, by mutating the class and watching the lock stay green. */
export const DISCARD_SLOT_CLASS = 'absolute left-0 top-full flex max-sm:hidden'

/** The nested list's own class at `depth` (1 = an answer to a root post).
 *
 *  The RAIL is unconditional and the padding is not: past the clamp a level
 *  still draws its own hairline — so "there is more depth here" stays visible —
 *  while the text column stops narrowing. Static class strings, because
 *  Tailwind scans source and a computed `pl-${n}` compiles to nothing. */
export function replyIndentClass(depth: number): string {
  const rail = 'ml-2 max-sm:ml-1.5 border-l border-line'
  return depth <= MAX_INDENT_DEPTH ? `${rail} pl-2 max-sm:pl-1.5` : rail
}

/** Every post ABOVE `id` in the chain — the posts that must stay open for `id`
 *  to be on screen at all, since folding one collapses everything under it.
 *
 *  Two callers need exactly this, and both get it wrong in the same silent way
 *  without it: "fold the others" (fold an ancestor and the post you asked to see
 *  goes with it) and the composer guard in `DiscussionPostList` (fold an
 *  ancestor and the reply someone is part-way through writing is gone — the
 *  post itself was spared, but nothing renders it).
 *
 *  Ring-safe: the walk stops the first time it revisits, so a corrupted parent
 *  chain costs one pass rather than the tab. */
export function ancestorsOf<P extends ReplyLike>(tree: ReplyTree<P>, id: string): Set<string> {
  // Derived, not stored: `buildReplyTree` already cut every edge that would make
  // a second parent possible, so this index is total and unambiguous.
  const parentOf = new Map<string, string>()
  for (const [pid, kids] of tree.childrenOf) for (const k of kids) parentOf.set(k.id, pid)
  const up = new Set<string>()
  for (let at = parentOf.get(id); at !== undefined && at !== id && !up.has(at); at = parentOf.get(at)) up.add(at)
  return up
}

/** "Fold the others" — **exactly the fold toggle, pressed on every other thread**
 *  (owner directive 2026-08-11, replacing a first cut that folded every post off
 *  the reading line at every depth).
 *
 *  The difference is the whole point of the redesign. Folding at depth *reached
 *  inside* the branches it folded, so opening one afterwards gave you a stub
 *  whose answers were stubs too — the arrangement you had built in there was
 *  gone, and "fold the others" had quietly become "fold-all everything else".
 *  A bulk act may fold a post; it may not decide what that post looks like when
 *  it is opened again.
 *
 *  So: at each step of the line from a root down to `id`, fold the siblings that
 *  were not taken, and touch nothing below them. Concretely —
 *
 *  - every **root** that is not on the line (called on a root, this is the whole
 *    act, which is the case the directive names);
 *  - at every ancestor on the line, its children that are not on the line;
 *  - **never** `id`'s own descendants, which are the branch you asked to see.
 *
 *  It takes the current fold set and returns the next one, because the act has
 *  an unfolding half as well: the line itself is opened, or "show me only this"
 *  could leave the this behind a stub. Every id it does not name keeps whatever
 *  state it had — that is the invertibility contract the toggle now owes. */
export function foldOthers<P extends ReplyLike>(
  tree: ReplyTree<P>,
  id: string,
  folded: ReadonlySet<string>,
): Set<string> {
  const line = ancestorsOf(tree, id)
  line.add(id)
  const next = new Set(folded)
  for (const open of line) next.delete(open)
  for (const r of tree.roots) if (!line.has(r.id)) next.add(r.id)
  for (const a of line) {
    if (a === id) continue
    for (const c of tree.childrenOf.get(a) ?? []) if (!line.has(c.id)) next.add(c.id)
  }
  return next
}
