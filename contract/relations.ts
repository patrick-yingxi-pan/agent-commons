/** ── Contract: the relationship graph between the five entities ─────────────
 *  The relationship graph models five nouns — Session, Project, Artifact, Context, and
 *  Schedule. They aren't islands: every pair relates. This file is the single
 *  source of truth for (a) what those relationships ARE (`RELATIONS`) and (b)
 *  the edits a model can propose to them (`RelationOp`),
 *  each gated by a confirmation prompt in the conversation.
 *
 *  Shared by the UI (the confirmation card, the proposal labels) and the backend
 *  (which applies a confirmed op to the relationship graph). No React, no store,
 *  no data — just the model + its pure description helpers. */
import type { ArtifactKind, SectionId } from './entities.ts'
import type { ArtifactItem, ProjectContext, ProjectContextSource, StepTool } from './cowork.ts'
import type { ProjectRole } from './roles.ts'
import { authoredArtifact, type StructuredArtifactBody } from './artifactAuthoring.ts'
import { isArtifactCreationId } from './artifactCreation.ts'
import { parseScheduledArtifactSpec, type ScheduledArtifactKind } from './scheduledArtifact.ts'

export type RelationEntity = 'session' | 'project' | 'artifact' | 'context' | 'schedule'

/** A project-context removal selector. New callers carry the stable source
 *  identity; the label-only form remains for legacy proposals and is admitted
 *  only when it identifies exactly one current context. */
export interface ProjectContextSelector {
  contextLabel: string
  contextSource?: ProjectContextSource
}

export function projectContextIdentityKey(label: string, source?: ProjectContextSource): string {
  // Keep the legacy label form distinct from a source-qualified form even when
  // a user chooses a label that resembles the source encoding. Length framing
  // also prevents delimiter-based aliases inside either form. The tag changes
  // the old bare-label key deliberately: persisted old approvals are not
  // guessed or widened into the new source-aware identity space.
  const frame = (value: string): string => `${value.length}:${value}`
  return source
    ? `source:${frame(source.kind)}:${frame(source.id)}`
    : `label:${frame(label)}`
}

export function projectContextMatchesSelector(
  context: ProjectContext,
  selector: ProjectContextSelector,
): boolean {
  if (selector.contextSource) {
    return context.source?.kind === selector.contextSource.kind && context.source.id === selector.contextSource.id
  }
  return context.label === selector.contextLabel
}

/** Label-only selectors are safe only when they match one context. */
export function projectContextSelectorIsAmbiguous(
  contexts: readonly ProjectContext[],
  selector: ProjectContextSelector,
): boolean {
  if (selector.contextSource) return false
  let matches = 0
  for (const context of contexts) {
    if (projectContextMatchesSelector(context, selector)) matches += 1
    if (matches > 1) return true
  }
  return false
}

/** A described relationship between two of the five entities. */
export interface RelationDef {
  id: string
  ends: [RelationEntity, RelationEntity]
  /** The verb read from the first end to the second ("filed under", "produces"). */
  verb: string
  /** How many of the second end one of the first can relate to. */
  cardinality: string
  /** One line on what the relationship means + where it lives today. */
  blurb: string
}

