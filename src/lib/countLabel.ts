/** ── "3 sessions" ────────────────────────────────────────────────────────────
 *  A count and the thing it counts, pluralised. One home, because it is now on
 *  every folded section header on every entity page — the summary a section
 *  folds to (owner directive 2026-08-13: every section owes one, and it sits on
 *  the title's row). Twelve inline `${n} thing${n === 1 ? '' : 's'}` ternaries
 *  is not twelve decisions, it is one decision typed twelve times, and the
 *  eleventh is where someone writes `${n} entrys`.
 *
 *  Irregular plurals are the SECOND argument rather than a rule, because there
 *  is no rule: "entry → entries" and "reply → replies" happen to share a shape
 *  that "policy → policies" also has and "day → days" does not, and a helper
 *  that guessed would be wrong silently.
 *
 *  A plain function (no JSX, no imports) so the DOM-less runner can hold it —
 *  src/lib/count-label.test.ts. */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The same, with the zero case spelled in WORDS rather than as "0 things".
 *
 *  A folded section's summary is an index entry, and "0 sessions" is a worse
 *  index entry than "No sessions" for the same reason "Nothing posted" beats
 *  "0 items": the empty state is a different fact about the section, not the
 *  smallest value of the same one. Callers that want a richer empty line (the
 *  roster, the destination, the cadence) pass their own instead.
 *
 *  The empty line comes LAST, and the plural is required rather than defaulted,
 *  so the signature is a prefix of `countLabel`’s rather than diverging in the
 *  middle. With the empty case second, every argument was a string and
 *  `countOr(n, 'item', 'Nothing posted')` type-checked into "3 Nothing posteds". */
export function countOr(n: number, one: string, many: string, empty: string): string {
  return n === 0 ? empty : countLabel(n, one, many)
}
