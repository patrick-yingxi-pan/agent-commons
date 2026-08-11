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

/** "Fold the others" — every post EXCEPT the reading line through `id`.
 *
 *  The line is three things, and each is there because dropping it breaks the
 *  act's own promise:
 *
 *  - the post's **ancestors**, because a folded ancestor takes the post down with
 *    it, and "show me only this" that hides the this is not a feature;
 *  - the **post**;
 *  - its **descendants** — soloing a branch shows the branch ENTIRE, not its
 *    first row. Fold-all is how you ask for a spine.
 *
 *  That reading also settles what "the others" means at depth, which is genuinely
 *  ambiguous in words (my siblings? every other branch in the thread?):
 *  everything not on the line I am reading, at every level.
 *
 *  Ring-safe in both directions, on the same reasoning `buildReplyTree` states —
 *  the write path cannot build a cycle, and the cost of being wrong is a renderer
 *  that never returns. */
export function foldOthers<P extends ReplyLike>(
  posts: readonly P[],
  tree: ReplyTree<P>,
  id: string,
): Set<string> {
  const open = ancestorsOf(tree, id)
  open.add(id)
  const stack = [id]
  while (stack.length > 0) {
    const next = stack.pop() as string
    for (const c of tree.childrenOf.get(next) ?? []) {
      if (open.has(c.id)) continue
      open.add(c.id)
      stack.push(c.id)
    }
  }

  const folded = new Set<string>()
  for (const p of posts) if (!open.has(p.id)) folded.add(p.id)
  return folded
}
