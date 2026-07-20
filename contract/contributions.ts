/** ── Contract: Contributions — the landing ledger (CW1/CW6 Phase A) ──────────
 *  The first slice of the agent-contribution workflow
 *  (docs/design/agent-contribution-workflow.md): a **Contribution** is the
 *  lifecycle entity that carries work from declared intent to landed change on a
 *  shared Project. Phase A ships the spine — the entity, its timeline, and the
 *  project's linear **landing ledger** (L1, L2, … — no merge DAG; parallelism is
 *  spent at intent time via the Guardian's sub-goal reservations, so history is
 *  a legible sequence). Later phases hang the effect envelope (CW1), the
 *  changeset (CW3/CW4), and review tiers (CW5) on this same entity.
 *
 *  Visibility mirrors the Project's exactly (owner or shared ⇒ readable, else
 *  the existence-hiding 404) and every wire face is REDACTED like the work
 *  item's: display names cross, raw foreign tenant ids never do. */
import type { PrincipalKind } from './identity.ts'
import type { ProjectEffectType } from './coordination.ts'

export type ContributionStatus = 'open' | 'landed'

/** ── The effect envelope (CW1, Phase C) — approval before action ─────────────
 *  A typed, bounded declaration of the external acts a contribution may fire:
 *  approved ONCE by a human (the PD50 standing-approval shape, generalized),
 *  then each concrete act passes a MECHANICAL match — line exists, cardinality
 *  remaining — never a fresh judgment. Versioned append-only: an amendment is a
 *  new version that must be re-approved (the approval names the version it
 *  covered), so "what exactly was authorized, by whom, and what ran under it"
 *  is one record — the envelope OBJECT holds the current version; a superseded
 *  version's lines and spend survive in the amendment's timeline event. */

/** The harness a line commits to run under (CW5's ladder) — structural
 *  containment that lowers the trust an approval needs. Phase C records and
 *  displays the harness; the behaviors (escrow holds, cooling timers) land
 *  with their stages in later phases. */
export type EnvelopeHarness = 'dry-run' | 'draft-escrow' | 'canary' | 'cooling-window' | 'hold-until-landing'
export const ENVELOPE_HARNESSES: EnvelopeHarness[] = ['dry-run', 'draft-escrow', 'canary', 'cooling-window', 'hold-until-landing']

/** One authorized act class: "≤ cardinality acts of `type` on `target`, under
 *  `harness`". `used` counts executed acts (the match ledger's public face). */
export interface EffectEnvelopeLine {
  id: string
  type: ProjectEffectType
  target: string
  cardinality: number
  harness: EnvelopeHarness
  /** Free-text scope note ("re: launch timeline"). `''` when none. */
  note: string
  used: number
}

export interface EffectEnvelope {
  /** Bumped on every proposal/amendment; approval stamps the version it saw. */
  version: number
  /** `proposed` = awaiting (re-)approval; `approved` = acts may match. */
  status: 'proposed' | 'approved'
  lines: EffectEnvelopeLine[]
  /** Display names + stamps (public identity, like every actor field). */
  proposedBy: string
  proposedAt: number
  approvedBy?: string
  approvedAt?: number
  /** The version the standing approval covers (= `version` while approved —
   *  an amendment resets status, so a stale approval can never cover it). */
  approvedVersion?: number
}

/** ── The changeset (CW3/CW4, Phase D) — crystallization without amnesia ─────
 *  When the work is ready, the trace crystallizes into a **ChangesetVersion**:
 *  typed change entries whose payload is a real before→after (rendered through
 *  the shared TextDiff primitive — a change is a diff, never prose). Versions
 *  are APPEND-ONLY (v1, v2, … — no force-push: a revision is a new version
 *  beside the old, and the review delta between them is first-class). In the
 *  prototype the entries are author-declared at crystallize time; deriving
 *  them from trace checkpoints is the declared model-seam (the build plan's
 *  CW2 machinery), so the shape is real and the derivation is mocked. */

/** What a change entry touches — the project's mergeable surface. */
export type ChangeEntryKind = 'instructions' | 'readme' | 'artifact' | 'file' | 'note'
export const CHANGE_ENTRY_KINDS: ChangeEntryKind[] = ['instructions', 'readme', 'artifact', 'file', 'note']

export interface ChangeEntry {
  id: string
  kind: ChangeEntryKind
  /** What it targets — a file path, an artifact name, or the surface's name. */
  target: string
  /** The before text. Absent = a create (the after renders alone). */
  before?: string
  /** The after text. `''` + a `before` reads as a removal. */
  after: string
}

