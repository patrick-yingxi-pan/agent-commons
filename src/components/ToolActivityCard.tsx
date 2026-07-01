import { useState } from 'react'
import { Check, Plug, Wrench, X } from 'lucide-react'
import type { ToolActivity } from '../types'
import { resolveToolActivity } from '../api/commands'

/** An account of the connector/MCP tools the model touched this turn (P6). A *read*
 *  ran immediately (shown as done). An *action* (a write) is consent-gated: it shows a
 *  Confirm / Decline prompt and only runs — server-side, audited — on approval. Shares
 *  the same card shell as the relation/escalation cards (form follows function). */
export function ToolActivityCard({ activities, sessionId }: { activities: ToolActivity[]; sessionId: string }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-panel-2/30 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Plug size={13} className="text-accent" />
        Connected tools
      </div>
      <div className="divide-y divide-line">
        {activities.map((a, i) => (
          // Prefer the stable activity id (so a row's confirm state survives re-render);
          // fall back to the index for a legacy activity persisted before the id field
          // existed (read-only slice 1) — keeps the key unique either way.
          <ActivityRow key={a.id ?? `legacy-${i}`} activity={a} sessionId={sessionId} />
        ))}
      </div>
    </div>
  )
}

function ActivityRow({ activity, sessionId }: { activity: ToolActivity; sessionId: string }) {
  // Optimistic local state: the open thread renders from controller state, not the query
  // cache, so we reflect the resolved activity here on confirm/decline (the server also
  // persists it — a later reopen refetches the done/declined status).
  const [resolved, setResolved] = useState<ToolActivity | null>(null)
  const [busy, setBusy] = useState(false)
  const a = resolved ?? activity
  const pending = a.kind === 'action' && a.status === 'proposed'

  const resolve = async (decision: 'confirm' | 'decline') => {
    setBusy(true)
    try {
      setResolved(await resolveToolActivity(sessionId, a.id, decision))
    } catch {
      setBusy(false) // leave it proposed so the user can retry
    }
  }

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          a.status === 'done' && a.kind === 'action'
            ? 'bg-emerald-50 text-emerald-600'
            : a.status === 'declined'
              ? 'bg-surface text-ink-faint'
              : 'bg-surface text-ink-soft'
        }`}
      >
        {a.status === 'done' && a.kind === 'action' ? <Check size={14} /> : a.status === 'declined' ? <X size={14} /> : <Wrench size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug text-ink">
          <span className="font-medium">{a.connector}</span>
          <span className="text-ink-faint"> · {shortTool(a.tool)}</span>
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">{a.summary}</div>

        {pending && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => resolve('confirm')}
              disabled={busy}
              className="rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-strong disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => resolve('decline')}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-[12px] font-medium text-ink-faint transition hover:text-ink-soft disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        )}
        {a.status === 'declined' && <div className="mt-0.5 text-[11px] text-ink-faint">Declined — nothing was done.</div>}
      </div>
    </div>
  )
}

/** The bare tool name for display — drop the `mcp__slug__` / `connector__slug__` prefix. */
function shortTool(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
}
