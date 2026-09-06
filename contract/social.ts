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
 *  a proposal's review thread IS a discussion anchored to the proposal), plus
 *  `principal` — a PERSON (S7).
 *
 *  ── Why a person is a social noun (S7) ──────────────────────────────────────
 *  Everything above is a RESOURCE. The layer had no way to address a human, so
 *  two people who could see each other had no channel between them. Rather than
 *  mint a fourth primitive (a Message entity with its own posts, moderation and
 *  bells), `principal` joins the nouns and the EXISTING Discussion primitive
 *  means "talk directed at a person" when its anchor is one. A DM therefore
 *  inherits posts, reactions, retract/report/mute, the timeline page and the
 *  hand-it-to-Claude hook by construction, not by copy.
 *
 *  A principal's `id` is its public DISPLAY NAME — the same handle `/u/:name`,
 *  `Grant.grantedBy`, `CommonsItem.actor` and the S5 mutes already use. Raw
 *  tenant ids still never cross the wire (the REDACTED rule).
 *
 *  The orthogonality test demands every cell be answered, so the three that are
 *  NOT the DM are explicit refusals rather than unhandled cases:
 *
 *    Grant × principal      REFUSED — you cannot share a person; access to a
 *                           human is not a thing a tier can express (the
 *                           `context` `'unsupported'` precedent).
 *    Proposal × principal   REFUSED — a proposal is a typed change landed by
 *                           the subject owner's consent, and a person is not
 *                           a resource whose fields anyone may edit.
 *    Grant × a principal-   REFUSED — a DM's wall is the pair, by
 *      anchored Discussion  construction; a grant would leak it. This is the
 *                           one place the recursion rule is cut, and it is cut
 *                           here rather than left to each read path.
 *    Discussion × principal TWO meanings, decided by WHOSE name the anchor
 *                           carries (S8). Anchor SOMEONE ELSE and the thread is
 *                           a direct message, walled to the pair. Anchor
 *                           YOURSELF and it is a POST on your own wall, walled
 *                           to the square. S7 refused a self-anchor outright
 *                           ("there is no existence to hide from yourself");
 *                           S8 gives that refusal a meaning rather than minting
 *                           a fourth primitive. See `Discussion.direct` /
 *                           `Discussion.wall`.
 *
 *  The symmetry is the whole design, and it is worth stating plainly:
 *
 *    anchored to a RESOURCE  → a comment thread, walled by the resource
 *    anchored to ANOTHER     → a direct message, walled by the pair
 *    anchored to YOURSELF    → a post, walled by the square
 *
 *  So "a tweet" and "a wall post" are objects this layer already had; what was
 *  missing was only the third row. Posts, replies, reactions, retract/report,
 *  mute, the `/discussions/:did` permalink and the hand-it-to-Claude hook all
 *  come along by construction. */
export const SOCIAL_ENTITY_KINDS = [
  'session',
  'project',
  'artifact',
  'context',
  'schedule',
  'discussion',
  'proposal',
  'principal',
] as const
export type SocialEntityKind = (typeof SOCIAL_ENTITY_KINDS)[number]

/** One canonical reference to any social noun — the sole argument shape the
 *  three primitives accept. For `principal`, `id` is the public display name. */
export interface SocialEntityRef {
  kind: SocialEntityKind
  id: string
}

/** A typed position INSIDE an entity. Absent locus = the whole entity — the
 *  "root" anchor a resource's public comment thread hangs on. Each variant is
 *  resolved to a scroll/highlight by that kind's anchor resolver in the UI. */
export type AnchorLocus =
  /** ── One BLOCK of an artifact body (S2, replacing S0's `artifact-range`) ────
   *  Declared at S0 as a `{from,to}` LINE span, this was the one locus no
   *  surface could ever mint: these bodies are STRUCTURED, not linear (a doc has
   *  blocks, a sheet rows, a deck slides), so a line span's own label — "lines
   *  4–9" — would have been a lie about a body that has no lines. The S2 gutter
   *  stayed blocked on that for as long as the variant kept its shape.
   *
   *  S3 settled the question from the other side: `artifact-patch` had to
   *  address a body EDIT, and took the address the body actually has
   *  (`block`, `contract/content.ts`). So the locus now speaks that same
   *  address rather than inventing a second vocabulary for "which piece of an
   *  artifact" — one index, meaning the same block to a patch, to a thread and
   *  to the reader looking at it.
   *
   *  Scoped like the patch to a `doc` body's ordered blocks. Sheets, decks and
   *  figures have no addressed interior yet; when one grows an address, the
   *  patch and this locus should grow it together, for the same reason they
   *  share one now. */
  | { kind: 'artifact-block'; block: number }
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
    case 'artifact-block':
      return shape({ block: 'number' })
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

