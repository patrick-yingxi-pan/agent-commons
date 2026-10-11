import { AlertCircle, Check, FilePlus2, Pencil, Play, Plug, Send, Trash2, Wrench, X } from 'lucide-react'
import { API_BASE_PATH } from '../../contract/index.ts'
import type { McpToolContent, McpToolResult } from '../../contract/mcpExecution.ts'
import type { ToolActivity, ToolCardFamily } from '../types'
import { useMe } from '../api'
import { retryToolActivityEligibility } from '../api/toolActivityEligibility.ts'
import { useToolActivityEligibility } from '../api/toolActivityEligibilityHook.ts'
import {
  enqueueToolActivityDecision,
  heldToolActivityDecisionIntent,
  toolActivityDecisionResourceId,
  useToolActivityDecisionStatus,
} from '../controller/toolActivityDecisionMutations.ts'
import type { RevisionedMutationStatus } from '../controller/revisionedMutationCore.ts'
import { SOFT_BUTTON_CLASS, DANGER_BUTTON_CLASS } from '../lib/button'
import { Spinner } from './Spinner.tsx'

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
  const identity = useMe().data
  const tenantId = identity?.tenant.id
  const sourceUserId = identity?.via === 'session' ? identity.user.id : null
  const eligibility = useToolActivityEligibility(sessionId)
  const eligibilityKnown = identity !== undefined && eligibility.status === 'success' && !!eligibility.data
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
            sourceUserId={sourceUserId}
            decisionAllowed={eligibilityKnown && eligibility.data!.decisionActivityIds.includes(a.id)}
            confirmAllowed={eligibilityKnown && eligibility.data!.confirmActivityIds.includes(a.id)}
            eligibilityKnown={eligibilityKnown}
            retryEligibility={identity && eligibility.status === 'error'
              ? () => retryToolActivityEligibility(sessionId, identity.tenant.id, identity.user.id)
              : undefined}
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
const MCP_CUE = { icon: Play, confirm: 'Run tool', pending: 'Running…' }

