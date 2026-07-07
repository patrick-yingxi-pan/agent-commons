/** ── Artifact descriptor guard (surface-audit S6) ───────────────────────────
 *  An artifact carries its own concrete descriptor (`meta` — "functional spec",
 *  "1600×900", "to: workspace admins"), shown in the humble side panel but replaced by
 *  the generic `KIND_LABEL` ("Document") on the canonical full viewer + gallery card —
 *  the canonical surface reading LESS specific than the lesser one. Revealing meta there
 *  fixes that drift, but gallery-created artifacts set `meta = KIND_LABEL`, so a
 *  canonical surface must show meta ONLY when it's genuinely more specific — else it
 *  reads "Document · Document". This one predicate is that guard, shared by both
 *  surfaces so it can't drift. Pure over strings (the caller resolves the kind label),
 *  so it's node-testable without a DOM. */
export function artifactMetaIsSpecific(meta: string | undefined, kindLabel: string): boolean {
  return !!meta && meta !== kindLabel
}