/** One canonical boundary for the optional publish note. Whitespace-only input
 *  means the same thing as absence: a silent access grant, not an empty feed
 *  post. UI and store both use this function so re-granting without prose also
 *  removes any older published note. */
export const MAX_GRANT_NOTE_CHARS = 2000
export function canonicalGrantNote(note: unknown): string | undefined {
  if (typeof note !== 'string') return undefined
  const trimmed = note.trim()
  return trimmed ? trimmed.slice(0, MAX_GRANT_NOTE_CHARS) : undefined
}

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
  /** Viewer-relative durable report receipt. Once present, retrying or
   *  revisiting cannot create another moderation bell for the same post. */
  reported?: boolean
  /** Viewer-relative: the caller wrote it (their own words, retractable). */
  mine?: boolean
  /** Viewer-relative: may the caller delete it? The AUTHOR retracts their own
   *  words; the ANCHOR OWNER moderates their surface (S5 guardrails) — two
   *  parties again, so `mine` can't answer it. Computed by the same predicate
   *  `deleteDiscussionPost` enforces. */
  canDelete?: boolean
  /** The display names this post @-mentions, RESOLVED by the server against the
   *  names that actually exist (S8) — never a client-side parse. Two reasons it
   *  has to be the server's answer: a display name may contain spaces and
   *  punctuation ("Acme, Inc."), so "where does the mention end" is a question
   *  only the name set can answer; and the same resolution decides who gets
   *  rung, so a second parse on the client could linkify a name that was never
   *  notified. Absent = no mention resolved (INV-9). */
  mentions?: string[]
  /** ── S9: the post this one answers ─────────────────────────────────────────
   *  The id of another post in the SAME thread. INV-9: absent = a top-level
   *  post, which is what every post was before this field existed — so a stored
   *  row that predates it reads correctly as the root-level remark it was.
   *
   *  ANY depth (owner directive 2026-08-11): the parent is whatever post was
   *  named, so a chain records who answered whom rather than an approximation
   *  of it. This field carried a one-level cap until the renderer could draw a
   *  chain — replying to a reply re-parented to that reply's own parent — and
   *  the cap is worth remembering as a shape: it was correct while the surface
   *  had one indent to spend, and became a FALSEHOOD the moment the surface
   *  could show the truth. A post answering Ada was stored as answering Grace;
   *  it then nested under the wrong remark and rang the wrong person's bell.
   *
   *  Depth is therefore not bounded on the wire. It is bounded where it is
   *  actually a problem — on the screen, by the reader, who collapses a branch
   *  and whose indent stops growing past the point a narrow pane can hold
   *  (`src/lib/replyTree.ts`). A cap that discards authorship to protect a
   *  layout is the wrong side of that trade.
   *
   *  Why answer a post rather than the thread: a thread with more than a couple
   *  of voices stops being followable when every remark is a sibling — "which of
   *  these is she answering" is exactly the question a flat list cannot answer.
   *
   *  No cycle is constructible: a parent must already exist when the reply is
   *  written, and the new post's id is one nothing can name yet. */
  replyTo?: string
}

/** Longest display name (chars) that is resolvable as a mention target — the
 *  bound BOTH ends of the mention feature answer to, so it lives on the wire
 *  contract rather than in either of them.
 *
 *  The server uses it to bound its per-`@` candidate scan (parsing stays
 *  O(bodyLen), independent of registry size and of its first-char
 *  distribution); the composer's picker uses it to bound the query it will try
 *  to complete. Those are two uses of ONE fact — a name longer than this is not
 *  mentionable — and a picker that kept offering past a length the resolver
 *  would refuse is a dead affordance. It was briefly a `const 80` on each side
 *  joined by a comment claiming they matched, which is the same prose-coupling
 *  the mention MATCHER itself was consolidated to remove. */
export const MENTION_MAX_NAME_LEN = 80

/** A thread's display title: its opening post, trimmed to a word boundary with
 *  an ellipsis. Shared because three surfaces show it — the thread page, the
 *  Commons embed, and the rail list — and a bare `slice(0, 80)` cut mid-word
 *  ("…should the prompt land before th"), which reads as broken rather than
 *  abbreviated (the /ui-review judgment pass, 2026-07-22). The rail list was
 *  named here but never actually converted — it kept its own `slice(0, 100)`
 *  until a seeded thread made it visible (2026-07-23), so adoption is now
 *  ENUMERATED rather than asserted in prose: `src/lib/social-ui.test.ts` fails on
 *  any surface that derives a title from a post body without this funnel. */
