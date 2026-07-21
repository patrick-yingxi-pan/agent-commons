/** ── Contract: the social layer's foundations (S0 — docs/design/social-layer.md) ──
 *  Three orthogonal primitives — Grant, Discussion, Proposal — each defined
 *  against a GENERIC entity reference, never a specific kind. This file is the
 *  substrate they all share: the ref, the anchor (a typed position inside an
 *  entity), the audience, and the strictly-ordered share tier. Kind-specific
 *  behavior lives in per-kind adapters (anchor resolvers, delta appliers,
 *  resource previews) registered elsewhere; nothing here may branch on a kind.
 *  Imported verbatim by UI + server — framework- and Node-free. */

/** The six social nouns: the five of `contract/relations.ts` plus Discussion
 *  (itself an entity, so every primitive applies recursively — including
 *  attaching a discussion to a session as context). */
export const SOCIAL_ENTITY_KINDS = [
  'session',
  'project',
  'artifact',
  'context',
  'schedule',
  'discussion',
] as const
export type SocialEntityKind = (typeof SOCIAL_ENTITY_KINDS)[number]

/** One canonical reference to any social noun — the sole argument shape the
 *  three primitives accept. */
export interface SocialEntityRef {
  kind: SocialEntityKind
  id: string
}

/** A typed position INSIDE an entity. Absent locus = the whole entity — the
 *  "root" anchor a resource's public comment thread hangs on. Each variant is
 *  resolved to a scroll/highlight by that kind's anchor resolver in the UI. */
export type AnchorLocus =
  | { kind: 'artifact-range'; from: number; to: number }
  | { kind: 'session-turn'; messageId: string }
  | { kind: 'schedule-run'; runId: string }
  | { kind: 'relation-edge'; relationId: string }

/** Where a discussion or proposal attaches: an entity, optionally a locus. */
export interface SocialAnchor {
  ref: SocialEntityRef
  locus?: AnchorLocus
}

/** Who a grant addresses. `link` (anyone with the token) is declared now but
 *  refused by the server until the public phase (S6) — the enum grows, the
 *  card surfaces don't change. */
export type Audience =
  | { kind: 'principal'; principalId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'link'; token: string }

/** The strictly-ordered share tier — view ⊂ comment ⊂ propose ⊂ co-own. A
 *  higher tier includes every lower tier's capability; every social read/write
 *  checks exactly one predicate (`tierPermits`). */
export const SHARE_TIERS = ['view', 'comment', 'propose', 'co-own'] as const
export type ShareTier = (typeof SHARE_TIERS)[number]

/** ── Grant (S1) — the share act ──────────────────────────────────────────────
 *  Who can see/do what on a resource. The wire face is REDACTED like every
 *  cross-tenant row: `grantedBy` is a display name; raw foreign tenant ids
 *  never cross. */
export interface Grant {
  id: string
  subject: SocialEntityRef
  audience: Audience
  tier: ShareTier
  /** The publish text — the feed post's body. INV-9: ABSENT means share
   *  silently (access only, no Commons card); present means publish. The
   *  distinction between *giving access* and *publishing* is exactly this
   *  field. */
  note?: string
  /** Display name of the granting namespace (REDACTED face). */
  grantedBy: string
  grantedAt: number
}

/** `POST /v1/grants` — propose a grant (the consent-carded share act). */
export interface CreateGrantRequest {
  subject: SocialEntityRef
  audience: Audience
  tier: ShareTier
  /** See `Grant.note` (INV-9: absent = silent share). */
  note?: string
}

/** The tier lattice as a rank — view 0 < comment 1 < propose 2 < co-own 3. */
export function tierRank(tier: ShareTier): number {
  return SHARE_TIERS.indexOf(tier)
}

/** Does `held` cover what `needed` requires? Pure + shared (like `rolePermits`):
 *  the client pre-checks, the server enforces authoritatively. Monotonic by
 *  construction — a higher tier can never lose a lower tier's capability. */
export function tierPermits(held: ShareTier, needed: ShareTier): boolean {
  return tierRank(held) >= tierRank(needed)
}
