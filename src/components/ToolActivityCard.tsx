import { AlertCircle, Check, FilePlus2, Pencil, Play, Plug, Send, Trash2, Wrench, X } from 'lucide-react'
import { API_BASE_PATH } from '../../contract/index.ts'
import type { ToolActivity, ToolCardFamily } from '../types'
import { useMe } from '../api'
import {
  enqueueToolActivityDecision,
  heldToolActivityDecisionIntent,
  toolActivityDecisionResourceId,
  useToolActivityDecisionStatus,
} from '../controller/toolActivityDecisionMutations.ts'
import type { RevisionedMutationStatus } from '../controller/revisionedMutationCore.ts'
import { SOFT_BUTTON_CLASS, DANGER_BUTTON_CLASS } from '../lib/button'

/** An account of the tools the model touched this turn: connector/MCP tools (P6)
 *  and the generated API tools (access-parity INV-11 — the in-app leg). A *read*
 *  runs immediately when its runtime is available. An *action* (a write) is
 *  consent-gated: it shows a Confirm / Decline prompt and only runs — server-side,
 *  as the confirmer, audited — on approval. A proposed API action renders through
 *  its shape-derived CARD FAMILY (edit / danger / create / action / post) with the
 *  exact operation it will execute shown verbatim, so the click is informed.
 *  Shares the same card shell as the relation/escalation cards (form follows
 *  function). */
export function ToolActivityCard({ activities, sessionId }: { activities: ToolActivity[]; sessionId: string }) {
  const tenantId = useMe().data?.tenant.id
  const mutation = useToolActivityDecisionStatus()
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-panel-2/30">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Plug size={13} className="text-accent" />
        Tool activity
      </div>
      <div className="divide-y divide-line">
        {activities.map((a, i) => (
          // Prefer the stable activity id (so a row's confirm state survives re-render);
          // fall back to the index for a legacy activity persisted before the id field
          // existed (read-only slice 1) — keeps the key unique either way.
          <ActivityRow
            key={a.id ?? `legacy-${i}`}
            activity={a}
            sessionId={sessionId}
            tenantId={tenantId}
            mutation={mutation}
          />
        ))}
      </div>
    </div>
  )
}

/** The per-family cues: icon + the verb on the confirm button. One map, so a
 *  family can't drift between rows (form follows function). `danger` is the
 *  only destructive styling — red confirm, red icon. */
const FAMILY_CUES: Record<ToolCardFamily, { icon: typeof Pencil; confirm: string; pending: string }> = {
  create: { icon: FilePlus2, confirm: 'Create', pending: 'Creating…' },
  edit: { icon: Pencil, confirm: 'Apply edit', pending: 'Applying…' },
  danger: { icon: Trash2, confirm: 'Confirm delete', pending: 'Deleting…' },
  action: { icon: Play, confirm: 'Run it', pending: 'Running…' },
  post: { icon: Send, confirm: 'Post it', pending: 'Posting…' },
}

function ActivityRow({
  activity: a,
  sessionId,
  tenantId,
  mutation,
}: {
  activity: ToolActivity
  sessionId: string
  tenantId?: string
  mutation: RevisionedMutationStatus
}) {
  const held = heldToolActivityDecisionIntent(sessionId, a.id)
  // Ambient terminal state cannot dismiss an uncertain local decision: keep the
  // exact controls visible until this client's receipt reconciles or is Dismissed.
  const pending = a.kind === 'action' && (a.status === 'proposed' || held !== null)
  const displayStatus = held ? 'proposed' : a.status
  const failed = displayStatus === 'failed'
  const cues = a.family ? FAMILY_CUES[a.family] : undefined
  const danger = a.family === 'danger'
  const Icon = cues?.icon ?? Wrench
  const resourceId = toolActivityDecisionResourceId(sessionId, a.id)
  const refusal = held && mutation.activeResourceId === resourceId ? mutation.error : null

  const resolve = (decision: 'confirm' | 'decline') => {
    if (!tenantId) return
    void enqueueToolActivityDecision({ tenantId, sessionId, activityId: a.id, decision })
  }

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2.5"
      data-tool-activity-decision={held ? 'held' : 'ready'}
      aria-busy={held ? 'true' : undefined}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          failed
            ? 'bg-danger-tint text-danger-strong'
            : displayStatus === 'done' && a.kind === 'action'
            ? 'bg-ok-tint text-ok-strong'
            : displayStatus === 'declined'
              ? 'bg-surface text-ink-faint'
              : danger && pending
                ? 'bg-danger-tint text-danger-strong'
                : 'bg-surface text-ink-soft'
        }`}
      >
        {failed ? <AlertCircle size={14} /> : displayStatus === 'done' && a.kind === 'action' ? <Check size={14} /> : displayStatus === 'declined' ? <X size={14} /> : <Icon size={14} />}
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
            <div className={danger ? 'font-semibold text-danger-strong' : 'font-semibold'}>
              {a.op.method} {API_BASE_PATH}{a.op.path}
            </div>
            {a.op.body !== undefined && <pre className="mt-0.5 whitespace-pre-wrap break-all">{JSON.stringify(a.op.body, null, 1)}</pre>}
          </div>
        )}
        {pending && !a.op && a.input && Object.keys(a.input).length > 0 && (
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            {JSON.stringify(a.input, null, 1)}
          </pre>
        )}
        {refusal && <div className="mt-1 text-[11px] text-danger-strong">{refusal}</div>}

        {pending && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => resolve('confirm')}
              disabled={held !== null || !tenantId}
              className={`px-2.5 py-1 text-[12px] disabled:opacity-50 ${
                danger ? DANGER_BUTTON_CLASS : SOFT_BUTTON_CLASS
              }`}
            >
              {held?.decision === 'confirm' ? (cues?.pending ?? 'Confirming…') : (cues?.confirm ?? 'Confirm')}
            </button>
            <button
              onClick={() => resolve('decline')}
              disabled={held !== null || !tenantId}
              className="rounded-lg px-2 py-1 text-[12px] font-medium text-ink-faint transition hover:text-ink-soft disabled:opacity-50"
            >
              {held?.decision === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div>
        )}
        {displayStatus === 'declined' && <div className="mt-0.5 text-[11px] text-ink-faint">Declined — nothing was done.</div>}
        {failed && (
          <div className="mt-0.5 text-[11px] text-danger-strong">
            {a.failure?.retryable ? 'Try this connector again in a new turn.' : 'Connector setup needs attention before this can run.'}
          </div>
        )}
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
