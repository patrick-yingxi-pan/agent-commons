# 12 · Social layer — share, discuss, improve

> **Intent.** Every resource can be **shared**, **discussed**, and **improved**
> with other users through three orthogonal primitives — Grant, Discussion,
> Proposal — each defined against a generic entity reference, never a specific
> kind, and composing with any of the six social nouns (the relation graph's
> five plus Discussion itself). The full design + phased backlog:
> [`docs/design/social-layer.md`](../design/social-layer.md). Privacy rules are
> inherited, not invented: existence-hiding walls, REDACTED wire faces, INV-9
> absence classification.

## Built — S0 substrate + S1 grants (L2)

| ID | Requirement | Implementation | Verified by | Status |
|----|-------------|----------------|-------------|--------|
| SOCIAL-1 | The kind-generic substrate: six social nouns (= relation entities + discussion), typed anchors, audiences, and a strictly-ordered share tier (`view ⊂ comment ⊂ propose ⊂ co-own`) with one permit predicate. The substrate never branches on an entity kind (orthogonality). | `contract/social.ts` | `tests/social.test.ts` | ✅ |
| SOCIAL-2 | Grants: owner-only creation over a generic subject ref (the one per-kind adapter lives in `server/store.ts`), one live grant per subject×audience (re-grant replaces), either-party revoke, persisted slice, two-party `grant.changed` SSE. The `note` field is the publish act (INV-9: absent = silent access-only share). | `server/store.ts`, `server/routes/index.ts`, `contract/social.ts`, `contract/events.ts`, `server/persistence/format.ts` | `tests/social.test.ts`, `tests/snapshot.test.ts` | ✅ |
| SOCIAL-3 | Existence-hiding on every grant face: an invisible subject 404s identically to a nonexistent one on GET **and** POST; a non-party probing a (sequential) grant id on DELETE gets the same 404 as a missing id. | `server/store.ts`, `server/routes/index.ts` | `tests/social.test.ts` | ✅ |
| SOCIAL-4 | A grant opens its subject: granted viewers pass the project wall and the session visibility funnel at any tier (read widens; ownership/writes stay strict). | `server/store.ts`, `server/routes/index.ts` | `tests/social.test.ts` | ✅ |

## Planned (the backlog lives in the design doc)

| ID | Requirement | Status |
|----|-------------|--------|
| SOCIAL-5 | S1 UI: the grants roster + share form (`GrantsPanel`, generic over the subject ref) in the project page's owner rail; `TierBadge` as the one tier cue (`src/lib/tierBadge.ts`); the shared-with-me band fed from grants (a granted project rides both list projections as the redacted visitor face, live on `grant.changed`, leaving on revoke). Verified in-app end-to-end (Ada shares → Grace's Shared-with-you lists it → click-through opens the canonical visitor page); funnel locks in `tests/social-ui.test.ts`, projections in `tests/social.test.ts`. Consent cards gate CLAUDE-proposed acts — a user's own SharePanel click IS the consent (the ShareToggle precedent); the conversational share *tool* is future model-tools work, not part of this row. | ✅ |
| SOCIAL-6 | S2 Discussion: the sixth noun — anchored threads, root-thread rule, narrowing visibility, discussion-as-context. | 📝 |
| SOCIAL-7 | S3 Proposal: the landing ledger generalized to any entity via delta appliers. | 📝 |
| SOCIAL-8 | S4 Commons: the feed as a projection (share act + note + root discussion); entity pages as the GitHub-like home. | 📝 |
