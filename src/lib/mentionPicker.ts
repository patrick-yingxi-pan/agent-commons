/** ── The @-mention picker's logic (social S8) ────────────────────────────────
 *  Completing a name while it is being TYPED — the write-side twin of
 *  `src/lib/mentions.ts`, which lights the names the server already resolved on
 *  the read side.
 *
 *  Why a picker is not decoration here: a display name in this product carries
 *  spaces and punctuation ("Acme, Inc.", "Beta Platform"), and the server
 *  resolves a mention by LONGEST MATCH against names that actually exist. So a
 *  mention works only if the author reproduces the whole name exactly — which
 *  means "who can I mention" is knowledge the writer must already have, and the
 *  one thing a composer can do about that is offer it.
 *
 *  Pure and dependency-free (types are erased) so `node --test` can hold it, the
 *  `mentions.ts` / `railSplit.ts` pattern: the query extraction and the ranking
 *  are exactly the parts that go wrong silently and are invisible in a
 *  screenshot.
 *
 *  ── The roster rule (one rule, one supplier per surface) ────────────────────
 *  A roster offers only names the viewer is ALREADY looking at or has ALREADY
 *  declared: a thread's voices, a work item's participants, the people they
 *  follow. Never a directory and never a new wire face — COMMONS-22's floor is
 *  that the client gets no enumerable name list, or a mention becomes an
 *  identity oracle; and S1's is that a shared resource never shows its visitors
 *  to each other, so a grant AUDIENCE may not become a roster either. Each
 *  surface supplies its own list through one of the functions below, and none of
 *  them fetches anything.
 *
 *  A roster RESTRICTS nothing — the server still resolves whatever is typed,
 *  against every name that exists. It is a completion, not a permission. */
import type { CommonsItem, Discussion } from '../../contract/index.ts'
// The longest mentionable name is ONE fact, shared with the resolver that will
// have to match whatever this picker completes — never a second `80`.
import { MENTION_MAX_NAME_LEN } from '../../contract/index.ts'

/** How many suggestions to show. A completion list, not a directory. */
export const MAX_MENTION_SUGGESTIONS = 6

/** The `@query` being typed at the caret, if any: the text after the last `@`
 *  that STARTS a mention (one that follows a non-word char, so an email local
 *  part like `ada@acme` is not one).
 *
 *  Whitespace is deliberately NOT a terminator. Every name in this world has a
 *  space in it, so a query that stopped at the first one could never complete
 *  the names it exists for — "@Beta Pl" has to keep matching "Beta Platform".
 *  The query is bounded by length and by line instead. */
export function mentionQuery(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const prev = before[at - 1]
  if (prev !== undefined && /[\p{L}\p{N}_]/u.test(prev)) return null
  const query = before.slice(at + 1)
  if (query.length > MENTION_MAX_NAME_LEN || /[\n\r]/.test(query)) return null
  return { at, query }
}

/** The names in this conversation, most recently heard first — post authors,
 *  the opener, and anyone the thread has already named (a mention is rendered
 *  right there in the body, so offering it reveals nothing new).
 *
 *  The caller's OWN name is dropped, derived from the server's viewer-relative
 *  stamps (`post.mine` / `thread.mine`) rather than from a client-side identity
 *  join — `@`-ing yourself rings nobody, so offering it is a dead affordance.
 *  A caller who has neither opened the thread nor posted in it has no stamp to
 *  derive from; if such a thread has already named them, their own name may be
 *  offered once. Harmless (the fan-out always drops the actor) and not worth a
 *  round-trip to prevent. */
export function threadVoices(thread: Discussion | null): string[] {
  if (!thread) return []
  const me = thread.posts.find((p) => p.mine === true)?.author ?? (thread.mine === true ? thread.openedBy : undefined)
  const heard: string[] = []
  for (const p of [...thread.posts].reverse()) {
    heard.push(p.author, ...(p.mentions ?? []))
  }
  heard.push(thread.openedBy)
  return [...new Set(heard)].filter((n) => n.length > 0 && n !== me)
}

