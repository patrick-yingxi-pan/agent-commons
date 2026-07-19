import { useState } from 'react'
import { Check, FilePlus2, Pencil, Play, Plug, Send, Trash2, Wrench, X } from 'lucide-react'
import type { ToolActivity, ToolCardFamily } from '../types'
import { resolveToolActivity } from '../api/commands'

/** An account of the tools the model touched this turn: connector/MCP tools (P6)
 *  and the generated API tools (access-parity INV-11 — the in-app leg). A *read*
 *  ran immediately (shown as done — the provenance row). An *action* (a write) is
 *  consent-gated: it shows a Confirm / Decline prompt and only runs — server-side,
 *  as the confirmer, audited — on approval. A proposed API action renders through
 *  its shape-derived CARD FAMILY (edit / danger / create / action / post) with the
 *  exact operation it will execute shown verbatim, so the click is informed.
 *  Shares the same card shell as the relation/escalation cards (form follows
 *  function). */
export function ToolActivityCard({ activities, sessionId }: { activities: ToolActivity[]; sessionId: string }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-panel-2/30 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Plug size={13} className="text-accent" />
        Tool activity
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

/** The per-family cues: icon + the verb on the confirm button. One map, so a
 *  family can't drift between rows (form follows function). `danger` is the
 *  only destructive styling — red confirm, red icon. */
const FAMILY_CUES: Record<ToolCardFamily, { icon: typeof Pencil; confirm: string }> = {
  create: { icon: FilePlus2, confirm: 'Create' },
  edit: { icon: Pencil, confirm: 'Apply edit' },
  danger: { icon: Trash2, confirm: 'Confirm delete' },
  action: { icon: Play, confirm: 'Run it' },
  post: { icon: Send, confirm: 'Post it' },
}

function ActivityRow({ activity, sessionId }: { activity: ToolActivity; sessionId: string }) {
  // Optimistic local state: the open thread renders from controller state, not the query
  // cache, so we reflect the resolved activity here on confirm/decline (the server also
  // persists it — a later reopen refetches the done/declined status).
  const [resolved, setResolved] = useState<ToolActivity | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const a = resolved ?? activity
  const pending = a.kind === 'action' && a.status === 'proposed'
  const cues = a.family ? FAMILY_CUES[a.family] : undefined
  const danger = a.family === 'danger'
  const Icon = cues?.icon ?? Wrench

  const resolve = async (decision: 'confirm' | 'decline') => {
    setBusy(true)
    setRefusal(null)
    try {
      setResolved(await resolveToolActivity(sessionId, a.id, decision))
    } catch (err) {
      // A refused confirm (the inner operation said no — 409) leaves the
      // proposal OPEN server-side; surface the reason and let both verbs stand.
      setRefusal(err instanceof Error ? err.message : 'The operation was refused — try again or decline.')
      setBusy(false)
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
              : danger && pending
                ? 'bg-red-50 text-red-600'
                : 'bg-surface text-ink-soft'
        }`}
      >
        {a.status === 'done' && a.kind === 'action' ? <Check size={14} /> : a.status === 'declined' ? <X size={14} /> : <Icon size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug text-ink">
          <span className="font-medium">{a.connector}</span>
          <span className="text-ink-faint"> · {shortTool(a.tool)}</span>
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">{a.summary}</div>

        {/* The exact operation a proposed API action will execute — shown
            verbatim so the confirm is informed consent, not trust. */}
        {pending && a.op && (
          <div className="mt-1.5 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            <div className={danger ? 'font-semibold text-red-600' : 'font-semibold'}>
              {a.op.method} /api/v1{a.op.path}
            </div>
            {a.op.body !== undefined && <pre className="mt-0.5 whitespace-pre-wrap break-all">{JSON.stringify(a.op.body, null, 1)}</pre>}
          </div>
        )}
        {refusal && <div className="mt-1 text-[11px] text-red-600">{refusal}</div>}

        {pending && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => resolve('confirm')}
              disabled={busy}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-strong'
              }`}
            >
              {cues?.confirm ?? 'Confirm'}
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

/** The bare tool name for display — drop the `mcp__slug__` / `connector__slug__`
 *  routing prefix, and the generated tools' `api__` namespace. */
function shortTool(tool: string): string {
  const parts = tool.split('__')
  if (parts[0] === 'api' && parts.length >= 2) return parts.slice(1).join('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
}
