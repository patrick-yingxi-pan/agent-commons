import type { ArtifactKind, SectionId } from '../types'
import type { ArtifactItem, ProjectContext, StepTool } from './cowork'

/** ── The relationship graph between the five entities ──────────────────────
 *  The prototype models five nouns — Session, Project, Artifact, Context, and
 *  Schedule. They aren't islands: every pair relates. This file is the single
 *  source of truth for (a) what those relationships ARE (the `RELATIONS` table,
 *  restated in PROPOSAL.md §4.7) and (b) the edits Claude can propose to them
 *  (`RelationOp`), each gated by a confirmation prompt in the conversation.
 *
 *  No React and no store here — just the model. The overlay that actually
 *  applies an op lives in controller/useRelations.tsx; the card that prompts
 *  for it lives in components/RelationActionCard.tsx. */

export type RelationEntity = 'session' | 'project' | 'artifact' | 'context' | 'schedule'

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
    blurb: 'The Artifacts gallery groups every artifact under its project.',
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
}

/** Whether an edit is confirmed each time (an interactive one-off) or approved
 *  once in advance and then executed repeatedly, unprompted (a recurring
 *  schedule's effect). The schedule is the unit of standing approval. */
export type Approval = 'per-action' | 'standing'

/** Every relation edit Claude can propose — one variant per pair, carrying the
 *  ids it touches plus the display names so a card can describe it without a
 *  lookup. `attach-context` rides a ready `AddedContext`-ish payload applied to
 *  the live session (see useRelations); the rest update the overlay store. */
export type RelationOp =
  // Session ↔ Project — file / move a session into a project (null = unfile).
  | { kind: 'file-session'; sessionId: string; sessionTitle: string; projectId: string | null; projectName: string }
  // Project ↔ Artifact — re-file an existing artifact under a project.
  | { kind: 'refile-artifact'; artifactId: string; artifactName: string; projectId: string; projectName: string }
  // Session ↔ Artifact — save a draft out of the session as an artifact (and,
  // when projectId is set, file it under that project in the same move).
  | { kind: 'save-artifact'; artifact: ArtifactDraft; sessionId: string; sessionTitle: string; projectId?: string; projectName?: string }
  // Session ↔ Context — attach a connector/context to the live session.
  | { kind: 'attach-context'; sessionTitle: string; connectorId: string; connectorLabel: string; connectorKind?: 'github' | 'connector' | 'mcp' }
  // Project ↔ Context — scope a context to a project.
  | { kind: 'scope-context'; projectId: string; projectName: string; context: ProjectContext }
  // Project ↔ Schedule — link a recurring schedule to a project.
  | { kind: 'link-schedule-project'; scheduleId: string; scheduleName: string; projectId: string; projectName: string }
  // Artifact ↔ Context — record that an artifact derives from a context.
  | { kind: 'set-artifact-source'; artifactId: string; artifactName: string; contextLabel: string }
  // Session ↔ Schedule — have a schedule open a fresh session each run (standing).
  | { kind: 'set-schedule-session'; scheduleId: string; scheduleName: string; cadence: string; sessionLabel: string }
  // Artifact ↔ Schedule — have a schedule save/overwrite an artifact each run (standing).
  | { kind: 'set-schedule-artifact'; scheduleId: string; scheduleName: string; cadence: string; artifactName: string }
  // Context ↔ Schedule — add a tool/connector the schedule uses each run (standing).
  | { kind: 'schedule-add-tool'; scheduleId: string; scheduleName: string; cadence: string; tool: StepTool }

/** A stable key per op — used to mark standing approvals and to track a card
 *  row's confirmed state. */
export function opKey(op: RelationOp): string {
  switch (op.kind) {
    case 'file-session':
      return `file-session:${op.sessionId}:${op.projectId ?? 'none'}`
    case 'refile-artifact':
      return `refile-artifact:${op.artifactId}:${op.projectId}`
    case 'save-artifact':
      return `save-artifact:${op.sessionId}:${op.artifact.name}`
    case 'attach-context':
      return `attach-context:${op.sessionTitle}:${op.connectorId}`
    case 'scope-context':
      return `scope-context:${op.projectId}:${op.context.label}`
    case 'link-schedule-project':
      return `link-schedule-project:${op.scheduleId}:${op.projectId}`
    case 'set-artifact-source':
      return `set-artifact-source:${op.artifactId}:${op.contextLabel}`
    case 'set-schedule-session':
      return `set-schedule-session:${op.scheduleId}`
    case 'set-schedule-artifact':
      return `set-schedule-artifact:${op.scheduleId}:${op.artifactName}`
    case 'schedule-add-tool':
      return `schedule-add-tool:${op.scheduleId}:${op.tool.id}`
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
    case 'refile-artifact':
      return {
        text: `Move **${op.artifactName}** into **${op.projectName}**`,
        done: `Moved into ${op.projectName}`,
        section: 'artifacts',
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
    case 'link-schedule-project':
      return {
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
    case 'set-schedule-artifact':
      return {
        text: `Have the **${op.scheduleName}** schedule save **${op.artifactName}** each run`,
        done: `Saves ${op.artifactName} every run`,
        section: 'scheduled',
        relationId: 'artifact-schedule',
        approval: 'standing',
      }
    case 'schedule-add-tool':
      return {
        text: `Let the **${op.scheduleName}** schedule use **${op.tool.label}** each run`,
        done: `Uses ${op.tool.label} every run`,
        section: 'scheduled',
        relationId: 'context-schedule',
        approval: 'standing',
      }
    default: {
      const _exhaustive: never = op
      return _exhaustive
    }
  }
}

/** A new artifact materialised from a `save-artifact` op. The store mints the id
 *  and stamps it; everything else comes from the draft + the session. */
export function artifactFromDraft(draft: ArtifactDraft, id: string, sourceTitle: string, projectId: string): ArtifactItem {
  return {
    id,
    name: draft.name,
    kind: draft.kind,
    meta: draft.meta,
    source: sourceTitle,
    projectId,
    excerpt: draft.excerpt,
    edited: 'just now',
    tag: 'Cowork',
  }
}
