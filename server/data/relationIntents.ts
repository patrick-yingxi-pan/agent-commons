import { ALL_ARTIFACTS, PROJECTS, SCHEDULED_TASKS } from './cowork.ts'
import { CONNECTOR_OPTIONS } from './contextOptions.ts'
import type { RelationOp } from '../../contract/relations.ts'

/** Honest keyword matching (no fake intelligence) that turns a free-typed
 *  request into the relation edits Claude would propose. Used by the session
 *  controller so the conversation can demonstrate every relationship op, not
 *  only the guided tour's. Returns [] when nothing recognizable matched, so the
 *  controller can fall back to its static-prototype reply. */
export function matchRelationOps(text: string, session: { id: string; title: string }): RelationOp[] {
  const t = text.toLowerCase()
  const ops: RelationOp[] = []

  const project =
    PROJECTS.find((p) => t.includes(p.name.toLowerCase())) ??
    (/\bproject\b/.test(t) ? PROJECTS[0] : undefined)
  const connector = CONNECTOR_OPTIONS.find((c) => t.includes(c.label.toLowerCase()))
  const artifact = ALL_ARTIFACTS.find((a) => t.includes(a.name.toLowerCase()))
  const schedule = SCHEDULED_TASKS.find((s) => t.includes(s.name.toLowerCase()))
  const hasSchedule = /\bschedul/.test(t)

  // ── Artifact-centric ─────────────────────────────────────────────────────
  if (artifact && project && /\b(move|refile|file|put)\b/.test(t)) {
    ops.push({
      kind: 'refile-artifact',
      artifactId: artifact.id,
      artifactName: artifact.name,
      projectId: project.id,
      projectName: project.name,
    })
  } else if (artifact && connector && /\b(deriv|source|from|based on)\b/.test(t)) {
    ops.push({
      kind: 'set-artifact-source',
      artifactId: artifact.id,
      artifactName: artifact.name,
      contextLabel: connector.label,
    })
  }

  // ── Schedule-centric (standing unless an explicit project link) ──────────
  if (hasSchedule) {
    const s = schedule ?? SCHEDULED_TASKS[0]
    if (project && /\blink\b/.test(t)) {
      ops.push({
        kind: 'link-schedule-project',
        scheduleId: s.id,
        scheduleName: s.name,
        projectId: project.id,
        projectName: project.name,
      })
    } else if (/\bsession\b/.test(t)) {
      ops.push({
        kind: 'set-schedule-session',
        scheduleId: s.id,
        scheduleName: s.name,
        cadence: s.cadence,
        sessionLabel: 'New session',
      })
    } else if (connector && /\buse\b/.test(t)) {
      ops.push({
        kind: 'schedule-add-tool',
        scheduleId: s.id,
        scheduleName: s.name,
        cadence: s.cadence,
        tool: { id: connector.id, label: connector.label, tone: 'connector' },
      })
    } else if (/\b(save|digest|artifact|report|output|write)\b/.test(t)) {
      // Only propose a (standing) "save X each run" when the text actually asks
      // for an output — a bare "…this schedule…" mention contributes no op, so
      // the controller falls back to its canned reply rather than inventing one.
      ops.push({
        kind: 'set-schedule-artifact',
        scheduleId: s.id,
        scheduleName: s.name,
        cadence: s.cadence,
        artifactName: 'digest.md',
      })
    }
  }

  // ── Save a draft out of this session ─────────────────────────────────────
  if (!artifact && /\bsave\b/.test(t) && /\b(artifact|draft|doc|note|recap|summary)\b/.test(t)) {
    ops.push({
      kind: 'save-artifact',
      artifact: { name: 'session-recap.md', kind: 'doc', meta: '1 page', excerpt: 'Saved from this session.' },
      sessionId: session.id,
      sessionTitle: session.title,
      projectId: project?.id,
      projectName: project?.name,
    })
  }

  // ── Attach a connector to the live session ───────────────────────────────
  if (connector && !hasSchedule && /\b(attach|connect)\b/.test(t)) {
    ops.push({
      kind: 'attach-context',
      sessionTitle: session.title,
      connectorId: connector.id,
      connectorLabel: connector.label,
      connectorKind: connector.kind,
    })
  }

  // ── Scope a context to a project ─────────────────────────────────────────
  if (connector && project && /\bscope\b/.test(t)) {
    ops.push({
      kind: 'scope-context',
      projectId: project.id,
      projectName: project.name,
      context: { kind: 'connector', label: connector.label, meta: 'connected' },
    })
  }

  // ── File the session into a project ──────────────────────────────────────
  // Skip when an artifact op already consumed the "file/put it under X" phrasing
  // (a refile, or a save that itself files the new artifact under the project) —
  // otherwise the same words would also propose filing the whole session.
  if (
    !ops.some((o) => o.kind === 'refile-artifact' || o.kind === 'save-artifact') &&
    !hasSchedule &&
    project &&
    /\b(file|move|organi[sz]e|put|belongs?|tidy)\b/.test(t)
  ) {
    ops.push({
      kind: 'file-session',
      sessionId: session.id,
      sessionTitle: session.title,
      projectId: project.id,
      projectName: project.name,
    })
  }

  return ops
}
