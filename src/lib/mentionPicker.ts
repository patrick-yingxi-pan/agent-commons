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
 *  `mentions.ts` / `railPanes.ts` pattern: the query extraction and the ranking
 *  are exactly the parts that go wrong silently and are invisible in a
 *  screenshot.
 *
 *  The roster is the THREAD's own voices — never a directory, and never a new
 *  wire face. Every name it offers is already rendered on the surface as a
 *  byline or a lit mention, so the picker tells the reader nothing they are not
 *  already looking at. (The S1 rule this respects: a shared resource never shows
 *  its visitors to each other, so the grant AUDIENCE may not become a roster.)
 *  Nothing here restricts what may be mentioned — the server still resolves
 *  whatever is typed, against every name that exists. */
import type { Discussion } from '../../contract/index.ts'

/** Longest display name the picker will try to complete. Bounds the query scan;
 *  matches the server's own mentionable-name bound. */
const MAX_NAME_LEN = 80

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
  if (query.length > MAX_NAME_LEN || /[\n\r]/.test(query)) return null
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

/** Replace the `@query` at the caret with the full name, leaving one trailing
 *  space and reporting where the caret belongs — after the inserted name, since
 *  a mention is usually written mid-sentence. Pure so the insertion arithmetic
 *  (the part an off-by-one silently corrupts) is testable without a DOM. */
export function applyMention(text: string, at: number, caret: number, name: string): { text: string; caret: number } {
  return { text: `${text.slice(0, at)}@${name} ${text.slice(caret)}`, caret: at + name.length + 2 }
}
