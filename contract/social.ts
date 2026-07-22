/** ── Contract: the social layer's foundations (S0 — docs/design/social-layer.md) ──
 *  Three orthogonal primitives — Grant, Discussion, Proposal — each defined
 *  against a GENERIC entity reference, never a specific kind. This file is the
 *  substrate they all share: the ref, the anchor (a typed position inside an
 *  entity), the audience, and the strictly-ordered share tier. Kind-specific
 *  behavior lives in per-kind adapters (anchor resolvers, delta appliers,
 *  resource previews) registered elsewhere; nothing here may branch on a kind.
 *  Imported verbatim by UI + server — framework- and Node-free. */

/** The social nouns: the five of `contract/relations.ts` plus Discussion and
 *  Proposal (both entities themselves, so every primitive applies recursively —
 *  a proposal's review thread IS a discussion anchored to the proposal). */
export const SOCIAL_ENTITY_KINDS = [
  'session',
  'project',
  'artifact',
  'context',
  'schedule',
  'discussion',
  'proposal',
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

/** The runtime guard for `AnchorLocus`, next to the union it guards so the two
 *  can't drift. An anchor is PERSISTED and echoed to everyone who can read its
 *  subject, so the server refuses anything that isn't a declared variant with
 *  exactly its declared fields (INV-9, strict core) rather than storing whatever
 *  arrived. Shared, not server-only: any door that mints an anchor can check
 *  first. */
export function isAnchorLocus(v: unknown): v is AnchorLocus {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const shape = (fields: Record<string, 'string' | 'number'>) => {
    const keys = Object.keys(o)
    if (keys.length !== Object.keys(fields).length + 1) return false
    return Object.entries(fields).every(([k, t]) => typeof o[k] === t)
  }
  switch (o.kind) {
    case 'artifact-range':
      return shape({ from: 'number', to: 'number' })
    case 'session-turn':
      return shape({ messageId: 'string' })
    case 'schedule-run':
      return shape({ runId: 'string' })
    case 'relation-edge':
      return shape({ relationId: 'string' })
    default:
      return false
  }
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

/** `GET /v1/social/capability?kind=&id=` — what the CALLER may do on one
 *  subject, computed at serve time by the very predicates the write paths use.
 *
 *  Exists so an affordance can't outlive its wall: the UI's rule is that
 *  capability shapes affordances (src/CLAUDE.md — a shared entity has ONE page;
 *  what differs is which controls exist), and without this the comment gutters
 *  and the offer form render for every reader, including the `view`-tier
 *  audience whose every post the server then refuses. Deliberately BOOLEANS
 *  rather than the raw tier: ownership and the legacy everyone-switch grant
 *  these too without being tiers, so a tier alone would be a second, weaker
 *  model of the same question. */
export interface SocialCapability {
  /** May open threads and post on this subject (the `comment` tier and above). */
  canComment: boolean
  /** May offer changes against it (the `propose` tier and above). */
  canPropose: boolean
}

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

/** ── Discussion (S2) — the sixth noun ────────────────────────────────────────
 *  Talk anchored to a resource. A discussion with a locus-free anchor is the
 *  subject's ROOT thread (its public comment stream — the Commons card's
 *  comments and the entity page's thread are two projections of this one
 *  object). Discussions are entities themselves, so every primitive applies
 *  recursively — including attaching one to a session as context. Visibility
 *  INHERITS the anchor's (owner / granted / shared ⇒ readable), never wider. */
export interface DiscussionPost {
  id: string
  /** Display name of the posting namespace (REDACTED face — raw ids never cross). */
  author: string
  body: string
  at: number
  /** The one thin reaction signal: how many namespaces endorsed this post, and
   *  whether the CALLER did (viewer-relative, computed at serve time). */
  reactions: number
  reacted?: boolean
  /** Viewer-relative: the caller wrote it (their own words, retractable). */
  mine?: boolean
  /** Viewer-relative: may the caller delete it? The AUTHOR retracts their own
   *  words; the ANCHOR OWNER moderates their surface (S5 guardrails) — two
   *  parties again, so `mine` can't answer it. Computed by the same predicate
   *  `deleteDiscussionPost` enforces. */
  canDelete?: boolean
}

export interface Discussion {
  id: string
  anchor: SocialAnchor
  state: 'open' | 'resolved'
  /** Display name of the opening namespace (REDACTED face). */
  openedBy: string
  openedAt: number
  posts: DiscussionPost[]
  /** Viewer-relative: the caller opened it (the projects `own` pattern). */
  mine?: boolean
  /** Viewer-relative: may the caller resolve / reopen this thread? Standing is
   *  the OPENER *or* the anchor's OWNER — two parties, so `mine` alone can't
   *  answer it, and a surface that gated on `mine` silently denied the owner a
   *  control they hold (`/discussions/:did` did exactly that). Computed by the
   *  same predicate the write path uses, so the affordance can't drift from the
   *  wall. */
  canResolve?: boolean
}

/** `POST /v1/discussions` — open a discussion on an anchor. INV-9: an absent
 *  `locus` anchors the whole entity; `firstPost` is required (an empty
 *  discussion is noise — the opening post IS the reason it exists). */
export interface OpenDiscussionRequest {
  anchor: SocialAnchor
  firstPost: string
}

/** `POST /v1/discussions/:id/posts` — append to the thread. */
export interface PostToDiscussionRequest {
  body: string
}

/** ── Proposal (S3) — a typed change OFFERED to a resource ────────────────────
 *  The landing-ledger generalized to any noun: a proposal carries a delta, a
 *  review discussion (a normal Discussion anchored to the proposal — recursion,
 *  not a second thread machinery), and lands by the subject OWNER's consent
 *  into a per-subject linear ledger (L1, L2, … — no merge DAG). Its read wall
 *  IS its subject's wall (a proposal is never wider than what it changes).
 *  Named `SocialProposal` on the wire — `AgentChangeProposal` (D25) already
 *  owns the bare name in this contract. */
export type ProposalDelta =
  /** A prose change offered — no machine applier; landing records acceptance
   *  (the reviewable-suggestion floor every kind supports). */
  | { kind: 'suggestion'; text: string }
  /** A relationship-graph edit — landing APPLIES the op (the real applier;
   *  same reducer both sides of the wire, `contract/graph.ts`). */
  | { kind: 'relation-op'; op: import('./relations.ts').RelationOp }

export interface SocialProposal {
  id: string
  subject: SocialEntityRef
  delta: ProposalDelta
  state: 'offered' | 'landed' | 'declined'
  /** Display name of the offering namespace (REDACTED face). */
  offeredBy: string
  offeredAt: number
  /** The per-subject ledger position, assigned at land time (monotonic). */
  landingNumber?: number
  /** The review thread — a Discussion anchored to THIS proposal. */
  discussionId: string
  /** Viewer-relative: the caller offered it (the projects `own` pattern). */
  mine?: boolean
}

/** `POST /v1/proposals` — offer a change. `rationale` is required (it opens the
 *  review thread — an unargued change is noise); INV-9: there is no absent
 *  form. */
export interface OpenProposalRequest {
  subject: SocialEntityRef
  delta: ProposalDelta
  rationale: string
}

/** ── The Commons feed (S4) — a PROJECTION, not an entity ─────────────────────
 *  A feed post = a share act (a grant carrying a note — the publish text) or a
 *  ledger landing, plus the subject's embed and its ROOT discussion. Nothing
 *  here is stored as a "post": the feed derives from the primitives, so the
 *  card's comments ARE the entity page's thread (one conversation, two
 *  projections). Org-commons first; truly-public is the deferred S6. */
export interface CommonsItem {
  /** Derived identity — `share:<grantId>` or `landing:<proposalId>`. */
  id: string
  kind: 'share' | 'landing'
  at: number
  /** Display name of the acting namespace (REDACTED face). */
  actor: string
  /** The publish text (share items — the grant's note). */
  note?: string
  /** The landed ledger position (landing items). */
  landingNumber?: number
  subject: SocialEntityRef
  /** The embed, resolved per kind at serve time (never stored): the subject's
   *  display name + one descriptive line. */
  subjectName: string
  subjectBlurb?: string
  /** ARTIFACT subjects only: the artifact's kind (doc / image / sheet / slide /
   *  email), so the card wears the same kind cue the Artifacts gallery uses. */
  subjectArtifactKind?: import('./entities.ts').ArtifactKind
  /** SESSION subjects only: the last exchanges, so a shared conversation
   *  previews AS conversation inside the card (the ResourcePreview adapter's
   *  richest face; text is trimmed server-side). */
  subjectTurns?: { role: 'user' | 'assistant'; text: string }[]
  /** The subject's root discussion, when one exists — the card's comments. */
  discussionId?: string
  /** Posts on that root thread (the card's count; the thread is the door). */
  commentCount: number
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
