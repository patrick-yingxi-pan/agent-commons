/** ── @-mention segmentation (social S8) ──────────────────────────────────────
 *  Split a post body into plain runs and mention runs, given the names the
 *  SERVER resolved. Pure and dependency-free so `node --test` can hold it (the
 *  `railPanes.ts` / `proposalForm.ts` pattern) — the segmentation is the part
 *  that can silently go wrong, and it is invisible in a screenshot.
 *
 *  The names are an input, never derived here. A display name in this product
 *  carries spaces and punctuation ("Acme, Inc."), so "where does the mention
 *  end" is answerable only against the set of names that actually exist — and
 *  the server's answer is also the set it RANG, so re-deriving would risk
 *  highlighting a name that got no bell. */

/** One run of a body: plain text, or a mention (with the bare name attached). */
export interface MentionSegment {
  text: string
  mention?: string
}

export function mentionSegments(body: string, mentions: string[] | undefined): MentionSegment[] {
  if (!mentions || mentions.length === 0) return [{ text: body }]
  // Longest first: when one resolved name is a prefix of another ("Acme" and
  // "Acme, Inc."), the longer must win — the same tie-break the server's
  // resolver makes, so the highlight covers exactly what was matched.
  const names = [...mentions].filter((n) => n.length > 0).sort((a, b) => b.length - a.length)
  const out: MentionSegment[] = []
  let run = ''
  for (let i = 0; i < body.length; ) {
    if (body[i] === '@') {
      const rest = body.slice(i + 1)
      const hit = names.find((n) => rest.startsWith(n))
      if (hit) {
        if (run) out.push({ text: run })
        run = ''
        out.push({ text: `@${hit}`, mention: hit })
        i += 1 + hit.length
        continue
      }
    }
    run += body[i]
    i += 1
  }
  if (run) out.push({ text: run })
  return out
}