export function discussionTitle(firstPost: string | undefined, max = 80): string {
  const body = (firstPost ?? '').trim()
  if (!body) return 'Discussion'
  if (body.length <= max) return body
  const cut = body.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export interface Discussion {
  id: string
  anchor: SocialAnchor
  state: 'open' | 'resolved'
  /** Monotonic revision of the lifecycle state alone. Legacy rows begin at 0;
   *  posts and reactions do not create false resolve/reopen conflicts. */
  stateRevision: number
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
  /** Viewer-relative: may the caller POST in this thread? Computed by the very
   *  predicate `postToDiscussion` enforces (`discussionWritableBy`).
   *
   *  It exists because `GET /social/capability` asks the wrong question for a
   *  DM: on a principal subject that endpoint answers REACHABILITY — "could you
   *  cold-open to this person" — which is asymmetric and false for the
   *  recipient, who may certainly reply. The UI briefly worked around it with
   *  `isDm || canComment`, which is the SOCIAL-4b defect inverted: the control
   *  and the wall become two decisions again. A thread's own write standing
   *  belongs on the thread. */
  canPost?: boolean
  /** ── The DM face (S7) — set only on a PRINCIPAL-anchored thread ────────────
   *  A direct message is not a variant type: it is this same Discussion with an
   *  anchor that happens to be a person. These two fields are what a surface
   *  needs to render it AS a message rather than as a comment thread. INV-9:
   *  absent = an ordinary resource-anchored discussion. */
  direct?: boolean
  /** Viewer-relative: the OTHER party's display name. A DM's stream identity is
   *  the unordered PAIR {opener, anchored principal}, so "who is this thread
   *  with" depends on which end is reading — the anchor's name is the right
   *  answer for the opener and the wrong one for the recipient (who would see
   *  their own name). Computed at serve time, like `mine`. */
  counterpart?: string
  /** Viewer-relative: posts the caller has not seen (a DM inbox's unread dot).
   *  Derived from the caller's own read mark, never stored on the thread. */
  unread?: number
  /** ── The POST face (S8) — set only on a SELF-anchored principal thread ─────
   *  The author anchored to their own name, so this is a post on their wall
   *  rather than a message to someone: readable by the whole square, and its
   *  opening `DiscussionPost` is the post body while the rest are replies.
   *  INV-9: absent = not a post (a resource thread, or a DM). `direct` and
   *  `wall` are mutually exclusive by construction — the anchor cannot be both
   *  somebody else and you. */
  wall?: boolean
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
  /** Answer one post rather than the thread (S9). INV-9: absent = a top-level
   *  post. An id that names no post in THIS thread is REFUSED rather than
   *  quietly dropped to top-level — a reply that silently detaches from what it
   *  answers is worse than one that fails, because the author cannot see that it
   *  happened (the `throughPostId` precedent). */
  replyTo?: string
}

/** Explicit desired reaction state. Omission retains the legacy toggle for
 * non-first-party callers; the UI always sends the boolean so replay cannot
 * invert intent. */
export interface SetDiscussionReactionRequest {
  reacted?: boolean
}

export interface ReportDiscussionPostResponse {
  ok: true
  discussion: Discussion
}

/** Resolve/reopen one reviewed lifecycle revision. `state` omission retains
 * the original resolve default; the first-party UI supplies both fields. */
export interface SetDiscussionStateRequest {
  state?: 'open' | 'resolved'
  expectedStateRevision?: number
}

/** One discussion cannot grow beyond this many persisted posts. The reviewed
 * deletion set uses the same bound: it can name at most the complete thread. */
export const MAX_DISCUSSION_POSTS = 200

/** `DELETE /v1/discussions/:did/posts/:pid` — remove exactly the words the
 * caller reviewed. INV-9: omission preserves the legacy unconditional delete;
 * first-party UI always supplies the complete set (target plus descendants for
 * a cascade), so a concurrently arrived reply conflicts instead of being swept
 * into consent that never covered it. */
export interface DeleteDiscussionPostRequest {
  expectedPostIds?: string[]
}

export interface DeleteDiscussionPostResponse {
  ok: true
  /** Null means the last post was removed and the discussion dissolved. */
  discussion: Discussion | null
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
  /** A routine's own fields — landing runs the REAL `updateSchedule` mutator,
   *  the same one the owner's editor calls. Only valid on a `schedule` subject;
   *  the offer is refused otherwise (INV-9: a delta that can't apply to its
   *  subject is a malformed request, never a silently-inert record). */
  | { kind: 'schedule-patch'; patch: import('./api.ts').SchedulePatch }
  /** An artifact's BODY — landing rewrites ONE addressed prose block through
   *  `updateArtifactBlock`, the REAL mutator the owner's own editor calls. Only
   *  valid on an `artifact` subject whose body is a doc and whose block at
   *  `block` is patchable (`docBlockText`); anything else is refused at the
   *  door like every applying kind, never stored as an inert record (INV-9).
   *  The address is a BLOCK INDEX because these bodies are structured, not
   *  linear — the reasoning lives with `docBlockText` in `contract/content.ts`.
   *  The delta carries only the AFTER text: the server freezes the before-side
   *  at offer time onto `SocialProposal.deltaBase`, so the diff an owner reviews
   *  cannot move underneath that consent while the artifact changes elsewhere.
   *  `text` is clamped to `MAX_PROPOSAL_CHARS` like every other free-text field
   *  the layer stores — landing writes it into a body every reader fetches. */
  | { kind: 'artifact-patch'; block: number; text: string }

/** The routine fields a proposal may offer to change — the SCALAR, reviewable
 *  ones a human reads on a card and an owner consents to at a glance. Shared so
 *  the offer FORM and the server's validator enumerate the same set; the
 *  structural fields (`steps`, `delivery`) stay the owner's own editing surface,
 *  since a wholesale workflow rewrite isn't reviewable as a one-line diff. */
// `trigger` and `next` are cadence projections, not independently reviewable
// fields; landing a cadence proposal derives both server-side.
export const PROPOSABLE_SCHEDULE_FIELDS = ['enabled', 'name', 'prompt', 'cadence', 'timezone', 'notifyOnFailure'] as const
export type ProposableScheduleField = (typeof PROPOSABLE_SCHEDULE_FIELDS)[number]

/** The human face of a `schedule-patch` — one sentence naming every field it
 *  would change and to what. Lives in the contract beside `describeOp` (the
 *  relation-op equivalent) so a card, a consent prompt and a server-side
 *  notification all read the same words. Consent has to be to something
 *  SPECIFIC: "a routine change" is not something an owner can agree to. */
export function describeSchedulePatch(patch: import('./api.ts').SchedulePatch): string {
  const say = (k: string, v: unknown): string => {
    if (k === 'enabled') return v === true ? 'turn it on' : 'turn it off'
    if (k === 'notifyOnFailure') return v === true ? 'notify on failure' : 'stop notifying on failure'
    return `${k} → “${String(v)}”`
  }
  const parts = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => say(k, v))
  return parts.length > 0 ? parts.join(' · ') : 'no change'
}

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
  /** `artifact-patch` deltas only: the addressed block's text as it stood when
   *  the proposal was offered. The server freezes this reviewed pre-image
   *  and refuses landing after the artifact's body revision moves, so the diff
   *  cannot silently rebase into a different consent question. Older persisted
   *  proposals may omit it (INV-9: the card degrades to the after-text alone). */
  deltaBase?: string
  /** An applying proposal whose target changed after it was offered. Such a
   *  proposal remains reviewable and declineable, but cannot land: a new offer
   *  must be made against current state. Absent = not known stale, preserving
   *  compatibility with pre-guard persisted proposals and suggestion deltas. */
  stale?: boolean
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
  /** Derived identity — `share:<grantId>`, `landing:<proposalId>` or
   *  `post:<discussionId>` (S8). */
  id: string
  /** `post` is the S8 utterance: somebody said something, with no resource
   *  attached. Its subject is the AUTHOR's own principal, its `note` is the
   *  opening post's body, and its thread is the post itself — so replies,
   *  reactions and moderation are the ones the layer already had. */
  kind: 'share' | 'landing' | 'post'
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
   *  email), so the card wears the same kind cue the Artifacts index uses. */
  subjectArtifactKind?: import('./entities.ts').ArtifactKind
  /** SESSION subjects only: the last exchanges, so a shared conversation
   *  previews AS conversation inside the card (the ResourcePreview adapter's
   *  richest face; text is trimmed server-side). */
  subjectTurns?: { role: 'user' | 'assistant'; text: string }[]
  /** The subject's root discussion, when one exists — the card's comments. */
  discussionId?: string
  /** Posts on that root thread (the card's count; the thread is the door). */
  commentCount: number
  /** ── The viewer's own relationships to this item (the Commons lenses) ──────
   *  Four standing collections the rail offers as lenses on the feed — watched,
   *  liked, posted, recently viewed. They are the reader's relationship to the
   *  item, not a property of it, so they are computed at serve time (the `mine`
   *  pattern) and every one of them is viewer-relative. Absence is the negative
   *  in each case (INV-9): not mine, not liked, not watched, never opened. */
  /** The caller is the ACTOR — their share, their landing. */
  mine?: boolean
  /** How many namespaces liked this ACT (the count is public, like a post's
   *  reactions), and whether the caller is one of them. */
  likes: number
  liked?: boolean
  /** The caller watches this item's SUBJECT (so its acts reach their bell). */
  watched?: boolean
  /** The caller FOLLOWS this item's actor (S7) — the predicate behind the
   *  Commons' Following lens. Actor-relative, not subject-relative: the other
   *  lenses ask "what is my relationship to this thing", this one asks "what is
   *  my relationship to whoever did it", which is precisely what a social feed
   *  is for. */
  followed?: boolean
  /** When the caller last opened the subject's page — absent = never. Orders
   *  the "Recently viewed" lens, which is by definition an order, not a set. */
  viewedAt?: number
}