/** The SQUARE's roster (S8) — for a post, which has no thread to draw voices
 *  from: the composer is the first word, so `threadVoices` would be empty at
 *  exactly the moment the placeholder tells the writer to mention someone.
 *
 *  Two sources, both already the viewer's own: the people they FOLLOW (S7 — a
 *  standing relationship they declared and can read back on their profile), then
 *  the bylines in the feed they are looking at. Follows rank first because a
 *  stated relationship outranks a name that happens to be scrolling past.
 *
 *  The caller's own acts are dropped by the server's `mine` stamp, the same
 *  derivation `threadVoices` uses — `@`-ing yourself rings nobody. */
export function squareVoices(follows: readonly string[], feed: readonly CommonsItem[]): string[] {
  const heard = [...follows, ...feed.filter((i) => i.mine !== true).map((i) => i.actor)]
  return [...new Set(heard)].filter((n) => n.length > 0)
}

/** A WORK ITEM's roster (COMMONS-22) — the participants its own thread shows:
 *  commenters most-recently-heard first, then whoever closed it, then the
 *  poster. Every one of them is rendered as a byline right there.
 *
 *  `me` drops the caller, and here it is a display NAME rather than a
 *  server-stamped `mine` (a work-item comment carries no such stamp). Legitimate
 *  because this is a PREFERENCE, not authority — the repo's rule is that
 *  preference may key on a name while authority never may. The worst a rename or
 *  a name collision can do is offer one suggestion that rings nobody, which the
 *  fan-out drops anyway. */
export function workItemVoices(
  item: { postedBy: string; retractedBy?: string; comments?: readonly { author: string }[] } | null,
  me?: string,
): string[] {
  if (!item) return []
  const heard = [...(item.comments ?? [])].reverse().map((c) => c.author)
  if (item.retractedBy) heard.push(item.retractedBy)
  heard.push(item.postedBy)
  return [...new Set(heard)].filter((n) => n.length > 0 && n !== me)
}

/** The work-item composer's placeholder — ONE string for the two fields that
 *  post to that route, and it tells the truth about the wall.
 *
 *  COMMONS-22 fans a mention out only on a SHARED Project (on a private one the
 *  audience is the owner alone, so naming an outsider would leak the project's
 *  existence, and the mention therefore rings nobody). The hint promised the
 *  notification either way — copy asserting something the server would not do,
 *  the same defect class as S7's empty state that named a reason that wasn't the
 *  reason. Where the promise can't be kept, it isn't made. */
export function mentionHint(shared: boolean): string {
  return shared ? 'Add a comment… @mention to notify' : 'Add a comment…'
}

/** Roster names matching what has been typed: prefix matches first (what a
 *  completion is), then containment (so a surname finds its bearer), each in the
 *  roster's own recency order. An empty query offers the roster as-is — the
 *  moment right after `@`, when the writer is asking "who is here". */
export function suggestMentions(names: string[], query: string, max = MAX_MENTION_SUGGESTIONS): string[] {
  const q = query.toLowerCase()
  const starts = names.filter((n) => n.toLowerCase().startsWith(q))
  const contains = q.length > 0 ? names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)) : []
  return [...starts, ...contains].slice(0, max)
}

/** What a CARET MOVE does to an open picker: keep it (re-reading the query the
 *  caret now implies) or close it. Never open one — arming belongs to typing.
 *
 *  Pure and separate from the component because getting this wrong CORRUPTS
 *  drafts, silently: the first cut armed on caret placement, so clicking inside
 *  a mention finished minutes earlier re-offered it, and an open picker owns
 *  Enter — the next Enter, pressed for a newline, spliced the name in a second
 *  time ("thanks @Grace Hopper for the review" → "…@Grace Hopper Hopper for the
 *  review"). It also stole the arrow keys from caret navigation. */
export function narrowMention(
  open: { at: number; query: string } | null,
  text: string,
  caret: number,
): { at: number; query: string } | null {
  if (!open) return null
  const q = mentionQuery(text, caret)
  return q && q.at === open.at ? q : null
}

/** Replace the `@query` at the caret with the full name, leaving one trailing
 *  space and reporting where the caret belongs — after the inserted name, since
 *  a mention is usually written mid-sentence. Pure so the insertion arithmetic
 *  (the part an off-by-one silently corrupts) is testable without a DOM. */
export function applyMention(text: string, at: number, caret: number, name: string): { text: string; caret: number } {
  return { text: `${text.slice(0, at)}@${name} ${text.slice(caret)}`, caret: at + name.length + 2 }
}