/** All ten pairs. Authored once here; the docs restate it. */
export const RELATIONS: RelationDef[] = [
  {
    id: 'session-project',
    ends: ['session', 'project'],
    verb: 'filed under',
    cardinality: 'a session sits in at most one project',
    blurb: 'A project groups the sessions that belong to one effort.',
  },
  {
    id: 'session-artifact',
    ends: ['session', 'artifact'],
    verb: 'produces',
    cardinality: 'one session, many artifacts',
    blurb: 'Artifacts are the docs, sheets, and images a session creates.',
  },
  {
    id: 'session-context',
    ends: ['session', 'context'],
    verb: 'attaches',
    cardinality: 'one session, many contexts',
    blurb: 'Attaching context (a folder, repo, connector) is what grants capability.',
  },
  {
    id: 'session-schedule',
    ends: ['session', 'schedule'],
    verb: 'spawned by / delivered to',
    cardinality: 'a schedule can open a fresh session each run',
    blurb: 'A recurring schedule can land its output in a new session every run.',
  },
  {
    id: 'project-artifact',
    ends: ['project', 'artifact'],
    verb: 'collects',
    cardinality: 'one project, many artifacts',
    blurb: 'The Artifacts index groups every artifact under its project.',
  },
  {
    id: 'project-context',
    ends: ['project', 'context'],
    verb: 'scopes',
    cardinality: 'one project, many contexts',
    blurb: 'A project carries the folders, repos, and connectors its work shares.',
  },
  {
    id: 'project-schedule',
    ends: ['project', 'schedule'],
    verb: 'owns',
    cardinality: 'one project, many schedules',
    blurb: 'Recurring runs can belong to a project so its cadence lives with it.',
  },
  {
    id: 'artifact-context',
    ends: ['artifact', 'context'],
    verb: 'derives from / serves as',
    cardinality: 'an artifact can cite a source context, or become one',
    blurb: 'An artifact can be drawn from a context — or be promoted into one.',
  },
  {
    id: 'artifact-schedule',
    ends: ['artifact', 'schedule'],
    verb: 'output by',
    cardinality: 'a schedule writes one delivered artifact',
    blurb: 'A schedule can save or overwrite an artifact on each run.',
  },
  {
    id: 'context-schedule',
    ends: ['context', 'schedule'],
    verb: 'used by',
    cardinality: 'one schedule, many tool-contexts',
    blurb: "A schedule's steps lean on connectors and tools — the context it uses.",
  },
]

/** A new artifact Claude offers to save out of a session. */
export interface ArtifactDraft {
  name: string
  kind: ArtifactKind
  meta: string
  excerpt?: string
  /** Authored document text or literal sheet/slide values. Absence retains
   * historical metadata-only saves; current authoring supplies the complete
   * bounded body. Metadata and the revisioned body commit together. */
  body?: string | StructuredArtifactBody
}

/** Whether an edit is confirmed each time (an interactive one-off) or approved
 *  once in advance and then executed repeatedly, unprompted (a recurring
 *  schedule's effect). The schedule is the unit of standing approval. */
export type Approval = 'per-action' | 'standing'

/** Every relation edit Claude can propose — one variant per pair, carrying the
 *  ids it touches plus the display names so a card can describe it without a
 *  lookup. `attach-context` rides a ready `AddedContext`-ish payload applied to
 *  the live session; the rest update the relationship graph. */
