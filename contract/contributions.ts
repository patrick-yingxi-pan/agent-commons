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
import type { ContributionReviewerBinding, ContributionReviewRun } from './contributionReview.ts'
import type { DelegatedJudgmentRun } from './delegatedJudgment.ts'

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

/** Explicit-call binds a real inspected MCP call and requires separate Run
 * consent. The other labels are legacy development declarations only: escrow,
 * canary and cooling containment are not implemented execution authority. */
export type EnvelopeHarness = 'dry-run' | 'draft-escrow' | 'canary' | 'cooling-window' | 'hold-until-landing' | 'explicit-call'
export const ENVELOPE_HARNESSES: EnvelopeHarness[] = ['dry-run', 'draft-escrow', 'canary', 'cooling-window', 'hold-until-landing', 'explicit-call']
export const EFFECT_ENVELOPE_LINE_MAX = 10
export const EFFECT_ENVELOPE_CARDINALITY_MAX = 20
export const CONTRIBUTION_FIELD_MAX = 2000

/** Exact non-secret selection for one explicitly approved MCP act. The server
 * derives the schema hash from its revision-pinned private connection. */
export interface ContributionMcpSelection {
  connectionId: string
  connectionRevision: number
  toolName: string
  arguments: Record<string, import('./mcpExecution.ts').McpJsonValue>
}

/** Project-visible MCP preview. Connection identity and schema authority stay
 * private; the preview contains only a label and the exact reviewed arguments. */
export interface ContributionMcpPreview {
  connectionLabel: string
  toolName: string
  arguments: Record<string, import('./mcpExecution.ts').McpJsonValue>
  /** Derived local-process provenance. Absent remains the historical HTTP shape. */
  transport?: 'stdio'
  canRun?: true
}

/** One authorized act class: "≤ cardinality acts of `type` on `target`, under
 *  `harness`". Real MCP `used` includes pending and uncertain calls and returned
 *  tool errors; only a known pre-submission failure releases its reserved slot. */
