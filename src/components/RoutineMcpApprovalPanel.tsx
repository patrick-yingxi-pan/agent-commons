import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, RefreshCw, Shield, X } from 'lucide-react'
import type { McpJsonValue } from '../../contract/mcpExecution.ts'
import type { RoutineMcpApprovalIntent } from '../../contract/routineMcp.ts'
import type { RoutineMcpDecisionRequest, RoutineMcpReview } from '../../contract/routineMcpApi.ts'
import { ROUTINE_MCP_MAX_CALLS, ROUTINE_MCP_MAX_LIFETIME_MS, ROUTINE_MCP_MAX_TOOLS } from '../../contract/routineMcp.ts'
import { refreshRoutineMcpReview, useRoutineMcpReview } from '../api/routineMcpHooks.ts'
import { enqueueRoutineMcpMutation, dismissRoutineMcpMutation, isRoutineMcpHeld, retryRoutineMcpMutation, routineMcpHeldDecision, useRoutineMcpMutationStatus } from '../controller/routineMcpMutations.ts'
import { CheckboxRow } from './Checkbox.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { routineMcpApprovalIntent, routineMcpRunLabel } from '../lib/routineMcpPresentation.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { namedReadRegionProps } from '../lib/dialog.ts'
import { routineMcpReviewReadErrorKind } from '../api/routineMcpReadErrors.ts'

type ToolChoice = RoutineMcpReview['tools'][number]
type DraftTool = { selected: boolean; fixedText: string }
type ReviewedApproval = RoutineMcpApprovalIntent & { disclosures: string[]; labels: Record<string, string> }
const inputClass = 'w-full min-w-0 rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'
const buttonDisabled = 'disabled:cursor-not-allowed disabled:opacity-50'
const text = (value: unknown) => JSON.stringify(value, null, 2)
const dateValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
const fmtDate = (value: number) => new Date(value).toLocaleString()
const toolId = (connectionId: string, toolName: string) => `${connectionId}\u0000${toolName}`