export type RelationOp =
  // Session ↔ Project — file / move a session into a project (null = unfile).
  | { kind: 'file-session'; sessionId: string; sessionTitle: string; projectId: string | null; projectName: string }
  // Session ↔ Project — create a new project, optionally filing a session into it
  // in the same move. A model-created project proposal files the live session; a user
  // creating a project from the Projects page passes neither (an empty project).
  // `ownerTenantId` (FWD-6 O-D4, the owner picker): ABSENT = the caller's own
  // namespace (the fixed minimal-risk absence, INV-9 — never a mutable default);
  // present = an org the caller holds a seat in, else refused (404, the
  // existence-hiding shape every foreign target gets).
  | { kind: 'create-project'; projectId: string; projectName: string; projectDescription: string; sessionId?: string; sessionTitle?: string; ownerTenantId?: string }
  // Project ↔ Artifact — move an artifact into a project (null = unfile, back to
  // the gallery's "Unfiled" bucket).
  | { kind: 'refile-artifact'; artifactId: string; artifactName: string; projectId: string | null; projectName: string }
  // Session ↔ Artifact — save authored content. Optionally files it under a
  // project (projectId), and optionally cites the session it came from — a user
  // creating one from the Artifacts index passes neither session field. Legacy
  // non-document/metadata-only saves remain readable through ArtifactDraft.
  | { kind: 'save-artifact'; artifact: ArtifactDraft; sessionId?: string; sessionTitle?: string; projectId?: string; projectName?: string; /** Server-stamped replay namespace; callers cannot choose ownership. */ ownerTenantId?: string }
  // Session ↔ Context — attach a connector/context to the live session.
  | { kind: 'attach-context'; sessionTitle: string; connectorId: string; connectorLabel: string; connectorKind?: 'github' | 'connector' | 'mcp' }
  // Project ↔ Context — scope a context to a project.
  | { kind: 'scope-context'; projectId: string; projectName: string; context: ProjectContext }
  // Project ↔ Context — remove a scoped context from a project (the inverse of scope-context).
  | ({ kind: 'unscope-context'; projectId: string; projectName: string } & ProjectContextSelector)
  // Project — edit a project's custom instructions (the right-panel "Instructions" card).
  // `expectedInstructions` is the exact text the author reviewed. ABSENT keeps
  // the legacy unconditional-write meaning for older/API callers.
  | { kind: 'set-project-instructions'; projectId: string; projectName: string; instructions: string; expectedInstructions?: string }
  // Project — edit a project's DESCRIPTION (D26): the one PUBLIC "about" every
  // viewer of a shared project reads, unlike instructions (private owner
  // context). It was a second field, `readme`, beside `Project.description`
  // until 2026-08-13 — the two were the same text asked for twice, and the one
  // the create dialog collected was never this one.
  // `expectedDescription` has the same optional compare-and-swap semantics as
  // instructions; the desired text remains independent from its precondition.
  | { kind: 'set-project-description'; projectId: string; projectName: string; description: string; expectedDescription?: string }
  // Project ↔ Schedule — link a recurring schedule to a project (null = unlink).
  | { kind: 'link-schedule-project'; scheduleId: string; scheduleName: string; projectId: string | null; projectName: string }
  // Artifact ↔ Context — record that an artifact derives from a context.
  | { kind: 'set-artifact-source'; artifactId: string; artifactName: string; contextLabel: string }
  // Session ↔ Schedule — have a schedule open a fresh session each run (standing).
  | { kind: 'set-schedule-session'; scheduleId: string; scheduleName: string; cadence: string; sessionLabel: string }
  // Artifact ↔ Schedule — have a schedule save/overwrite an artifact each run (standing).
  | { kind: 'set-schedule-artifact'; scheduleId: string; scheduleName: string; cadence: string; artifactName: string; /** Absent on legacy proposals and means Document. */ artifactKind?: ScheduledArtifactKind }
  // Context ↔ Schedule — add a tool/connector the schedule uses each run (standing).
  | { kind: 'schedule-add-tool'; scheduleId: string; scheduleName: string; cadence: string; tool: StepTool }
  // ── Agent Commons CRUD (docs/agent-commons.md, D6/D9/D10/D7) ────────────────
  //  Claude can manage the Agent Commons concepts through the SAME confirmation card
  //  it uses for relation edits — the user's "keep one shared gating mechanism" steer.
  //  These are NOT graph edits: they're executed server-side through the registry
  //  mutators (the D8 attenuation funnels + the 409 guards), so they no-op in the pure
  //  graph reducer (`applyGraphOp`). Each carries the fields the mutator needs plus the
  //  display labels the card shows (the same id-plus-name pattern the edits above use).
  //  Additive / relation moves only — registry *deletes* stay a deliberate hub action,
  //  mirroring how Claude never proposes deleting a project or artifact.
  // D9 — register a Model provider (the cognition source; the cascade root).
  | { kind: 'create-provider'; label: string; modelFamily: string }
  // D10 — add a reusable system prompt to the library.
  | { kind: 'create-prompt'; label: string; body: string; targetFamily: string }
  // D6 — create a worker Agent bound to a provider + a library prompt. The tool builder
  // stamps the bindings (and the tool grant) CONCRETE before the consent card (INV-9);
  // the ids are optional in the type only for proposals persisted before that
  // strictness — the apply funnel refuses them. `tools` absent = the empty set
  // (minimal risk; the builder grants the full catalog explicitly and says so).
  // `newPrompt` is the same-turn chaining form: when the model proposed the prompt
  // with create_system_prompt in the SAME turn (so no library id exists yet), the
  // agent proposal BUNDLES the prompt's full payload — one consent card creates
  // both. Still concrete (the card shows the body verbatim), so INV-9 holds; the
  // apply funnel reuses an identically-labelled library prompt rather than
  // duplicating (the create-project exists-check pattern). Exactly one of
  // `systemPromptId` / `newPrompt` is present on a well-formed proposal.
  | { kind: 'create-agent'; label: string; providerId?: string; providerLabel?: string; systemPromptId?: string; systemPromptLabel?: string; newPrompt?: { label: string; body: string; targetFamily: string }; instructions?: string; tools?: string[] }
  // D7/D13 — commission an Agent onto a Project (the agent→Project leaf of the cascade).
  // `role` is stamped concrete by the builder (the Project's defaultRole, else writer —
  // shown on the card); optional in the type only for pre-strictness proposals, which
  // the apply funnel refuses (INV-9).
  | { kind: 'commission-agent'; agentId: string; agentLabel: string; projectId: string; projectName: string; role?: ProjectRole }
  // D7 — un-commission: remove a Contributor (a commission) from its Project.
  | { kind: 'uncommission-agent'; commissionId: string; agentLabel: string; projectId: string; projectName: string }
  // D16 — hand a Conversation off to a different worker Agent mid-thread (re-bind the driver).
  | { kind: 'handoff-agent'; sessionId: string; sessionTitle: string; agentId: string; agentLabel: string }
  // D13 — set a Project's per-commissioner abuse cap (the max active Commissions it admits).
  | { kind: 'set-commission-cap'; projectId: string; projectName: string; cap: number }
  // P8 — mark a Project SHARED (open to cross-tenant Contributors) or private again. Owner-only.
  | { kind: 'share-project'; projectId: string; projectName: string; shared: boolean }
  // D14 — set (or clear) a Project's default contributor role: the UI-shortcut the
  // commissioning pickers pre-select (INV-9 — the API never resolves to it). Owner-only.
  // `role` absent = clear the preference (pickers fall back to the writer baseline).
  | { kind: 'set-project-default-role'; projectId: string; projectName: string; role?: ProjectRole }