function ActivityRow({
  activity: a,
  sessionId,
  tenantId,
  sourceUserId,
  decisionAllowed,
  confirmAllowed,
  eligibilityKnown,
  retryEligibility,
  mutation,
}: {
  activity: ToolActivity
  sessionId: string
  tenantId?: string
  sourceUserId: string | null
  decisionAllowed: boolean
  confirmAllowed: boolean
  eligibilityKnown: boolean
  retryEligibility?: () => void
  mutation: RevisionedMutationStatus
}) {
  const held = heldToolActivityDecisionIntent(sessionId, a.id)
  // Ambient terminal state cannot dismiss an uncertain local decision: keep the
  // exact controls visible until this client's receipt reconciles or is Dismissed.
  const mcp = a.mcp
  const externalMcp = mcp !== undefined
  const pending = externalMcp && (a.status === 'proposed' || held !== null) ||
    !externalMcp && a.kind === 'action' && (a.status === 'proposed' || held !== null)
  const displayStatus = held ? 'proposed' : a.status
  const failed = displayStatus === 'failed'
  const uncertain = displayStatus === 'uncertain'
  const running = displayStatus === 'running'
  const successful = displayStatus === 'done' && !a.mcpResult?.isError
  const cues = externalMcp ? MCP_CUE : a.family ? FAMILY_CUES[a.family] : undefined
  const danger = a.family === 'danger'
  const Icon = cues?.icon ?? Wrench
  const resourceId = toolActivityDecisionResourceId(sessionId, a.id)
  const refusal = held && mutation.activeResourceId === resourceId ? mutation.error : null

  const resolve = (decision: 'confirm' | 'decline') => {
    if (!tenantId || !decisionAllowed || (decision === 'confirm' && !confirmAllowed)) return
    void enqueueToolActivityDecision({ tenantId, sourceUserId, sessionId, activityId: a.id, decision })
  }

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2.5"
      data-tool-activity-decision={held ? 'held' : 'ready'}
      data-mcp-tool-status={externalMcp ? displayStatus : undefined}
      aria-busy={held || running ? 'true' : undefined}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          failed
            ? 'bg-danger-tint text-danger-strong'
            : uncertain
              ? 'bg-warn-tint text-warn-text'
            : successful && (a.kind === 'action' || externalMcp)
            ? 'bg-ok-tint text-ok-strong'
            : displayStatus === 'declined'
              ? 'bg-surface text-ink-faint'
              : danger && pending
                ? 'bg-danger-tint text-danger-strong'
                : 'bg-surface text-ink-soft'
        }`}
      >
        {running ? <Spinner size={14} /> : failed || uncertain ? <AlertCircle size={14} /> : successful && (a.kind === 'action' || externalMcp) ? <Check size={14} /> : displayStatus === 'declined' ? <X size={14} /> : <Icon size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug text-ink">
          <span className="font-medium">{a.connector}</span>
          <span className="break-words font-mono text-[12px] text-ink-faint [overflow-wrap:anywhere]"> · {mcp ? mcp.toolName : shortTool(a.tool)}</span>
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">{a.summary}</div>

        {pending && mcp && <div className="mt-1 text-[11px] leading-snug text-ink-faint">
          Approval applies only to this call · catalog revision {mcp.connectionRevision}
        </div>}

        {/* The exact operation a proposed API action will execute — shown
            verbatim so the confirm is informed consent, not trust. */}
        {pending && a.op && (
          <div className="mt-1.5 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            <div className={danger ? 'font-semibold text-danger-text' : 'font-semibold'}>
              {a.op.method} {API_BASE_PATH}{a.op.path}
            </div>
            {a.op.body !== undefined && <pre className="mt-0.5 whitespace-pre-wrap break-all">{JSON.stringify(a.op.body, null, 1)}</pre>}
          </div>
        )}
        {pending && !a.op && a.input && (externalMcp || Object.keys(a.input).length > 0) && (
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            {JSON.stringify(a.input, null, 1)}
          </pre>
        )}
        {refusal && <div className="mt-1 text-[11px] text-danger-text">{refusal}</div>}

        {pending && (
          decisionAllowed || held ? <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => resolve('confirm')}
              disabled={held !== null || !tenantId || !decisionAllowed || !confirmAllowed}
              title={!confirmAllowed && mcp ? 'This exact connection is no longer available for confirmation.' : undefined}
              className={`px-2.5 py-1 text-[12px] disabled:opacity-50 ${
                danger ? DANGER_BUTTON_CLASS : SOFT_BUTTON_CLASS
              }`}
            >
              {held?.decision === 'confirm' ? (cues?.pending ?? 'Confirming…') : (cues?.confirm ?? 'Confirm')}
            </button>
            <button
              onClick={() => resolve('decline')}
              disabled={held !== null || !tenantId || !decisionAllowed}
              className="rounded-lg px-2 py-1 text-[12px] font-medium text-ink-faint transition hover:text-ink-soft disabled:opacity-50"
            >
              {held?.decision === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div> : <div className="mt-1.5 text-[11px] text-ink-faint">
            {!eligibilityKnown && retryEligibility
              ? <button className="underline underline-offset-2" onClick={retryEligibility}>Couldn’t check decision access · Retry</button>
              : eligibilityKnown ? 'Decision controls are unavailable to this account.' : 'Checking decision access…'}
          </div>
        )}
        {running && <div role="status" className="mt-1 text-[11px] text-ink-soft">Approved. Waiting for the external server…</div>}
        {displayStatus === 'declined' && <div className="mt-0.5 text-[11px] text-ink-faint">{externalMcp ? 'Declined — the external tool was not run.' : 'Declined — nothing was done.'}</div>}
        {uncertain && <div role="alert" className="mt-1 text-[11px] leading-snug text-warn-text">
          The tool may have run, but no result was confirmed. It won’t be retried automatically.
        </div>}
        {externalMcp && a.mcpResult && (displayStatus === 'done' || failed) && <McpResultBody result={a.mcpResult} />}
        {failed && externalMcp && <div className="mt-1 text-[11px] text-danger-text">
          {a.mcpResult?.isError
            ? 'The external server reported an error result. No successful effect is claimed.'
            : 'The tool was not submitted, so no external effect was started.'}
        </div>}
        {failed && !externalMcp && (
          <div className="mt-0.5 text-[11px] text-danger-text">
            {a.failure?.retryable ? 'Try this connector again in a new turn.' : 'Connector setup needs attention before this can run.'}
          </div>
        )}
      </div>
    </div>
  )
}

function McpResultBody({ result }: { result: McpToolResult }) {
  const visible = result.content.length > 0 || result.structuredContent !== undefined
  return <div className={`mt-2 min-w-0 rounded-lg border p-2.5 ${result.isError ? 'border-danger/30 bg-danger-tint/40' : 'border-line bg-surface'}`}>
    <p className={`text-[11px] font-semibold ${result.isError ? 'text-danger-text' : 'text-ink'}`}>
      {result.isError ? 'Server-reported error' : 'Tool result'}
    </p>
    {!visible && <p className="mt-1 text-[11px] text-ink-faint">The server returned no displayable content.</p>}
    <div className="mt-1.5 space-y-2">{result.content.map((content, index) =>
      <McpResultContent key={index} content={content} />)}</div>
    {result.structuredContent !== undefined && <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Structured result</p>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-panel-2 p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
        {JSON.stringify(result.structuredContent, null, 2)}
      </pre>
    </div>}
  </div>
}

function McpResultContent({ content }: { content: McpToolContent }) {
  if (content.type === 'text') {
    return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-ink [overflow-wrap:anywhere]">{content.text}</pre>
  }
  if (content.type === 'image' || content.type === 'audio') {
    return <p className="break-words text-[11px] text-ink-faint [overflow-wrap:anywhere]">Media omitted · {content.type} · {content.mimeType}</p>
  }
  if (content.type === 'resource_link') {
    return <div className="text-[11px] leading-relaxed text-ink-faint">
      <p className="font-medium text-ink-soft">Resource link omitted · {content.name}</p>
      <p className="break-words font-mono [overflow-wrap:anywhere]">{content.uri}</p>
      {content.mimeType && <p>{content.mimeType}{content.size === undefined ? '' : ` · ${content.size} bytes`}</p>}
    </div>
  }
  return <div className="text-[11px] leading-relaxed text-ink-faint">
    <p className="font-medium text-ink-soft">Resource content omitted</p>
    <p className="break-words font-mono [overflow-wrap:anywhere]">{content.resource.uri}</p>
    {content.resource.mimeType && <p>{content.resource.mimeType}</p>}
  </div>
}

/** The bare tool name for display — drop the `mcp__slug__` / `connector__slug__`
 *  routing prefix, and the generated tools' `api__` namespace. */
function shortTool(tool: string): string {
  const parts = tool.split('__')
  if (parts[0] === 'api' && parts.length >= 2) return parts.slice(1).join('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
}
