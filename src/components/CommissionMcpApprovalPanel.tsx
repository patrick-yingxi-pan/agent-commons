import { useEffect, useId, useState } from 'react'
import { RefreshCw, Shield } from 'lucide-react'
import type { CommissionMcpApprovalIntent } from '../../contract/commissionMcp.ts'
import type { CommissionMcpDecisionRequest } from '../../contract/commissionMcpApi.ts'
import { COMMISSION_MCP_MAX_TOOLS, COMMISSION_MCP_MAX_WORK_ITEMS } from '../../contract/commissionMcp.ts'
import { providerModelChoices } from '../../contract/providers.ts'
import { useProviders } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { refreshCommissionMcpReview, useCommissionMcpReview } from '../api/commissionMcpHooks.ts'
import { commissionMcpReviewReadErrorKind } from '../api/commissionMcpReadErrors.ts'
import { commissionMcpHeldDecision, commissionMcpHeldPresentation, enqueueCommissionMcpMutation, isCommissionMcpHeld, useCommissionMcpMutationStatus } from '../controller/commissionMcpMutations.ts'
import { isCommissionMutationHeld, useCommissionMutationStatus } from '../controller/commissionMutations.ts'
import { isCommissionDeletionHeld, useCommissionDeletionStatus } from '../controller/commissionDeletionMutations.ts'
import { commissionApprovalFromDraft, commissionApprovalMatchesReview, commissionClaimLabel, commissionToolKey, commissionToolLabelKey, type CommissionToolDraft } from '../lib/commissionMcpPresentation.ts'
import { FORM_ACTION_GROUP_CLASS, SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { modelProviderAvailable } from '../lib/modelExecution.ts'
import { namedReadRegionProps } from '../lib/dialog.ts'
import { CheckboxRow } from './Checkbox.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

type Presentation = { disclosures: string[]; modelLabel: string; labels: Record<string, string> }
type Reviewed = { approval: CommissionMcpApprovalIntent; presentation: Presentation }
const json = (value: unknown) => JSON.stringify(value, null, 2)
const dateLabel = (value: number) => new Date(value).toLocaleString()
function defaultExpiry() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Persistent private permission/history within the canonical Contributor row.
 * Closing the disclosure never owns or cancels an acknowledged-action queue. */
export function CommissionMcpApprovalPanel({ commissionId, agentLabel }: { commissionId: string; agentLabel: string }) {
  const headingId = useId()
  const providersQuery = useProviders()
  const status = useCommissionMcpMutationStatus()
  useCommissionMutationStatus()
  useCommissionDeletionStatus()
  const held = isCommissionMcpHeld(commissionId)
  const competing = isCommissionMutationHeld(commissionId) || isCommissionDeletionHeld(commissionId)
  const heldDecision = commissionMcpHeldDecision(commissionId)
  const heldPresentation = commissionMcpHeldPresentation(commissionId)
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, CommissionToolDraft>>({})
  const [count, setCount] = useState('5')
  const [expiry, setExpiry] = useState(defaultExpiry)
  const [reviewing, setReviewing] = useState<Reviewed | null>(null)
  const [localProgramsAcknowledged, setLocalProgramsAcknowledged] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10_000); return () => window.clearInterval(timer) }, [])
  const selectedProviderId = heldDecision?.action === 'approve' ? heldDecision.approval.execution.providerId : providerId
  const selectedModelId = heldDecision?.action === 'approve' ? heldDecision.approval.execution.modelId : modelId
  const selection = selectedProviderId && selectedModelId ? { providerId: selectedProviderId, modelId: selectedModelId } : undefined
  // Drafting a replacement must not relabel the existing, independently active
  // approval. The base read owns policy/history; the selected read owns consent.
  const currentQuery = useCommissionMcpReview(commissionId)
  const selectedQuery = useCommissionMcpReview(commissionId, selection, !!selection)
  const query = selection ? selectedQuery : currentQuery
  const unavailable = [query.error, currentQuery.error].some(error => error && commissionMcpReviewReadErrorKind(error) === 'unavailable')
  const review = unavailable ? undefined : (query.data ?? currentQuery.data)
  const current = unavailable ? undefined : currentQuery.data
  const claims = current?.claims ?? []
  const approval = current?.policy.approval
  const active = !!current?.active && !!approval && approval.expiresAt > now
  const providers = (providersQuery.data ?? []).filter(provider => provider.kind !== 'session' && modelProviderAvailable(provider) && providerModelChoices(provider).length > 0)
  const selectedProvider = providers.find(provider => provider.id === selectedProviderId)
  const selectedModelChoices = providerModelChoices(selectedProvider)
  const selectedModel = selectedModelChoices.find(model => model.id === selectedModelId)
  const readReady = query.status === 'success' && currentQuery.status === 'success' && providersQuery.status === 'success' && !!selection && !!selectedModel &&
    review?.execution?.providerId === selection.providerId && review.execution.modelId === selection.modelId && !review.blockedReason
  const frozen: Reviewed | null = heldDecision?.action === 'approve'
    ? { approval: heldDecision.approval, presentation: heldPresentation ?? { disclosures: [], modelLabel: `${heldDecision.approval.execution.providerId} / ${heldDecision.approval.execution.modelId}`, labels: {} } }
    : reviewing
  const fresh = !!frozen && !!review && readReady && commissionApprovalMatchesReview(frozen.approval, review, now)
  const disabled = held || competing
  const refresh = () => { refreshCommissionMcpReview(commissionId); if (selection) refreshCommissionMcpReview(commissionId, selection); invalidate(keys.providers) }
  const beginReview = () => {
    if (!review || !readReady || disabled) return
    setError(null)
    setLocalProgramsAcknowledged(false)
    try {
      setReviewing({ approval: commissionApprovalFromDraft(review, drafts, count, expiry), presentation: {
        disclosures: [...review.disclosures], modelLabel: `${selectedProvider!.label} / ${selectedModel!.label ?? selectedModel!.id}`,
        labels: Object.fromEntries(review.tools.map(tool => [commissionToolLabelKey(tool.connectionId, tool.tool.name),
          `${tool.connectionLabel} · ${tool.transport === 'stdio' ? 'Local program' : 'HTTP service'}`])),
      } })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the selected tools and limits.') }
  }
  const send = async (request: CommissionMcpDecisionRequest, presentation?: Presentation) => {
    if (disabled) return
    if (request.action === 'approve' && request.approval.localPrograms && !localProgramsAcknowledged) {
      setError('Acknowledge the local-program launch disclosure before saving this approval.')
      return
    }
    setError(null)
    setNotice(null)
    const result = enqueueCommissionMcpMutation(commissionId, request, presentation)
    if (!result) { setError('Wait for the signed-in account to finish loading before changing approval.'); return }
    if (await result === 'applied') {
      setReviewing(null)
      setLocalProgramsAcknowledged(false)
      setReplacing(false)
      setNotice(request.action === 'approve' ? 'Approval saved. Matching work may now start automatically.' : 'Approval revoked. An already-sent external call cannot be undone.')
    }
  }

  return <section data-commission-mcp={commissionId} aria-labelledby={headingId} className="mt-3 min-w-0 rounded-lg border border-line bg-panel p-3 [overflow-wrap:anywhere]">
    <h3 id={headingId} className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Shield size={15} className="shrink-0" /> Unattended MCP · {agentLabel}</h3>
    <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">Approve a bounded set of MCP tools for matching Project work. Each item gets one model request and at most one tool call, without another confirmation. This is separate from the legacy Standing setting.</p>
    {unavailable ? <p role="status" className="mt-3 text-[12px] text-ink-soft">Private MCP approval is unavailable for this Contributor in the current account.</p> : <>
      {query.status === 'loading' && !review && <p role="status" className="mt-3 text-[12px] text-ink-soft">Loading your private approval and receipts…</p>}
      {(query.error || currentQuery.error || providersQuery.error) && <InlineOperationStatus tone="alert" message="Couldn’t refresh the current review. Cached information cannot authorize a new approval." action={{ label: 'Retry read', onClick: refresh }} />}
      {review && <>
        <div className="mt-3 rounded-md bg-surface p-3">
          <p data-commission-mcp-status className="text-[13px] font-medium text-ink">{active ? 'Approval active' : approval ? 'Approval needs review or has reached its limit' : 'No unattended approval'}</p>
          {approval && <p className="mt-1 text-[12px] text-ink-soft">Up to {approval.maxWorkItems} work items under this approval · expires {dateLabel(approval.expiresAt)}. Failed and uncertain attempts count.</p>}
          {approval?.localPrograms && <p className="mt-1 text-[12px] text-warn-text">Includes unattended local-program launch with normal OS access.</p>}
          {approval && <details className="mt-2 min-w-0"><summary className="cursor-pointer text-[12px] text-ink-soft">Saved model and exact tool constraints</summary><p className="mt-2 text-[12px] text-ink-soft">{providersQuery.data?.find(provider => provider.id === approval.execution.providerId)?.label ?? approval.execution.providerId} / {approval.execution.modelId}</p><ul className="mt-2 space-y-2">{approval.tools.map(tool => <li key={commissionToolLabelKey(tool.connectionId, tool.toolName)} className="min-w-0"><p className="text-[12px] text-ink">{current?.tools.find(choice => choice.connectionId === tool.connectionId)?.connectionLabel ?? tool.connectionId} · {tool.toolName}</p><pre {...namedReadRegionProps(`Approved fixed values for ${tool.toolName}`, 'commission-mcp')} className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ink-soft">{json(tool.fixedArguments)}</pre></li>)}</ul></details>}
          {review.blockedReason && <p role="status" className="mt-1 text-[12px] text-ink-soft">{review.blockedReason}</p>}
          {approval && <div data-commission-mcp-actions className={`${FORM_ACTION_GROUP_CLASS} mt-3`}>
            <button type="button" disabled={disabled} onClick={() => void send({ requestId: crypto.randomUUID(), action: 'revoke', expectedRevision: current!.policy.revision })} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}>Revoke approval</button>
            {active && !replacing && <button type="button" disabled={disabled} onClick={() => setReplacing(true)} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}>Review replacement</button>}
          </div>}
        </div>
        {!frozen && (!active || replacing) && <div className="mt-3 space-y-3">
          <p className="text-[11px] leading-relaxed text-ink-soft">Your workspace pays for model use. Select the endpoint and model explicitly; when no model list is available, only that connection’s configured model can be selected. There is no automatic fallback.</p>
          <label className="block min-w-0 text-[12px] text-ink-soft">Endpoint
            <select aria-label="Unattended endpoint" value={selectedProviderId} onChange={event => { setProviderId(event.target.value); setModelId('') }} disabled={disabled} className={`${FORM_INPUT_CLASS} mt-1 min-w-0`}><option value="">Choose an endpoint…</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>
          </label>
          <label className="block min-w-0 text-[12px] text-ink-soft">Model
            <select aria-label="Unattended model" value={selectedModelId} onChange={event => setModelId(event.target.value)} disabled={disabled || !selectedProvider} className={`${FORM_INPUT_CLASS} mt-1 min-w-0`}><option value="">Choose a model…</option>{selectedModelChoices.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
          </label>
          {selection && review.tools.length === 0 && <p className="text-[12px] text-ink-soft">No inspected tools are available under this Contributor’s current authority. Configure and inspect a connection in Contexts, and check the Project and Agent’s allowed tools. Local programs require the desktop runtime.</p>}
          {selection && review.tools.map(choice => {
            const key = commissionToolKey(choice)
            const draft = drafts[key] ?? { selected: false, fixedText: '{}' }
            const selectedCount = review.tools.filter(tool => drafts[commissionToolKey(tool)]?.selected).length
            return <article key={key} className="min-w-0 rounded-md border border-line bg-surface p-3">
              <CheckboxRow checked={draft.selected} disabled={disabled || !readReady || (!draft.selected && selectedCount >= COMMISSION_MCP_MAX_TOOLS)} onToggle={() => setDrafts(current => ({ ...current, [key]: { ...draft, selected: !draft.selected } }))} className="w-full min-w-0"><span className="min-w-0"><span className="block text-[12px] font-medium text-ink">{choice.tool.title ?? choice.tool.name}</span><span className="block text-[11px] text-ink-soft">{choice.connectionLabel} · {choice.tool.name} · {choice.transport === 'stdio' ? 'Local program' : 'HTTP service'}</span></span></CheckboxRow>
              {choice.tool.description && <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{choice.tool.description}</p>}
              <details className="mt-2 min-w-0"><summary className="cursor-pointer text-[11px] text-ink-soft">Input schema</summary><pre {...namedReadRegionProps(`Input schema for ${choice.tool.name}`, 'commission-mcp')} className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ink-soft">{json(choice.tool.inputSchema)}</pre></details>
              {draft.selected && <label className="mt-3 block text-[12px] text-ink-soft">Fixed top-level JSON values<textarea aria-label={`Fixed values for ${choice.tool.name}`} value={draft.fixedText} onChange={event => setDrafts(current => ({ ...current, [key]: { ...draft, fixedText: event.target.value } }))} disabled={disabled} rows={3} className={`${FORM_INPUT_CLASS} mt-1 min-w-0 font-mono`} /><span className="mt-1 block text-[11px] leading-relaxed">{'{}'} fixes no values. Values you provide must match exactly; the model fills remaining schema fields.</span></label>}
            </article>
          })}
          <label className="block min-w-0 text-[12px] text-ink-soft">Maximum work items<input type="number" min={1} max={COMMISSION_MCP_MAX_WORK_ITEMS} step={1} value={count} onChange={event => setCount(event.target.value)} disabled={disabled} className={`${FORM_INPUT_CLASS} mt-1 min-w-0`} /></label>
          <label className="block min-w-0 text-[12px] text-ink-soft">Approval expires<input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} disabled={disabled} className={`${FORM_INPUT_CLASS} mt-1 min-w-0`} /></label>
          <button type="button" disabled={disabled || !readReady} onClick={beginReview} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}>Review approval</button>
        </div>}
        {frozen && <div data-commission-mcp-review className="mt-3 rounded-md border border-accent/30 bg-surface p-3">
          <h4 className="text-[13px] font-semibold text-ink">{held ? 'Submitted approval · awaiting confirmation' : 'Review before approval'}</h4>
          <p className="mt-2 text-[12px] text-ink">{frozen.presentation.modelLabel} · up to {frozen.approval.maxWorkItems} work items · expires {dateLabel(frozen.approval.expiresAt)}</p>
          <ul className="mt-3 space-y-2">{frozen.approval.tools.map(tool => <li key={commissionToolLabelKey(tool.connectionId, tool.toolName)} className="min-w-0"><p className="text-[12px] font-medium text-ink">{frozen.presentation.labels[commissionToolLabelKey(tool.connectionId, tool.toolName)] ?? tool.connectionId} · {tool.toolName}</p><pre {...namedReadRegionProps(`Fixed values for ${tool.toolName}`, 'commission-mcp')} className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ink-soft">{json(tool.fixedArguments)}</pre></li>)}</ul>
          <h4 className="mt-3 text-[12px] font-semibold text-ink">Destination, audience and limits</h4>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-[12px] leading-relaxed text-ink-soft">{frozen.presentation.disclosures.map((line, index) => <li key={index}>{line}</li>)}</ul>
          {frozen.approval.localPrograms && <div className="mt-3 rounded-md border border-removed/30 bg-panel p-3">
            <h4 className="text-[12px] font-semibold text-ink">Local-program launch</h4>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">This approval may launch the selected local programs unattended. A program may read or change files and use the network with its normal OS access. Startup itself may have effects before a tool request; fixed arguments and work limits are not a sandbox. Connection setup and Routine approvals do not grant this permission.</p>
            {held ? <p className="mt-3 text-[12px] text-ink">Explicit local-program consent was included in this submitted approval.</p> : <CheckboxRow checked={localProgramsAcknowledged} disabled={disabled} onToggle={() => setLocalProgramsAcknowledged(value => !value)} className="mt-3 w-full">
              <span className="text-[12px] leading-relaxed text-ink">I understand and explicitly approve unattended local-program launch. Agent Commons does not sandbox this program; it may have normal OS access and possible startup effects.</span>
            </CheckboxRow>}
          </div>}
          {!fresh && !held && <p role="status" className="mt-3 text-[12px] text-warn-text">The current review changed or could not be refreshed. Go back and review again; this approval cannot be submitted.</p>}
          <div data-commission-mcp-actions className={`${FORM_ACTION_GROUP_CLASS} mt-3`}><button type="button" disabled={disabled || !fresh || (!!frozen.approval.localPrograms && !localProgramsAcknowledged)} onClick={() => void send({ requestId: crypto.randomUUID(), action: 'approve', approval: frozen.approval }, frozen.presentation)} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}>Approve unattended work</button><button type="button" disabled={disabled} onClick={() => { setLocalProgramsAcknowledged(false); setReviewing(null) }} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}>Back to choices</button></div>
        </div>}
        {heldDecision?.action === 'revoke' && <p role="status" className="mt-3 text-[12px] text-ink-soft">Revocation is awaiting confirmation. Workspace recovery keeps the same decision if you navigate away.</p>}
        {held && status.error && <p role="alert" className="mt-3 text-[12px] text-removed">{status.error} Use the workspace recovery notice to Retry or Dismiss this exact decision.</p>}
        <div className="mt-4 border-t border-line pt-3">
          <h4 className="text-[12px] font-semibold text-ink">Private work receipts</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">These exact arguments and results are private to you. No receipt can be retried. Uncertain outcomes require checking the service or local program before renewed approval. Restored open work stays on the manual Contribution path.</p>
          {claims.length === 0 ? <p className="mt-2 text-[12px] text-ink-faint">No work has been claimed under your approval.</p> : <ul className="mt-3 space-y-3">{claims.map(claim => <li key={claim.id} data-commission-mcp-receipt={claim.id} className="min-w-0 rounded-md border border-line bg-surface p-3">
            <p className="text-[12px] font-medium text-ink">{claim.work.subGoal}</p>
            <p className="mt-1 text-[11px] text-ink-soft">{claim.transport === 'stdio' ? 'Local program' : 'HTTP service'} · {commissionClaimLabel(claim)} · {dateLabel(claim.startedAt)}</p>
            {claim.transport === 'stdio' && claim.phase === 'effect' && claim.status === 'failed' && <p className="mt-1 text-[11px] text-warn-text">The local program may have had startup effects even without a tool result. Its authorizing approval was withdrawn if still current; review the program before approving new work.</p>}
            {claim.status === 'done' && <p className="mt-1 text-[11px] text-ink-soft">A successful call completes work only if its authority and work item are still current. Check the Project’s work status for completion.</p>}
            {claim.call && <details className="mt-2 min-w-0"><summary className="cursor-pointer text-[11px] text-ink-soft">Arguments and result · {claim.call.toolName}</summary><pre {...namedReadRegionProps(`Arguments for ${claim.work.subGoal}`, 'commission-mcp')} className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ink-soft">{json(claim.call.arguments)}</pre>{claim.result && <pre {...namedReadRegionProps(`Result for ${claim.work.subGoal}`, 'commission-mcp')} className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ink-soft">{json(claim.result)}</pre>}</details>}
          </li>)}</ul>}
        </div>
      </>}
      {error && <p role="alert" className="mt-3 text-[12px] text-removed">{error}</p>}
      {notice && <p role="status" className="mt-3 text-[12px] text-ink-soft">{notice}</p>}
      <button type="button" disabled={held || query.status === 'loading'} onClick={refresh} className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-ink disabled:opacity-50"><RefreshCw size={12} /> Refresh review</button>
    </>}
  </section>
}
