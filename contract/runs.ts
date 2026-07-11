/** ── Contract: scheduled runs as sessions ──────────────────────────────────
 *  A scheduled routine doesn't run "somewhere else" — each execution *is* an
 *  agent session, a first-class persisted Session row minted through the same
 *  funnel as a human-created one (differing only in the initiator stamp,
 *  `scheduledRunOf`). This module holds the pieces both ends must agree on:
 *  the run's message *content* (the prompt it ran + the recap it produced) and
 *  the recent-runs feed selection. The server materializes the rows
 *  (store.ensureRunSession); nothing synthesizes a Session at read time. */
import type { Connector, Session } from './entities.ts'
import type { ScheduledRun, ScheduledTask } from './cowork.ts'

export interface RunSessionEntry {
  task: ScheduledTask
  run: ScheduledRun
  /** The run's persisted session row (the server injects it — the one source the
   *  by-id read also serves, so a rename shows identically in feed and thread). */
  session: Session
}

/** The connectors a run leaned on — its connector/MCP-tone step tools — so the
 *  run's session shows the same context chips the workflow used. */
export function connectorsFor(task: ScheduledTask): Connector[] {
  const out: Connector[] = []
  for (const s of task.steps) {
    if (s.tool.tone !== 'connector' && s.tool.tone !== 'mcp') continue
    if (out.some((c) => c.id === s.tool.id)) continue
    out.push({ id: s.tool.id, label: s.tool.label, kind: s.tool.tone === 'mcp' ? 'mcp' : 'connector' })
  }
  return out
}

/** The user turn a run's session opens with: the standing instruction it ran. */
export function runPrompt(task: ScheduledTask): string {
  return `Scheduled run — ${task.trigger}.\n\n${task.prompt}`
}

/** Claude's recap of what a settled run did (or why it stopped / stayed quiet).
 *  Each run carries its own `detail` (the output it produced), so two runs of the
 *  same routine read as distinct history rather than the same templated recap;
 *  a run without one falls back to a recap generated from its steps + summary.
 *  The run's own when/duration are stamped in either way. */
export function runRecap(task: ScheduledTask, run: ScheduledRun): string {
  const stamp = run.duration && run.duration !== '—' ? `ran in ${run.duration}` : 'just now'
  if (run.status === 'failed') {
    // Name the step it stopped at, so a failed run reads as a specific incident.
    const failedStep = task.steps[run.reachedStep]
    return (
      `Heads up — this run failed (${stamp}). ${run.summary}.` +
      (failedStep ? `\n\nIt stopped at step ${run.reachedStep + 1}, “${failedStep.action}”, so nothing after it ran.` : '') +
      (run.detail ? `\n\n${run.detail}` : '') +
      `\n\nI'll retry on the next scheduled run once it's cleared.`
    )
  }
  if (run.status === 'skipped') {
    return `${run.summary} (${stamp}).` + (run.detail ? `\n\n${run.detail}` : '\n\nThe trigger condition wasn’t met, so I left everything as it was.')
  }
  const body = run.detail ?? task.steps.map((s, i) => `${i + 1}. ${s.action}`).join('\n')
  return `Done — ${run.summary} (${stamp}).\n\n${body}\n\nDelivered to ${task.delivery.target}.`
}

/** Up to the two most-recent runs of each *enabled* routine, merged newest-first
 *  (by `run.at`) and capped — the selection behind the "recent runs" feed. Pure
 *  selection; the server pairs each ref with its persisted session row. */
export function recentEntries(schedules: ScheduledTask[]): { task: ScheduledTask; run: ScheduledRun }[] {
  return schedules
    .filter((t) => t.enabled)
    .flatMap((t) => t.runs.slice(0, 2).map((run) => ({ task: t, run })))
    .sort((a, b) => b.run.at - a.run.at)
    .slice(0, 8)
}
