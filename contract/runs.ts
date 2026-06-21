/** ── Contract: scheduled runs as sessions ──────────────────────────────────
 *  A scheduled routine doesn't run "somewhere else" — each execution *is* an
 *  agent session. This module synthesizes that session from a run + its routine,
 *  and computes the recent-runs feed. Shared so the server (which owns the live
 *  runs) and the client (which renders them) agree on the shape, and so a run's
 *  session id is deterministic and openable across reloads/devices. */
import type { Connector, Session } from './entities.ts'
import type { ScheduledRun, ScheduledTask } from './cowork.ts'
import { runSessionId } from './ids.ts'

export interface RunSessionEntry {
  task: ScheduledTask
  run: ScheduledRun
  session: Session
}

/** The connectors a run leaned on — its connector/MCP-tone step tools — so the
 *  synthesized session shows the same context chips the workflow used. */
function connectorsFor(task: ScheduledTask): Connector[] {
  const out: Connector[] = []
  for (const s of task.steps) {
    if (s.tool.tone !== 'connector' && s.tool.tone !== 'mcp') continue
    if (out.some((c) => c.id === s.tool.id)) continue
    out.push({ id: s.tool.id, label: s.tool.label, kind: s.tool.tone === 'mcp' ? 'mcp' : 'connector' })
  }
  return out
}

/** Turn one execution into a readable session: the standing instruction it ran,
 *  then Claude's recap of what that run did (or why it stopped / stayed quiet). */
export function buildRunSession(task: ScheduledTask, run: ScheduledRun): Session {
  let recap: string
  if (run.status === 'failed') {
    recap = `Heads up — this run failed. ${run.summary}. I'll retry on the next run once it's resolved.`
  } else if (run.status === 'skipped') {
    recap = `${run.summary}. Nothing needed doing this run, so I left everything as it was.`
  } else {
    recap = `Done — ${run.summary}.\n\nSteps this run:\n${task.steps
      .map((s, i) => `${i + 1}. ${s.action}`)
      .join('\n')}\n\nDelivered to ${task.delivery.target}.`
  }
  return {
    id: runSessionId(task.id, run.id),
    title: `${task.name} · ${run.when}`,
    caps: ['chat'],
    updatedLabel: run.absolute,
    preview: run.summary,
    connectors: connectorsFor(task),
    scheduledRunOf: { taskId: task.id, taskName: task.name },
    messages: [
      { id: 'm1', role: 'user', content: `Scheduled run — ${task.trigger}.\n\n${task.prompt}` },
      { id: 'm2', role: 'assistant', content: recap },
    ],
  }
}

/** Up to the two most-recent runs of each *enabled* routine, merged newest-first
 *  (by `run.at`) and capped — the left rail's "recent runs". */
export function recentEntries(schedules: ScheduledTask[]): RunSessionEntry[] {
  return schedules
    .filter((t) => t.enabled)
    .flatMap((t) => t.runs.slice(0, 2).map((run) => ({ task: t, run, session: buildRunSession(t, run) })))
    .sort((a, b) => a.run.at - b.run.at)
    .slice(0, 8)
}

/** Resolve any run's entry by its session id (searches every run, so a run that
 *  isn't in the recent feed is still openable). */
export function entryById(schedules: ScheduledTask[], sessionId: string): RunSessionEntry | undefined {
  for (const t of schedules) {
    for (const run of t.runs) {
      if (runSessionId(t.id, run.id) === sessionId) return { task: t, run, session: buildRunSession(t, run) }
    }
  }
  return undefined
}
