import type { RelationGraph, ScheduledStanding, ScheduledTask, StepTool } from '../contract/index.ts'
import { parseScheduledArtifactSpec } from '../contract/scheduledArtifact.ts'

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Keys predate structured approval records. Callers must reject ambiguous
 * matches against live routine ids rather than guessing an owner by prefix. */
export function scheduleApprovalKeyMatches(key: string, scheduleId: string): boolean {
  if (key.startsWith('set-schedule-output:')) {
    try {
      const tuple: unknown = JSON.parse(key.slice('set-schedule-output:'.length))
      return Array.isArray(tuple) && tuple.length === 3 && tuple[0] === scheduleId &&
        parseScheduledArtifactSpec({ name: tuple[1], kind: tuple[2] }) !== undefined &&
        key === `set-schedule-output:${JSON.stringify(tuple)}`
    } catch {
      return false
    }
  }
  return key === `set-schedule-session:${scheduleId}` ||
    key.startsWith(`set-schedule-artifact:${scheduleId}:`) ||
    key.startsWith(`schedule-add-tool:${scheduleId}:`)
}

/** Upgrade old deletion residue before admitting requests. A missing routine
 * cannot own standing authority, even if a later keyed create reuses its id. */
export function pruneOrphanScheduleStanding(
  graph: RelationGraph,
  schedules: readonly Pick<ScheduledTask, 'id' | 'tenantId'>[],
  defaultTenant: string,
): { graph: RelationGraph; changed: boolean } {
  let changed = false
  const ids = new Set(schedules.map((task) => task.id))
  const prune = <T>(map: Record<string, T>): Record<string, T> => Object.fromEntries(
    Object.entries(map).filter(([id]) => {
      if (ids.has(id)) return true
      changed = true
      return false
    }),
  )
  const scheduleProject = prune(graph.scheduleProject)
  const scheduleArtifact = prune(graph.scheduleArtifact)
  const scheduleSession = prune(graph.scheduleSession)
  const scheduleExtraTools = prune(graph.scheduleExtraTools)
  const standingApprovals = Object.fromEntries(Object.entries(graph.standingApprovals).filter(([key]) => {
    const routineKey = ['set-schedule-session:', 'set-schedule-artifact:', 'set-schedule-output:', 'schedule-add-tool:'].some((prefix) => key.startsWith(prefix))
    if (!routineKey || schedules.some((task) => scheduleApprovalKeyMatches(key, task.id))) return true
    changed = true
    return false
  }))
  const extraArtifacts = graph.extraArtifacts.map((artifact) => {
    if (artifact.sourceScheduleId === undefined || schedules.some((task) => task.id === artifact.sourceScheduleId &&
        (task.tenantId ?? defaultTenant) === (artifact.tenantId ?? defaultTenant))) return artifact
    changed = true
    const { sourceScheduleId: _binding, ...independent } = artifact
    return independent
  })
  return { changed, graph: changed ? { ...graph, scheduleProject, scheduleArtifact, scheduleSession,
    scheduleExtraTools, standingApprovals, extraArtifacts, revision: (graph.revision ?? 0) + 1 } : graph }
}

/** Shared by queue capture and snapshot admission. A present malformed value
 * is not a legacy omission. Return a detached value without inferred fields. */
export function parseScheduleStanding(value: unknown): ScheduledStanding | undefined {
  if (!record(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'tools') || !Array.isArray(value.tools)) return undefined
  const oldShape = Object.hasOwn(value, 'artifactName') && !Object.hasOwn(value, 'artifact')
  const newShape = Object.hasOwn(value, 'artifact') && !Object.hasOwn(value, 'artifactName')
  if (!oldShape && !newShape) return undefined
  const rawArtifact = oldShape ? value.artifactName : value.artifact
  if (oldShape && rawArtifact !== null && typeof rawArtifact !== 'string') return undefined
  if (newShape && rawArtifact !== null && !record(rawArtifact)) return undefined
  const artifact = rawArtifact === null ? null : parseScheduledArtifactSpec(rawArtifact)
  if (artifact === undefined) return undefined
  const tools: StepTool[] = []
  for (const tool of value.tools) {
    if (!record(tool) || !['id', 'label', 'tone'].every((field) => Object.hasOwn(tool, field)) ||
        Object.keys(tool).some((field) => !['id', 'label', 'tone', 'needsAuth'].includes(field)) ||
        typeof tool.id !== 'string' || !tool.id.trim() || typeof tool.label !== 'string' || !tool.label.trim() ||
        typeof tool.tone !== 'string' || !['connector', 'mcp', 'repo', 'workspace', 'web', 'claude'].includes(tool.tone) ||
        (Object.hasOwn(tool, 'needsAuth') && typeof tool.needsAuth !== 'boolean')) return undefined
    tools.push({ id: tool.id, label: tool.label, tone: tool.tone as StepTool['tone'],
      ...(typeof tool.needsAuth === 'boolean' ? { needsAuth: tool.needsAuth } : {}) })
  }
  return { artifact, tools }
}

/** A run can lose an approval, never acquire one after queuing. Additional live
 * approvals are irrelevant to this run; exact removal/change is a refusal. */
export function scheduleStandingFailure(
  scheduleId: string,
  standing: ScheduledStanding | undefined,
  graph: RelationGraph,
): string | undefined {
  const rawArtifact = graph.scheduleArtifact[scheduleId]
  const artifact = rawArtifact === undefined ? null : parseScheduledArtifactSpec(rawArtifact)
  const tools = graph.scheduleExtraTools[scheduleId] ?? []
  if (artifact === undefined) return 'This routine’s standing artifact approval is invalid. Update it before starting a run.'
  if (standing === undefined) {
    return artifact !== null || tools.length > 0
      ? 'This queued run has no saved standing-approval snapshot. Start a new run to use the current approvals.'
      : undefined
  }
  if ((standing.artifact !== null && (artifact === null || standing.artifact.name !== artifact.name || standing.artifact.kind !== artifact.kind)) ||
      standing.tools.some((approved) => !tools.some((current) =>
        approved.id === current.id && approved.label === current.label && approved.tone === current.tone &&
        approved.needsAuth === current.needsAuth))) {
    return 'This routine’s standing approvals changed after this run was queued. Start a new run to use the current approvals; its saved artifact was not changed.'
  }
  return undefined
}