function keyOf(tool: ToolChoice) { return `${tool.connectionId}\u0000${tool.tool.name}\u0000${tool.schemaHash}` }
function fixedArguments(value: string): Record<string, McpJsonValue> | null {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, McpJsonValue>
  } catch { return null }
}
function parseJson(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function RoutineMcpApprovalPanel({ routineId, routineName }: { routineId: string; routineName: string }) {
  const query = useRoutineMcpReview(routineId)
  const reviewUnavailable = query.error && routineMcpReviewReadErrorKind(query.error) === 'unavailable'
  const status = useRoutineMcpMutationStatus()
  const held = isRoutineMcpHeld(routineId)
  const heldDecision = routineMcpHeldDecision(routineId)
  const review = query.data
  const policyApproval = review?.policy.approval
  const [drafts, setDrafts] = useState<Record<string, DraftTool>>({})
  const [expiry, setExpiry] = useState(() => dateValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)))
  const [calls, setCalls] = useState('5')
  const [reviewing, setReviewing] = useState<ReviewedApproval | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  const ownMutation = status.activeResourceId === routineId
  const selected = useMemo(() => review?.tools.filter((tool) => drafts[keyOf(tool)]?.selected) ?? [], [review, drafts])
  const approvalCurrent = !!policyApproval && !!review?.active && policyApproval.expiresAt > now

  const updateDraft = (tool: ToolChoice, update: Partial<DraftTool>) => {
    const key = keyOf(tool)
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { selected: false, fixedText: '{}' }), ...update } }))
  }
  const beginReview = () => {
    setLocalError(null)
    if (!review || selected.length === 0) return setLocalError('Select at least one exact tool to review.')
    if (review.disclosures.length === 0) return setLocalError('The current destination and audience disclosure is unavailable. Refresh the review before approving.')
    if (selected.length > ROUTINE_MCP_MAX_TOOLS) return setLocalError(`Choose up to ${ROUTINE_MCP_MAX_TOOLS} exact tools.`)
    const maxCallsPerRun = Number(calls)
    const expiresAt = new Date(expiry).getTime()
    if (!Number.isInteger(maxCallsPerRun) || maxCallsPerRun < 1 || maxCallsPerRun > ROUTINE_MCP_MAX_CALLS) return setLocalError(`Choose 1 to ${ROUTINE_MCP_MAX_CALLS} calls per run.`)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + ROUTINE_MCP_MAX_LIFETIME_MS) return setLocalError('Choose an expiry within the next 30 days.')
    const tools = []
    for (const choice of selected) {
      const args = fixedArguments(drafts[keyOf(choice)]?.fixedText ?? '{}')
      if (!args) return setLocalError(`${choice.tool.title ?? choice.tool.name}: fixed values must be a JSON object.`)
      const properties = choice.tool.inputSchema.properties
      if (parseJson(properties) && Object.keys(args).some((name) => !(name in properties))) return setLocalError(`${choice.tool.title ?? choice.tool.name}: a fixed value does not match a top-level schema field.`)
      tools.push({ connectionId: choice.connectionId, connectionRevision: choice.connectionRevision, toolName: choice.tool.name, schemaHash: choice.schemaHash, fixedArguments: args })
    }
    setReviewing({ expectedRevision: review.policy.revision, expectedDefinitionRevision: review.definitionRevision, reviewHash: review.reviewHash, expiresAt, maxCallsPerRun, tools, disclosures: [...review.disclosures], labels: Object.fromEntries(review.tools.map((item) => [toolId(item.connectionId, item.tool.name), item.connectionLabel])) })
  }
  const send = async (request: RoutineMcpDecisionRequest) => {
    setLocalError(null)
    setNotice(null)
    const result = enqueueRoutineMcpMutation(routineId, request)
    if (!result) { setLocalError('Wait for the signed-in account to finish loading before changing MCP approval.'); return }
    setSending(true)
    const outcome = await result
    setSending(false)
    if (outcome === 'applied') {
      setReviewing(null)
      setNotice(request.action === 'approve' ? 'Approval saved. Current policy is server-confirmed.' : 'Approval revoked. Current policy is server-confirmed.')
    }
  }
  const approve = () => {
    if (!reviewing || held) return
    if (!review || review.policy.revision !== reviewing.expectedRevision || review.definitionRevision !== reviewing.expectedDefinitionRevision || review.reviewHash !== reviewing.reviewHash || reviewing.expiresAt <= Date.now() || reviewing.tools.some((tool) => !review.tools.some((item) => item.connectionId === tool.connectionId && item.connectionRevision === tool.connectionRevision && item.tool.name === tool.toolName && item.schemaHash === tool.schemaHash))) {
      setReviewing(null)
      setLocalError('The routine or tool review changed. Refresh and review the approval again before saving.')
      return
    }
    void send({ requestId: crypto.randomUUID(), action: 'approve', approval: routineMcpApprovalIntent(reviewing) })
  }
  const revoke = () => {
    if (!review || held) return
    void send({ requestId: crypto.randomUUID(), action: 'revoke', expectedRevision: review.policy.revision })
  }

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5" aria-labelledby={`routine-mcp-${routineId}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft"><Shield size={16} /></span>
        <div className="min-w-0 flex-1">
          <h2 id={`routine-mcp-${routineId}`} className="text-[15px] font-semibold text-ink">External MCP</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">Choose exact tools this routine may call without asking each time. This is separate from the routine’s Context &amp; tools setup.</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">Set the routine’s enabled or paused state before reviewing approval. Changing that state later requires a fresh review. If an external call has an uncertain outcome, the routine pauses; re-enable it and review again before another run.</p>
        </div>
      </div>

      {query.error && !review && (reviewUnavailable
        ? <p role="status" className="mt-4 text-[12px] text-ink-soft">MCP settings are unavailable for this Routine in the current account.</p>
        : <InlineOperationStatus tone="alert" message="Couldn’t load the current MCP review." action={{ label: 'Retry read', onClick: () => refreshRoutineMcpReview(routineId) }} />)}
      {query.status === 'loading' && !review && <p role="status" className="mt-4 text-[12px] text-ink-soft">Loading the owner-only MCP review…</p>}
      {review && !reviewUnavailable && <>
        <div className="mt-4 rounded-lg border border-line bg-panel p-3">
          <p className="text-[13px] font-medium text-ink">{approvalCurrent ? 'Approval active' : policyApproval && policyApproval.expiresAt <= now ? 'Approval expired' : 'No unattended MCP tools'}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">{approvalCurrent
            ? `${policyApproval!.tools.length} exact ${policyApproval!.tools.length === 1 ? 'tool' : 'tools'} · up to ${policyApproval!.maxCallsPerRun} calls per run · expires ${fmtDate(policyApproval!.expiresAt)}`
            : 'Routine runs cannot call external MCP tools until you review and approve them here.'}</p>
          {approvalCurrent && review.policy.approval && <div className="mt-2 space-y-1">{review.policy.approval.tools.map((tool) => (
            <p key={`${tool.connectionId}:${tool.toolName}`} className="break-words text-[12px] text-ink">{tool.toolName} <span className="text-ink-faint">via {review.tools.find((item) => item.connectionId === tool.connectionId)?.connectionLabel ?? 'external MCP'}</span></p>
          ))}</div>}
        </div>

        {!reviewing && !approvalCurrent && <>
          <div className="mt-4 space-y-3">
            {review.tools.length === 0 ? <p className="text-[12px] text-ink-faint">No currently available external MCP tools were returned for review.</p> : review.tools.map((choice) => {
              const key = keyOf(choice)
              const draft = drafts[key] ?? { selected: false, fixedText: '{}' }
              return <article key={key} className="min-w-0 rounded-lg border border-line p-3">
                <CheckboxRow checked={draft.selected} disabled={held || (!draft.selected && selected.length >= ROUTINE_MCP_MAX_TOOLS)} onToggle={() => updateDraft(choice, { selected: !draft.selected })} className="w-full min-w-0">
                  <span className="min-w-0"><span className="block break-words text-[13px] font-medium text-ink">{choice.tool.title ?? choice.tool.name}</span><span className="mt-0.5 block break-words text-[11px] text-ink-soft">{choice.connectionLabel} · {choice.tool.name}</span></span>
                </CheckboxRow>
                {choice.tool.description && <p className="mt-2 break-words text-[12px] leading-relaxed text-ink-soft">{choice.tool.description}</p>}
                <details className="mt-2 min-w-0">
                  <summary className="cursor-pointer text-[11px] font-medium text-ink-soft">Input schema</summary>
                  <pre {...namedReadRegionProps(`Input schema for ${choice.tool.title ?? choice.tool.name}`, 'routine-mcp')} className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-panel-2 p-2 text-[10px] leading-relaxed text-ink">{text(choice.tool.inputSchema)}</pre>
                </details>
                {draft.selected && <label className="mt-3 block min-w-0 text-[11px] font-medium text-ink-soft">Fixed top-level JSON values<textarea value={draft.fixedText} onChange={(event) => updateDraft(choice, { fixedText: event.target.value })} disabled={held} rows={3} spellCheck={false} className={`${inputClass} mt-1.5 font-mono`} aria-label={`Fixed values for ${choice.tool.title ?? choice.tool.name}`} /><span className="mt-1 block font-normal leading-relaxed text-ink-faint">{'{}'} fixes no values. Any supplied value is fixed exactly; remaining fields stay subject to the tool schema.</span></label>}
              </article>
            })}
          </div>
          {review.tools.length > 0 && <div className="mt-4 grid min-w-0 grid-cols-1 gap-3">
            <label className="min-w-0 text-[12px] font-medium text-ink-soft">Maximum calls per run<input className={`${inputClass} mt-1.5`} type="number" min={1} max={ROUTINE_MCP_MAX_CALLS} step={1} value={calls} onChange={(event) => setCalls(event.target.value)} disabled={held} /></label>
            <label className="min-w-0 text-[12px] font-medium text-ink-soft">Approval expires<input className={`${inputClass} mt-1.5`} type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} disabled={held} /></label>
          </div>}
          {review.tools.length > 0 && <button type="button" disabled={held || selected.length === 0} onClick={beginReview} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] ${buttonDisabled} mt-4 inline-flex items-center gap-1.5`}>Review approval <ChevronRight size={14} /></button>}
        </>}

        {reviewing && <div className="mt-4 rounded-lg border border-accent/30 bg-panel p-3" aria-label="Approval review">
          <h3 className="text-[13px] font-semibold text-ink">Review before approval</h3>
          <p className="mt-1 break-words text-[12px] leading-relaxed text-ink-soft">Routine: {routineName}. The server’s current review covers definition revision {reviewing.expectedDefinitionRevision} and the current destination and audience shown below.</p>
          <ul className="mt-3 space-y-2">{reviewing.tools.map((tool) => {
            return <li key={`${tool.connectionId}:${tool.toolName}`} className="min-w-0 rounded-md bg-surface p-2">
              <p className="break-words text-[12px] font-medium text-ink">{reviewing.labels[toolId(tool.connectionId, tool.toolName)] ?? tool.connectionId} · {tool.toolName}</p>
              <pre {...namedReadRegionProps(`Fixed values for ${tool.toolName}`, 'routine-mcp')} className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[10px] text-ink-soft">Fixed values: {text(tool.fixedArguments)}</pre>
            </li>
          })}</ul>
          <p className="mt-3 text-[12px] font-medium text-ink">Destination and audience</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-ink-soft">{reviewing.disclosures.map((item, index) => <li key={`${index}:${item}`} className="break-words">{item}</li>)}</ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-soft">Third-party MCP providers may apply their own fees and usage limits. The call limit above only bounds calls per routine run; it is not a monetary cap.</p>
          <p className="mt-2 text-[11px] text-ink-faint">Up to {reviewing.maxCallsPerRun} calls per run · expires {fmtDate(reviewing.expiresAt)}</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={held || sending} onClick={approve} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] ${buttonDisabled} inline-flex items-center gap-1.5`}>{sending ? 'Saving…' : 'Approve these tools'} <Check size={13} /></button><button type="button" disabled={held || sending} onClick={() => setReviewing(null)} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] ${buttonDisabled} inline-flex items-center gap-1.5`}><X size={13} /> Back to choices</button></div>
        </div>}

        {review.policy.approval && !held && <button type="button" onClick={revoke} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] mt-4`}>Revoke approval</button>}
        {review.runs.length > 0 && <div className="mt-5 border-t border-line pt-4"><h3 className="text-[13px] font-semibold text-ink">Private run receipts</h3><p className="mt-1 text-[11px] leading-relaxed text-ink-soft">These details are visible only to you. Uncertain calls are never replayed automatically.</p>
        <div className="mt-3 space-y-3">{review.runs.map((run) => <article key={run.runId} className="min-w-0 rounded-lg border border-line p-3"><p className="break-all text-[11px] font-medium text-ink">{routineMcpRunLabel(run.status)} · {run.runId}</p>{run.phase === 'interrupted' && <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">This run was interrupted. Review the receipts below before starting another run; uncertain external calls are never replayed automatically.</p>}{run.calls.length === 0 ? <p className="mt-1 text-[11px] text-ink-faint">No calls were reserved.</p> : <ul className="mt-2 space-y-2">{run.calls.map((receipt) => <li key={receipt.id} className="min-w-0 border-l-2 border-line pl-2"><p className="break-words text-[11px] font-medium text-ink">{receipt.call.toolName} · {receipt.status === 'pending' ? 'In progress' : receipt.status === 'done' ? 'Completed' : receipt.status === 'failed' ? 'Failed' : 'Outcome uncertain'}</p><pre {...namedReadRegionProps(`Arguments for ${receipt.call.toolName}`, 'routine-mcp')} className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[10px] text-ink-soft">{text(receipt.call.arguments)}</pre>{receipt.status === 'uncertain' && <p className="mt-1 text-[11px] text-removed">The provider outcome could not be confirmed. The routine is paused; review the external service, re-enable the routine, and renew approval before running it again.</p>}{receipt.status === 'failed' && <><p className="mt-1 text-[11px] text-ink-soft">The call failed. This reserved call still counts toward the run limit.</p>{receipt.result && <pre {...namedReadRegionProps(`Result for ${receipt.call.toolName}`, 'routine-mcp')} className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-2 text-[10px] text-ink-soft">{text(receipt.result)}</pre>}</>}{receipt.status === 'done' && <pre {...namedReadRegionProps(`Result for ${receipt.call.toolName}`, 'routine-mcp')} className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-2 text-[10px] text-ink-soft">{text(receipt.result)}</pre>}</li>)}</ul>}</article>)}</div>
        </div>}
      </>}
      {localError && <p role="alert" className="mt-3 text-[12px] text-removed">{localError}</p>}
      {notice && <p role="status" className="mt-3 text-[12px] text-ink-soft">{notice}</p>}
      {ownMutation && status.error && <div data-revisioned-mutation="routine-mcp" className="mt-3 rounded-md border border-line bg-panel p-2">
        {heldDecision && <p className="mb-2 text-[11px] leading-relaxed text-ink-soft">Held decision: {heldDecision.action === 'approve' ? `approve ${heldDecision.approval.tools.map((tool) => tool.toolName).join(', ')}` : 'revoke the current approval'} for this Routine. Retry uses the original request unchanged.</p>}
        <InlineOperationStatus tone="alert" message={status.error} action={status.retryable ? { label: 'Retry same decision', onClick: retryRoutineMcpMutation } : undefined} secondaryAction={{ label: 'Dismiss', onClick: dismissRoutineMcpMutation }} />
      </div>}
      {held && !ownMutation && <p role="status" className="mt-3 text-[12px] text-ink-soft">An MCP decision for this routine is being confirmed.</p>}
      {query.error && review && !reviewUnavailable && <p role="status" className="mt-3 text-[11px] text-ink-soft">The saved review could not refresh. Existing policy above is the last server-confirmed state.</p>}
      {!reviewUnavailable && <button type="button" onClick={() => refreshRoutineMcpReview(routineId)} disabled={query.status === 'loading' || held} className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-ink disabled:opacity-50"><RefreshCw size={12} /> Refresh review</button>}
    </section>
  )
}