export interface ChangesetVersion {
  /** 1-based, append-only — the position IS the version number. */
  version: number
  at: number
  /** Display name of the crystallizing principal (public identity). */
  by: string
  entries: ChangeEntry[]
}

/** Body of `POST .../contributions/:cid/changeset` — crystallize a version. */
export interface CrystallizeRequest {
  entries: { kind: ChangeEntryKind; target: string; before?: string; after: string }[]
}

/** Body of `POST .../contributions/:cid/envelope` — propose or amend. */
export interface ProposeEnvelopeRequest {
  lines: { type: ProjectEffectType; target: string; cardinality?: number; harness?: EnvelopeHarness; note?: string }[]
}

/** Body of `POST .../contributions/:cid/effects` — fire one act against a line. */
export interface RunEnvelopeEffectRequest {
  lineId: string
}

/** One event on a Contribution's timeline — the append-only record the page
 *  interleaves (the S14 work-item timeline's sibling). `opened` and `landed`
 *  are the lifecycle transitions; `note` is the flat discussion thread
 *  (the WorkItemComment shape, folded into the one event list because the
 *  timeline IS the surface — no detached comment array to drift from it). */
export interface ContributionEvent {
  id: string
  kind:
    | 'opened'
    | 'note'
    | 'landed'
    /* Phase C — the envelope's deliberation + match record (CW1): */
    | 'envelope-proposed'
    | 'envelope-approved'
    | 'effect-executed'
    | 'effect-refused'
    /* Phase D — a changeset version crystallized (CW3/CW4): */
    | 'crystallized'
  at: number
  /** The acting workspace's display name (public identity, like `postedBy`). */
  actor: string
  /** What KIND of principal acted (FWD-5) — absent = unattributed. */
  actorKind?: PrincipalKind
  /** `note`: the comment body. The envelope/effect kinds: a one-line record
   *  ("v2 · 2 acts", "connector.write → gmail · draft-escrow", the refusal
   *  reason). `opened` / `landed` carry no body — the contribution's own
   *  summary / landing number are their content. */
  body?: string
}

/** A Contribution — one unit of work moving through the lifecycle onto a
 *  Project. Phase A's payload is honest prose (`summary`); the structured
 *  changeset arrives in Phase D on this same entity, so nothing here is a
 *  throwaway shape. */
export interface Contribution {
  id: string
  projectId: string
  /** The landing number — the project-ledger position (L{n}), assigned ONLY at
   *  landing, monotonic per project. Absent while open: an open contribution
   *  has no place in history yet, and the absence says so (INV-9: absence has
   *  fixed meaning). */
  landingNumber?: number
  /** The one-line statement of the work — the ledger row's text. */
  title: string
  /** What the contribution changes, as prose (the Phase-A changeset stand-in;
   *  the opened timeline event's body). `''` when none was given. */
  summary: string
  /** The declared Intent's sub-goal label (CW1) — ties this contribution to
   *  the Guardian reservation that coordinated it. Absent = undeclared
   *  (allowed in Phase A; the In-flight strip shows both honestly). */
  subGoal?: string
  /** The driving session — the trace door (CW2): the conversation whose work
   *  this contribution crystallizes. Absent = opened outside a session. */
  sessionId?: string
  /** The contributing workspace's display name (public identity). */
  contributor: string
  contributorKind?: PrincipalKind
  /** Viewer-relative (computed at serve time, never stored): the CALLER's tenant
   *  opened this. Drives the client-side offer of contributor affordances (Land,
   *  the session door) — display names are not unique, so a name comparison
   *  would mis-offer; the server still enforces on raw tenant ids either way. */
  mine?: boolean
  /** The effect envelope (CW1, Phase C) — absent = the contribution declares
   *  no external acts (the common mergeable-only case; INV-9 fixed absence). */
  envelope?: EffectEnvelope
  /** The changeset (CW3/CW4, Phase D) — EVERY crystallized version, append-only
   *  oldest-first (no force-push: the whole revision history is the record).
   *  Absent = nothing crystallized yet (INV-9 fixed absence). */
  changeset?: ChangesetVersion[]
  status: ContributionStatus
  openedAt: number
  landedAt?: number
  /** Who landed it (display name) — the landing act's public record. */
  landedBy?: string
  /** The full timeline, time-ordered, append-only (CW4: no rewriting). */
  events: ContributionEvent[]
}

/** Body of `POST /v1/projects/:id/contributions` — open (declare) one. */
export interface OpenContributionRequest {
  title: string
  summary?: string
  subGoal?: string
  sessionId?: string
}

/** Body of `POST /v1/projects/:id/contributions/:cid/comments`. */
export interface PostContributionNoteRequest {
  body: string
}