/** `POST /v1/commons/:itemId/like` — toggle the caller's like on one feed item.
 *  Explicit rather than a bare toggle: two clients pressing at once must
 *  converge on the state the user asked for, not on a parity race. */
export interface SetCommonsLikeRequest {
  liked: boolean
}

/** Exact public aggregate plus private viewer membership for one Commons item.
 * The aggregate may move when any visible reader acts; `liked` answers only
 * for the authenticated viewer and is therefore never inferred from count. */
export interface CommonsLikeState {
  likes: number
  liked: boolean
}

/** `POST /v1/social/watch` — watch (or unwatch) ANY subject. The
 *  project-scoped `/projects/:id/watch` (D24) is the same store under a
 *  `project` ref; this is the general door the Commons' Watched lens needs. */
export interface SetSocialWatchRequest {
  subject: SocialEntityRef
  watching: boolean
}

/** ── Follow (S7) — the name-keyed POSITIVE, mute's twin ──────────────────────
 *  `POST /v1/social/follow` — follow (or unfollow) a PRINCIPAL by its public
 *  display name. Explicit state rather than a bare toggle, for the reason
 *  `SetCommonsLikeRequest` states: two clients pressing at once must converge on
 *  what the user asked for, not on a parity race.
 *
 *  Deliberately NOT the `watch` store, though the two are cousins. Watch's key
 *  is a RESOURCE (`kind:id`) and its one consumer is the work-item bell
 *  audience; follow's subject is a PERSON and its consumer is the feed. Merging
 *  them would put two questions behind one key. The genuine sibling is the S5
 *  MUTE — also name-keyed, also per-viewer, also a standing relationship — and
 *  the two are exclusive: following a muted name CLEARS the mute, because you
 *  cannot ask to both see and not-see the same person, and the follow is the
 *  newer, more explicit statement.
 *
 *  Reachability, not a new wall: you may follow a name whose profile you can
 *  already read (the D21 publisher-existence rule). Everyone else — including a
 *  name that does not exist — gets the identical 404. */
export interface SetFollowRequest {
  /** The target's public display name. */
  name: string
  following: boolean
}

/** Answer of `GET /v1/me/follows` — the names the caller follows, sorted. The
 *  caller's own list, so tenancy IS the filter and there is no parameter. */
export type FollowList = string[]

/** `POST /v1/discussions/:id/read` — mark a thread read up to its newest post
 *  (S7). A private note to self like `RecordViewRequest`: it rings nobody and
 *  moves no wall; it exists so a DM inbox can show an honest unread count. */
export interface MarkDiscussionReadRequest {
  /** Mark read up to ONE post — its moment becomes the reader's mark. INV-9:
   *  absent is the complete-set constant, the whole thread. An id that is not in
   *  this thread is REFUSED rather than widened to everything, because marking
   *  more read than the caller asked is the one failure mode that hides
   *  messages. The mark never moves backward. */
  throughPostId?: string
}

/** `POST /v1/social/viewed` — record that the caller OPENED a subject's page.
 *  A private note to self: it rings nobody, widens nothing, and a subject the
 *  caller can't read is silently ignored rather than refused. */
export interface RecordViewRequest {
  subject: SocialEntityRef
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
