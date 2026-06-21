import type { Connector, Session } from '../types'
import { SCHEDULED_TASKS, type ScheduledRun, type ScheduledTask } from './cowork'

/** ── Scheduled runs as sessions ──────────────────────────────────────────────
 *  A scheduled routine doesn't run "somewhere else" — each execution *is* an
 *  agent session: Claude runs the workflow's steps and delivers the result. So
 *  the left rail's "Scheduled" list shows recent *runs*, and opening one opens
 *  the session that run executed in (not the Scheduled page). We synthesize that
 *  session from the run + its routine — no per-run hand-authoring, so it scales
 *  to every run. */

export interface RunSessionEntry {
  task: ScheduledTask
  run: ScheduledRun
  session: Session
}

/** Stable id for a run's session, recognizable by the controller's lookup. */
const runSessionId = (task: ScheduledTask, run: ScheduledRun) => `srun-${task.id}-${run.id}`

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
    id: runSessionId(task, run),
    title: `${task.name} · ${run.when}`,
    caps: ['chat'],
    updatedLabel: run.absolute,
    preview: run.summary,
    connectors: connectorsFor(task),
    messages: [
      { id: 'm1', role: 'user', content: `Scheduled run — ${task.trigger}.\n\n${task.prompt}` },
      { id: 'm2', role: 'assistant', content: recap },
    ],
  }
}

/** Up to the two most-recent runs of each *enabled* routine, merged newest-first
 *  (by `run.at`) and capped — the left rail's "recent runs". Computed once, so a
 *  clicked run resolves to the same session object every time. */
export const RECENT_RUNS: RunSessionEntry[] = SCHEDULED_TASKS.filter((t) => t.enabled)
  .flatMap((t) => t.runs.slice(0, 2).map((run) => ({ task: t, run, session: buildRunSession(t, run) })))
  .sort((a, b) => a.run.at - b.run.at)
  .slice(0, 8)

const BY_ID = new Map(RECENT_RUNS.map((e) => [e.session.id, e]))

/** The run session for an id the rail linked to (or undefined for a normal id). */
export function runSessionById(id: string): Session | undefined {
  return BY_ID.get(id)?.session
}

/** The full run entry (task + run + session) for a session id — lets the session
 *  page show which routine it belongs to and link back to it. */
export function runEntryById(id: string): RunSessionEntry | undefined {
  return BY_ID.get(id)
}
