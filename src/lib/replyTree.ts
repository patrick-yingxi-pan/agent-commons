/** ── The reply chain (social S9) ─────────────────────────────────────────────
 *  Posts arrive as a flat list carrying parent pointers (`DiscussionPost.replyTo`).
 *  This turns that into the tree a thread is actually shaped like, and answers
 *  the two questions a recursive render cannot answer for itself: how far to
 *  indent, and how much is hidden behind a folded branch.
 *
 *  Pure and framework-free so the parts that fail SILENTLY are held by
 *  `tests/reply-tree.test.ts` rather than by a screenshot: an orphan that
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
 *  numbers that will drift, so `tests/reply-tree.test.ts` recomputes the relation
 *  rather than restating it: nothing else would notice a caret sitting two pixels
 *  off the rail. */
export const FOLD_GUTTER_CLASS = 'w-4 max-sm:w-3 shrink-0'

/** The unfold-all's placement: **out of flow, immediately left of the caret**
 *  (owner directive 2026-08-11 — *"a hover effect to the left of the unfold
 *  button without affecting the indent of the texts to the right of the
 *  button"*).
 *
 *  Out of flow is the requirement, not a detail of it. This control renders on
 *  some folded posts and not others — only where it would not merely repeat the
 *  caret — so ANY in-flow spelling moves the words beside it on some rows and
 *  not others. Two attempts got this wrong in opposite directions and both are
 *  worth remembering:
 *
 *  1. **No slot.** Stubs sat at two different x positions depending on what was
 *     folded inside them — 341 and 373, one above the other.
 *  2. **A reserved in-flow slot.** That aligned the stubs with each other by
 *     pushing every one of them 32px right of the OPEN rows (357 → 389). It
 *     reads as "folding a post indents it", and it is invisible unless you
 *     compare a folded post with an unfolded one — the comparison the first fix
 *     never made. A reserved slot is only honest where the thing it reserves
 *     for is sometimes-present in a row that is otherwise always the same
 *     shape; here the two row shapes differ anyway.
 *
 *  So it hangs off the caret's own gutter (`absolute right-full`), which is why
 *  that gutter is `relative`, and it is sized to the caret: same width, same
 *  height, same radius — two controls of one kind read as a pair, and matching
 *  the gutter means the space it needs is exactly the space a caret needs. At
 *  depth 0 that space is the page's own left padding: 63px at the desktop tier,
 *  16px at the narrow one against a 12px caret, measured rather than assumed.
 *
 *  **Hidden on the narrow tier.** `HOVER_REVEAL` pins hover-revealed controls
 *  visible there (no hover to reveal them with), so this one would sit
 *  permanently 2px from the screen edge on any stub that qualified. The
 *  thread-level "Unfold all" does the same job one tap further away, so the
 *  cut costs reach, not capability. */
export const DISCARD_SLOT_CLASS = 'absolute right-full mr-1 max-sm:mr-0.5 max-sm:hidden'

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