export interface EffectEnvelopeLine {
  id: string
  type: ProjectEffectType
  target: string
  cardinality: number
  harness: EnvelopeHarness
  /** Free-text scope note ("re: launch timeline"). `''` when none. */
  note: string
  used: number
  /** Present only for a per-call explicitly approved MCP line. */
  mcp?: ContributionMcpPreview
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

/** ── The review tier (CW5, Phase E) — the gate as visible arithmetic ─────────
 *  Every contribution's landing gate is COMPUTED from three inputs the system
 *  already holds — risk (does the envelope carry irreversible effect lines),
 *  trust (the contributor's landed record on THIS project), and the owner's
 *  explicit tightening — and the result is served with its basis spelled out,
 *  so the gate is legible, never a black box. Owners can only TIGHTEN
 *  (`require-review` exists; no loosen op does — loosening is unrepresentable),
 *  and the floor is structural: an effectful contribution lands only by the
 *  owner's human act, no matter the record — trust never buys past the floor. */
export interface ContributionTier {
  /** 0 = trusted auto-land (no effects, proven record) · 1 = adversarial
   *  review before landing · 2 = the human floor (owner lands). */
  level: 0 | 1 | 2
  /** The plain-arithmetic explanation ("irreversible effects — owner lands"). */
  basis: string
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
export type ChangeEntryKind = 'instructions' | 'description' | 'artifact' | 'file' | 'note'
export const CHANGE_ENTRY_KINDS: ChangeEntryKind[] = ['instructions', 'description', 'artifact', 'file', 'note']

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
  lines: { type: ProjectEffectType; target: string; cardinality?: number; harness?: EnvelopeHarness; note?: string; mcp?: ContributionMcpSelection }[]
  /** Compare-and-swap boundary for first-party authoring: 0 means no envelope
   * exists yet and N means the visible current version is N. Required for MCP
   * selections; absence preserves only legacy/delegated proposal semantics. */
  expectedVersion?: number
}

/** Body of `POST .../contributions/:cid/envelope/approve`. Absence preserves
 * legacy/delegated best-effort approval; first-party UI pins the exact version
 * whose acts the person reviewed. */
export interface ApproveEnvelopeRequest {
  expectedVersion?: number
}

/** Body of `POST .../contributions/:cid/review`. Absence preserves the legacy
 * best-effort model seam; first-party UI pins the exact changeset it presents. */
export interface ReviewContributionRequest {
  expectedVersion?: number
  /** Explicit selection enables real owner-controlled review. Absence is the
   * development-only legacy fixture; it never enables release execution. */
  reviewer?: ContributionReviewerBinding
}

/** Body of `POST .../contributions/:cid/effects` — fire one act against a line. */
export interface RunEnvelopeEffectRequest {
  lineId: string
  /** Real MCP calls require the exact envelope version the person reviewed. */
  expectedVersion?: number
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
    /* Phase E — the tier machinery (CW5): the mock adversarial review's verdict,
     *  and the owner's explicit tightening act. A keyed review-required event id
     *  is the public durable receipt for that monotonic owner decision. */
    | 'review-passed'
    | 'review-required'
    /* Phase F — delegated judgment (CW8): the delegate's dual-stamped decision,
     *  its draft-mode guess, and its mechanical escalation back to the human. */
    | 'delegated-decision'
    | 'delegated-draft'
    | 'delegated-decline'
    | 'delegated-escalation'
  at: number
  /** The acting workspace's display name (public identity, like `postedBy`). */
  actor: string
  /** What KIND of principal acted (FWD-5) — absent = unattributed. */
  actorKind?: PrincipalKind
  /** The exact envelope line addressed by an effect attempt. Present only for
   *  `effect-executed` / `effect-refused`; its event id is the durable receipt
   *  for a keyed native attempt, so clients can reconcile repeated acts without
   *  mistaking another line's cardinality movement for their own. */
  lineId?: string
  /** The exact append-only changeset version created by a `crystallized`
   *  event. Its event id is the durable receipt for a keyed first-party
   *  crystallization, so response-loss recovery never guesses from position. */
  changesetVersion?: number
  /** The exact envelope version created by `envelope-proposed` or covered by
   * `envelope-approved`. The event id is the durable receipt for the keyed
   * first-party act, so retry never guesses from the mutable current envelope. */
  envelopeVersion?: number
  /** The exact changeset version covered by a `review-passed` event. The event
   * id is the durable receipt for a keyed first-party review, so response-loss
   * recovery never infers success from mutable row-level review state. */
  reviewedVersion?: number
  /** The immutable Delegation exercised by a delegated judgment event. Its
   * event id is the durable receipt for one keyed Ask action, so recovery never
   * infers success from a later envelope/status change. */
  delegationId?: string
  /** Exact standing-policy version used; absence identifies legacy history. */
  delegationRevision?: number
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
  /** Durable model attempts; pending becomes uncertain if its executing process
   * is gone. Retrying an attempt never dispatches a second provider request. */
  reviews?: ContributionReviewRun[]
  /** Explicit owner-started model judgment; private policy prose is redacted. */
  judgments?: DelegatedJudgmentRun[]
  id: string
  projectId: string
  /** Optional exact Project backlog item this Contribution is intended to
   * resolve. Absence is the legacy/unlinked meaning; this reference grants no
   * execution or landing authority by itself. */
  workItemId?: string
  /** Serve-time projection for a linked item, computed from its current state,
   * approved envelope and durable MCP receipts. Absent on legacy/unlinked rows. */
  workItemResolution?: 'ready' | 'needs-result' | 'uncertain' | 'closed'
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
  /** Public receipts for explicitly approved MCP effect attempts. */
  effects?: import('./contributionExecution.ts').ContributionEffectRun[]
  /** The changeset (CW3/CW4, Phase D) — EVERY crystallized version, append-only
   *  oldest-first (no force-push: the whole revision history is the record).
   *  Absent = nothing crystallized yet (INV-9 fixed absence). */
  changeset?: ChangesetVersion[]
  /** The computed landing gate (CW5, Phase E) — a serve-time projection, never
   *  stored: the same contribution recomputes as the record and envelope move. */
  tier?: ContributionTier
  /** The owner's explicit tightening (CW5): forces ≥ Tier 1 on a contribution
   *  the arithmetic would auto-land. Set by the one `require-review` act;
   *  there is deliberately NO op that unsets it. A keyed request receives an
   *  exact `review-required` timeline receipt. */
  reviewRequired?: true
  /** The changeset version the mock adversarial review last covered — Tier 1
   *  landing requires it to equal the LATEST version (a re-crystallize
   *  invalidates the verdict; stale review never covers new work). */
  reviewedVersion?: number
  /** Stamped the first time an IRREVERSIBLE act executes under this
   *  contribution's envelope — and never unset: the Tier-2 floor covers
   *  executed history, not just declared intent, so amending the line away
   *  afterwards cannot drop the gate (the dodge a review pass found). */
  effectsFired?: true
  status: ContributionStatus
  openedAt: number
  landedAt?: number
  /** Who landed it (display name) — the landing act's public record. */
  landedBy?: string
  /** The full timeline, time-ordered, append-only (CW4: no rewriting). */
  events: ContributionEvent[]
}

/** ── The attention ledger (CW9, Phase G) — interrupts justify themselves ────
 *  `GET /v1/projects/:id/attention`: human attention metered the way tokens
 *  are. The COUNTS are arithmetic over the project's contribution timelines
 *  (public acts, same visibility as the ledger); the ASKS are computed FOR THE
 *  CALLER — the owner sees the liability moments only they can take, a
 *  contributor sees their own next step — the CW9 inbox, triaged by
 *  who-can-decide. Every ask names WHICH approval function it serves
 *  (the Foundations' decomposition), so the interrupt explains itself. */
export interface AttentionAsk {
  contributionId: string
  title: string
  /** Which approval function needs the caller (Foundations): `liability` =
   *  ownership only a human can take; `error-catching` = a machine act could
   *  hold this (its presence in a HUMAN's queue is itself a tuning signal). */
  function: 'liability' | 'error-catching'
  label: string
}

export interface AttentionLedger {
  /** Human judgment acts on this project's timelines (approvals + landings
   *  taken manually, tighten acts). */
  humanActs: number
  /** Acts a delegate took or drafted under the conservation law. */
  delegatedActs: number
  /** Mechanical/machine acts (review verdicts, matched envelope effects). */
  machineActs: number
  /** Times a delegate escalated back to the human. */
  escalations: number
  asks: AttentionAsk[]
  /** The self-proposed optimization (owner only) — mechanical pattern-match,
   *  never fabricated cognition: present only when the arithmetic finds a
   *  pattern a delegation could hold and none exists yet. */
  proposal?: string
}

/** Body of `POST /v1/projects/:id/contributions` — open (declare) one. */
export interface OpenContributionRequest {
  title: string
  summary?: string
  subGoal?: string
  sessionId?: string
  /** Optional exact open MCP-mutation work item to link to this Contribution. */
  workItemId?: string
  /**
   * An explicitly reviewed MCP call to publish with a linked work item. The
   * server validates the live inspected tool and atomically creates the linked
   * Contribution plus its initial unapproved one-line envelope. This is a
   * proposal only: it does not approve or execute the call.
   */
  initialMcpProposal?: ContributionMcpSelection
}

/** Body of `POST /v1/projects/:id/contributions/:cid/comments`. */
export interface PostContributionNoteRequest {
  body: string
}