/** A stable key per op — used to mark standing approvals and to track a card
 *  row's confirmed state. */
export function opKey(op: RelationOp): string {
  switch (op.kind) {
    case 'file-session':
      return `file-session:${op.sessionId}:${op.projectId ?? 'none'}`
    case 'create-project':
      return `create-project:${op.projectId}`
    case 'refile-artifact':
      return `refile-artifact:${op.artifactId}:${op.projectId ?? 'none'}`
    case 'save-artifact':
      return `save-artifact:${op.sessionId ?? 'manual'}:${op.artifact.name}`
    case 'attach-context':
      return `attach-context:${op.sessionTitle}:${op.connectorId}`
    case 'scope-context':
      return `scope-context:${op.projectId}:${projectContextIdentityKey(op.context.label, op.context.source)}`
    case 'unscope-context':
      return `unscope-context:${op.projectId}:${projectContextIdentityKey(op.contextLabel, op.contextSource)}`
    case 'set-project-instructions':
      return `set-project-instructions:${op.projectId}`
    case 'set-project-description':
      return `set-project-description:${op.projectId}`
    case 'link-schedule-project':
      return `link-schedule-project:${op.scheduleId}:${op.projectId ?? 'none'}`
    case 'set-artifact-source':
      return `set-artifact-source:${op.artifactId}:${op.contextLabel}`
    case 'set-schedule-session':
      return `set-schedule-session:${op.scheduleId}`
    case 'set-schedule-artifact':
      return Object.hasOwn(op, 'artifactKind')
        ? `set-schedule-output:${JSON.stringify([op.scheduleId, op.artifactName, op.artifactKind])}`
        : `set-schedule-artifact:${op.scheduleId}:${op.artifactName}`
    case 'schedule-add-tool':
      return `schedule-add-tool:${op.scheduleId}:${op.tool.id}`
    case 'create-provider':
      return `create-provider:${op.label}`
    case 'create-prompt':
      return `create-prompt:${op.label}`
    case 'create-agent':
      return `create-agent:${op.label}`
    case 'commission-agent':
      return `commission-agent:${op.agentId}:${op.projectId}`
    case 'uncommission-agent':
      return `uncommission-agent:${op.commissionId}`
    case 'handoff-agent':
      return `handoff-agent:${op.sessionId}:${op.agentId}`
    case 'set-commission-cap':
      return `set-commission-cap:${op.projectId}:${op.cap}`
    case 'share-project':
      return `share-project:${op.projectId}:${op.shared}`
    case 'set-project-default-role':
      return `set-project-default-role:${op.projectId}:${op.role ?? 'none'}`
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}

/** What a card row shows for an op: a human sentence, the cross-cutting section
 *  it lands in (for the "View in …" deep-link), the relation it edits, and
 *  whether it confirms per-action or is a standing (advance) approval. */
export interface OpDescription {
  /** The proposed action, e.g. "File **Insights dashboard launch** under **Insights dashboard**". */
  text: string
  /** Plain sentence used once confirmed ("Filed under Insights dashboard"). */
  done: string
  /** Which section reflects the change (drives the deep-link); null = the session itself. */
  section: SectionId | null
  /** When `section` is a project view, the project to open. */
  projectId?: string
  /** The card's lead-glyph / grouping key: a `RELATIONS` id for a relationship edit,
   *  or a synthetic `agent-*` key for an Agent Commons CRUD op (which edits a registry,
   *  not a relation between the five entities). Not required to be in `RELATIONS`. */
  relationId: string
  approval: Approval
}

export function describeOp(op: RelationOp): OpDescription {
  switch (op.kind) {
    case 'file-session':
      return op.projectId === null
        ? {
            text: `Remove **${op.sessionTitle}** from **${op.projectName}**`,
            done: `Unfiled from ${op.projectName}`,
            section: 'projects',
            relationId: 'session-project',
            approval: 'per-action',
          }
        : {
            text: `File **${op.sessionTitle}** under **${op.projectName}**`,
            done: `Filed under ${op.projectName}`,
            section: 'projects',
            projectId: op.projectId,
            relationId: 'session-project',
            approval: 'per-action',
          }
    case 'create-project':
      return {
        text: op.sessionTitle
          ? `Create the **${op.projectName}** project and file **${op.sessionTitle}** into it`
          : `Create the **${op.projectName}** project`,
        done: `Created ${op.projectName}`,
        section: 'projects',
        projectId: op.projectId,
        relationId: 'session-project',
        approval: 'per-action',
      }
    case 'refile-artifact':
      return op.projectId === null
        ? {
            text: `Remove **${op.artifactName}** from its project`,
            done: 'Removed from its project',
            section: 'artifacts',
            relationId: 'project-artifact',
            approval: 'per-action',
          }
        : {
            text: `Move **${op.artifactName}** into **${op.projectName}**`,
            done: `Moved into ${op.projectName}`,
            section: 'artifacts',
            projectId: op.projectId,
            relationId: 'project-artifact',
            approval: 'per-action',
          }
    case 'save-artifact':
      return {
        text: op.projectName
          ? `Save **${op.artifact.name}** as an artifact and file it under **${op.projectName}**`
          : `Save **${op.artifact.name}** as an artifact`,
        done: op.projectName ? `Saved under ${op.projectName}` : 'Saved as an artifact',
        section: 'artifacts',
        projectId: op.projectId,
        relationId: 'session-artifact',
        approval: 'per-action',
      }
    case 'attach-context':
      return {
        text: `Attach **${op.connectorLabel}** to this session`,
        done: `Attached ${op.connectorLabel}`,
        section: null,
        relationId: 'session-context',
        approval: 'per-action',
      }
    case 'scope-context':
      return {
        text: `Scope **${op.context.label}** to **${op.projectName}**`,
        done: `Scoped to ${op.projectName}`,
        section: 'projects',
        projectId: op.projectId,
        relationId: 'project-context',
        approval: 'per-action',
      }
    case 'unscope-context':
      return {
        text: `Remove **${op.contextLabel}** from **${op.projectName}**`,
        done: `Removed ${op.contextLabel}`,
        section: 'projects',
        projectId: op.projectId,
        relationId: 'project-context',
        approval: 'per-action',
      }
    case 'set-project-instructions':
      return {
        text: `Update the **${op.projectName}** project instructions`,
        done: 'Instructions updated',
        section: 'projects',
        projectId: op.projectId,
        relationId: 'project-context',
        approval: 'per-action',
      }
    case 'set-project-description':
      return {
        text: `Update the **${op.projectName}** project description`,
        done: 'Description updated',
        section: 'projects',
        projectId: op.projectId,
        relationId: 'project-context',
        approval: 'per-action',
      }
    case 'link-schedule-project':
      return op.projectId === null
        ? {
            text: `Remove the **${op.scheduleName}** schedule from **${op.projectName}**`,
            done: `Unlinked from ${op.projectName}`,
            section: 'scheduled',
            relationId: 'project-schedule',
            approval: 'per-action',
          }
        : {
            text: `Link the **${op.scheduleName}** schedule to **${op.projectName}**`,
            done: `Linked to ${op.projectName}`,
            section: 'projects',
            projectId: op.projectId,
            relationId: 'project-schedule',
            approval: 'per-action',
          }
    case 'set-artifact-source':
      return {
        text: `Note that **${op.artifactName}** derives from **${op.contextLabel}**`,
        done: `Source set to ${op.contextLabel}`,
        section: 'artifacts',
        relationId: 'artifact-context',
        approval: 'per-action',
      }
    case 'set-schedule-session':
      return {
        text: `Have the **${op.scheduleName}** schedule open a fresh session each run (${op.sessionLabel})`,
        done: `Opens ${op.sessionLabel} every run`,
        section: 'scheduled',
        relationId: 'session-schedule',
        approval: 'standing',
      }
    case 'set-schedule-artifact': {
      const artifact = parseScheduledArtifactSpec({ name: op.artifactName, kind: Object.hasOwn(op, 'artifactKind') ? op.artifactKind : 'doc' })
      const format = artifact?.kind === 'sheet' ? 'Sheet' : artifact?.kind === 'slide' ? 'Slides' : artifact?.kind === 'doc' ? 'Document' : 'Artifact'
      return {
        text: `Have the **${op.scheduleName}** schedule save ${format} **${op.artifactName}** each run`,
        done: `Saves ${format} ${op.artifactName} every run`,
        section: 'scheduled',
        relationId: 'artifact-schedule',
        approval: 'standing',
      }
    }
    case 'schedule-add-tool':
      return {
        text: `Let the **${op.scheduleName}** schedule use **${op.tool.label}** each run`,
        done: `Uses ${op.tool.label} every run`,
        section: 'scheduled',
        relationId: 'context-schedule',
        approval: 'standing',
      }
    // ── Agent Commons CRUD — each lands in the Agents hub ("View in Agents") ──
    case 'create-provider':
      return {
        text: `Register the **${op.label}** model provider (${op.modelFamily})`,
        done: `Registered ${op.label}`,
        section: 'agents',
        relationId: 'agent-provider',
        approval: 'per-action',
      }
    case 'create-prompt':
      return {
        text: `Add **${op.label}** to the system-prompt library`,
        done: `Added ${op.label}`,
        section: 'agents',
        relationId: 'agent-prompt',
        approval: 'per-action',
      }
    case 'create-agent': {
      const on = op.providerLabel ? ` on **${op.providerLabel}**` : ''
      // A bundled same-turn prompt is part of what's being approved — say so.
      const withPrompt = op.newPrompt
        ? ` with the new **${op.newPrompt.label}** prompt (added to the library)`
        : op.systemPromptLabel
          ? ` with the **${op.systemPromptLabel}** prompt`
          : ''
      // The tool grant is part of what's being approved (INV-9: absent = NO tools),
      // so the card states it rather than leaving the grant implicit.
      const granting = op.tools?.length ? `, granting **${op.tools.length} tools**` : ', granting no tools'
      return {
        text: `Create the **${op.label}** worker agent${on}${withPrompt}${granting}`,
        done: `Created ${op.label}`,
        section: 'agents',
        relationId: 'agent-worker',
        approval: 'per-action',
      }
    }
    case 'commission-agent': {
      const asRole = op.role ? ` as ${op.role}` : ''
      return {
        text: `Commission **${op.agentLabel}** to **${op.projectName}**${op.role ? ` as **${op.role}**` : ''}`,
        done: `Commissioned ${op.agentLabel} to ${op.projectName}${asRole}`,
        section: 'agents',
        relationId: 'agent-commission',
        approval: 'per-action',
      }
    }
    case 'uncommission-agent':
      return {
        text: `Remove **${op.agentLabel}** from **${op.projectName}**`,
        done: `Removed ${op.agentLabel} from ${op.projectName}`,
        section: 'agents',
        relationId: 'agent-commission',
        approval: 'per-action',
      }
    case 'handoff-agent':
      return {
        text: `Hand **${op.sessionTitle}** off to **${op.agentLabel}**`,
        done: `Handed ${op.sessionTitle} to ${op.agentLabel}`,
        section: 'agents',
        relationId: 'session-agent',
        approval: 'per-action',
      }
    case 'set-commission-cap':
      return {
        text: `Set **${op.projectName}**'s commission cap to **${op.cap}**`,
        done: `Set ${op.projectName}'s commission cap to ${op.cap}`,
        section: 'agents',
        relationId: 'agent-commission-cap',
        approval: 'per-action',
      }
    case 'share-project':
      return {
        text: op.shared
          ? `Share **${op.projectName}** with everyone on Agent Commons. Others can discover this Project and contribute their own agents; private conversations and context stay private.`
          : `Stop sharing **${op.projectName}** with the Commons. Public discovery and cross-account contributions stop; existing audience grants and their permissions stay unchanged.`,
        done: op.shared ? `Shared ${op.projectName}` : `Stopped public sharing of ${op.projectName}`,
        section: 'projects',
        projectId: op.projectId,
        relationId: 'project-shared',
        approval: 'per-action',
      }
    case 'set-project-default-role':
      return {
        text: op.role
          ? `Pre-select **${op.role}** for new contributors on **${op.projectName}**`
          : `Clear **${op.projectName}**'s default contributor role`,
        done: op.role
          ? `New contributors on ${op.projectName} pre-select ${op.role}`
          : `Cleared ${op.projectName}'s default contributor role`,
        section: 'projects',
        projectId: op.projectId,
        relationId: 'project-default-role',
        approval: 'per-action',
      }
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}

/** The body a content-bearing consent op would write, for the card to show BEFORE you
 *  approve it (surface-audit S2). A change shown as prose ("Update the description") hides
 *  the actual text being written, so consent is given blind; this returns the proposed
 *  body — and, for an edit to an existing value (description / instructions), the CURRENT
 *  value so the card can render an old→new diff (`current` omitted ⇒ a create, shown as
 *  the proposed body alone; never a diff faked against an empty column). Pure over the
 *  op + two current-value resolvers (the UI passes `descriptionForProject` /
 *  `instructionsForProject`); every pure-ref op returns null (no body to preview). */
export interface RelationContentPreview {
  label: string
  current?: string
  proposed: string
  /** The same validated values rendered after save, not a lossy prose summary. */
  structured?: StructuredArtifactBody
}
export function relationContentPreview(
  op: RelationOp,
  currentDescription: (projectId: string) => string | undefined,
  currentInstructions: (projectId: string) => string | undefined,
): RelationContentPreview | null {
  switch (op.kind) {
    // A cleared/blank current normalizes to a create (`|| undefined`): a diff
    // against an empty column is exactly the faked-diff the contract above forbids.
    case 'set-project-description':
      return { label: 'Description', current: currentDescription(op.projectId) || undefined, proposed: op.description }
    case 'set-project-instructions':
      return { label: 'Instructions', current: currentInstructions(op.projectId) || undefined, proposed: op.instructions }
    case 'create-prompt':
      return { label: 'Prompt body', proposed: op.body }
    case 'create-agent':
      // A bundled new prompt is the card's biggest payload — the user must be able
      // to read what they're adding to the library before confirming.
      return op.newPrompt
        ? { label: 'New prompt body', proposed: op.newPrompt.body }
        : op.instructions
          ? { label: 'Instructions', proposed: op.instructions }
          : null
    case 'create-project':
      return op.projectDescription ? { label: 'Description', proposed: op.projectDescription } : null
    case 'save-artifact': {
      if (typeof op.artifact.body === 'string') {
        return op.artifact.body.trim() ? { label: 'Document content', proposed: op.artifact.body } : null
      }
      const authored = authoredArtifact(op.artifact.name, op.artifact.kind, op.artifact.body)
      if (!authored || typeof authored.draftBody === 'string') return null
      return {
        label: authored.draftBody.type === 'slides' ? 'Slide content' : 'Sheet content',
        proposed: JSON.stringify(authored.draftBody, null, 2),
        structured: authored.draftBody,
      }
    }
    default:
      return null
  }
}

/** A new artifact materialised from a `save-artifact` op. The store mints the id
 *  and stamps the edit time (`editedAt`); everything else comes from the draft +
 *  the session. The caller injects `editedAt` (the authoritative server clock,
 *  or a deterministic pure-test value) so the reducer stays pure. */
export function artifactFromDraft(
  draft: ArtifactDraft,
  id: string,
  sourceTitle: string,
  projectId: string,
  editedAt: number,
  sourceSessionId?: string,
  ownerTenantId?: string,
): ArtifactItem {
  return {
    id,
    name: draft.name,
    saveOrigin: { name: draft.name, source: sourceTitle },
    kind: draft.kind,
    meta: draft.meta,
    source: sourceTitle,
    // The stable join for "From ‹conversation›" — the title above is display only
    // (mutable; a rename must not break the door).
    sourceSessionId,
    projectId,
    excerpt: draft.excerpt,
    editedAt,
    ...(ownerTenantId === undefined ? {} : { tenantId: ownerTenantId }),
  }
}

/** Save replay compares immutable provenance, never the mutable display name.
 * Legacy raw rows still carry their original name/source until projected. */
export function artifactMatchesSave(artifact: ArtifactItem, op: Extract<RelationOp, { kind: 'save-artifact' }>): boolean {
  // Direct keyed authoring has an intrinsic creation identity. Its immutable
  // saveOrigin is provenance only and must never let a later conversational
  // save with the same name/source adopt or overwrite that exact-ID resource.
  if (isArtifactCreationId(artifact.id)) return false
  const origin = artifact.saveOrigin ?? artifact
  return origin.name === op.artifact.name && origin.source === (op.sessionTitle ?? 'Created here') &&
    (op.ownerTenantId === undefined || artifact.tenantId === op.ownerTenantId)
}
