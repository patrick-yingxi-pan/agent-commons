import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, SendHorizontal, Sparkles } from 'lucide-react'
import type { Commission, DispatchRun, ModelProvider, OpenSubGoal, Project, ProjectWorkDraftSource } from '../../contract/index.ts'
import { WORK_ITEM_COMMENT_MAX } from '../../contract/index.ts'
import { rolePermits } from '../../contract/roles.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { useAgents, useCapabilities, useCommissions, useDispatchRuns, useMe, useProviders, useSession } from '../api/hooks.ts'
import { enqueueDispatch, heldProjectWorkDraftSelection, isDispatchHeld, useDispatchMutationStatus } from '../controller/dispatchMutations.ts'
import { enqueueWorkItemCommentCreation, heldWorkItemCommentIntent, useWorkItemCommentCreationStatus } from '../controller/workItemCommentCreationMutations.ts'
import { isWorkItemRetractionHeld, useWorkItemRetractionStatus } from '../controller/workItemRetractionMutations.ts'
import { DISPATCH_RUN_META_CLASS, dispatchPresentation, dispatchStatusLabel } from '../lib/dispatchPresentation.ts'
import { modelProviderAvailable } from '../lib/modelExecution.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { DOOR_CLASS } from '../lib/textDoor.ts'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

export function ProjectWorkDraftPanel({ project, item, onOpenSession, onCommentPosted }: {
  project: Project
  item: OpenSubGoal
  onOpenSession: (id: string) => void
  onCommentPosted: () => void
}) {
  const me = useMe()
  const tenantId = me.data?.tenant.id
  const agentsQuery = useAgents()
  const commissionsQuery = useCommissions(project.id)
  const providersQuery = useProviders()
  const dispatchQuery = useDispatchRuns()
  const capabilities = useCapabilities()
  const dispatch = dispatchPresentation(capabilities.status === 'error' ? undefined : capabilities.data?.features.dispatchExecution)
  const dispatchStatus = useDispatchMutationStatus()
  useWorkItemCommentCreationStatus()
  useWorkItemRetractionStatus()
  const held = isDispatchHeld()
  const heldComment = heldWorkItemCommentIntent(project.id, item.id)
  const commentHeld = !!heldComment
  const retractionHeld = isWorkItemRetractionHeld(project.id, item.id)
  const shareHeld = commentHeld || retractionHeld
  const heldSelection = heldProjectWorkDraftSelection(project.id, item.id)
  const agents = agentsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const eligible = useMemo(() => (commissionsQuery.data ?? []).flatMap((commission) => {
    const agent = agents.find((candidate) => candidate.id === commission.agentId)
    const role = commission.role ?? 'writer'
    return commission.projectId === project.id && commission.mine === true && rolePermits(role, 'read') && agent
      ? [{ commission, agent }]
      : []
  }), [agents, commissionsQuery.data, project.id, tenantId])

  const [commissionId, setCommissionId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [reviewRunId, setReviewRunId] = useState('')
  const [replyDraft, setReplyDraft] = useState('')
  const [loadedMessageId, setLoadedMessageId] = useState('')
  const [shareError, setShareError] = useState<string | null>(null)

  useEffect(() => {
    if (!heldSelection) return
    setCommissionId(heldSelection.projectWork.commissionId)
    setProviderId(heldSelection.execution.providerId)
    setModelId(heldSelection.execution.modelId)
  }, [heldSelection?.projectWork.commissionId, heldSelection?.execution.providerId, heldSelection?.execution.modelId])

  useEffect(() => {
    if (!heldComment) return
    setReplyDraft(heldComment.body)
    setShareError(null)
  }, [heldComment?.intentId, heldComment?.body])

  const selected = eligible.find(({ commission }) => commission.id === (heldSelection?.projectWork.commissionId ?? commissionId))
  const selectedProvider = providers.find((provider) => provider.id === (heldSelection?.execution.providerId ?? providerId) && provider.kind !== 'session')
  const selectedModelId = heldSelection?.execution.modelId ?? modelId
  const selectedModel = selectedProvider?.models?.find((model) => model.id === selectedModelId)
  const readyProviders = providers.filter((provider) => provider.kind !== 'session' && modelProviderAvailable(provider) && (provider.models?.length ?? 0) > 0)
  const heldProviderId = heldSelection?.execution.providerId
  const heldModelId = heldSelection?.execution.modelId
  const source: ProjectWorkDraftSource | undefined = selected ? {
    projectId: project.id,
    itemId: item.id,
    commissionId: selected.commission.id,
    expectedRevision: selected.commission.configurationRevision ?? 0,
  } : undefined
  const sourceStillCurrent = !heldSelection || eligible.some(({ commission }) =>
    commission.id === heldSelection.projectWork.commissionId &&
    (commission.configurationRevision ?? 0) === heldSelection.projectWork.expectedRevision,
  )
  const readError = commissionsQuery.status === 'error' || agentsQuery.status === 'error' || providersQuery.status === 'error' || dispatchQuery.status === 'error'
  const registryLoading = [commissionsQuery, agentsQuery, providersQuery, dispatchQuery].some((query) =>
    query.status === 'idle' || query.status === 'loading',
  )
  const capabilityReady = capabilities.status === 'success' && capabilities.data !== undefined
  const runActive = (dispatchQuery.data ?? []).some((run) =>
    Boolean(tenantId) && run.tenantId === tenantId && run.execution?.projectWork?.projectId === project.id &&
    run.execution.projectWork.itemId === item.id && run.execution.state === 'running',
  )
  const canDraft = dispatch.available && capabilityReady && !readError && !registryLoading && !runActive &&
    Boolean(tenantId) && item.status === 'open' && !!source && sourceStillCurrent &&
    !!selectedProvider && modelProviderAvailable(selectedProvider) && !!selectedModel && !held

  const startDraft = () => {
    if (!canDraft || !tenantId || !source || !selected || !selectedProvider || !selectedModel) return
    void enqueueDispatch({
      tenantId,
      title: `Draft response: ${item.subGoal}`,
      execution: { agentId: selected.agent.id, providerId: selectedProvider.id, modelId: selectedModel.id },
      projectWork: source,
      projectWorkLabels: {
        commission: `${selected.agent.label} · ${selected.commission.role ?? 'writer'}`,
        provider: selectedProvider.label,
        model: selectedModel.label ?? selectedModel.id,
      },
    })
  }

  const runs = (dispatchQuery.data ?? []).filter((run) =>
    Boolean(tenantId) && run.tenantId === tenantId &&
    run.execution?.projectWork?.projectId === project.id &&
    run.execution.projectWork.itemId === item.id,
  ).sort((a, b) => b.startedAt - a.startedAt)
  const reviewRun = runs.find((run) => run.id === reviewRunId && run.execution?.messageId) ?? null
  const sessionId = reviewRun?.execution?.sessionId ?? ''
  const sessionQuery = useSession(sessionId)
  const messageId = reviewRun?.execution?.messageId ?? ''
  const reply = sessionQuery.data?.messages?.find((message) => message.id === messageId && message.role === 'assistant')
  const replyAvailable = !!reply && sessionQuery.status !== 'error'
  const replyHydrated = replyAvailable && loadedMessageId === reply?.id
  const reviewVisible = !!reviewRun || commentHeld
  const reviewBody = heldComment?.body ?? replyDraft

  useEffect(() => {
    if (!reply || loadedMessageId === reply.id) return
    setReplyDraft(reply.content)
    setLoadedMessageId(reply.id)
    setShareError(null)
  }, [reply, loadedMessageId])

  const shareReply = async () => {
    if (!tenantId || item.status !== 'open' || !replyHydrated || !replyDraft.trim() || replyDraft.length > WORK_ITEM_COMMENT_MAX || shareHeld || held) return
    setShareError(null)
    try {
      const result = await enqueueWorkItemCommentCreation({ tenantId, projectId: project.id, itemId: item.id, body: replyDraft })
      if (result.outcome === 'applied') {
        setReviewRunId('')
        setReplyDraft('')
        setLoadedMessageId('')
        onCommentPosted()
      } else {
        setShareError('The reply was not shared. Review it and try again when ready.')
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not share this reply.')
    }
  }

  const loading = registryLoading && !readError
  const retryReads = () => {
    invalidate(keys.commissions(project.id))
    invalidate(keys.workerAgents)
    invalidate(keys.providers)
  }
  const budgetCopy = selected ? commissionBudgetCopy(selected.commission, selected.agent, selectedProvider) : null

  return (
    <section data-project-work-draft className="mt-4 min-w-0 rounded-lg border border-line bg-panel px-3 py-3 [overflow-wrap:anywhere]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Sparkles size={14} className="shrink-0" /> Draft a response</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">Creates one bounded private first turn using this work item as context. The prompt includes the Project description and instructions visible to you, this item’s title and details, and the selected Commission role. It excludes linked Project contexts and other external material. It charges your account and the selected Commission budget. No tools run, no work is claimed or completed, and this does not grant standing permission. Nothing is shared until you review and post it below.</p>
        </div>
      </div>

      {readError && <InlineOperationStatus tone="alert" message={heldSelection ? 'Choices could not be refreshed. The submitted selection stays frozen while Dispatch recovery resolves it.' : 'Commission, Agent, model, or Dispatch choices could not be loaded.'} action={{ label: 'Retry', onClick: () => { retryReads(); invalidate(keys.dispatch) } }} />}
      {loading && <p role="status" className="mt-3 text-[12px] text-ink-faint">Checking your eligible Commissions and endpoint models…</p>}
      {!loading && !readError && eligible.length === 0 && !heldSelection && <p className="mt-3 text-[12px] text-ink-faint">No eligible Commission is available. Drafting requires a Commission you own and its existing Agent.</p>}
      {!dispatch.available && <InlineOperationStatus tone="status" message={dispatch.note} />}

      <div className="mt-3 grid min-w-0 gap-2 @md:grid-cols-2">
        <label className="min-w-0 text-[12px] font-medium text-ink-soft">Commission and Agent
          <select aria-label="Commission and Agent" data-project-work-commission value={heldSelection?.projectWork.commissionId ?? commissionId} onChange={(event) => setCommissionId(event.target.value)} disabled={held || !!heldSelection} className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}>
            <option value="">Choose a Commission…</option>
            {heldSelection && !eligible.some(({ commission }) => commission.id === heldSelection.projectWork.commissionId) && <option value={heldSelection.projectWork.commissionId}>{heldSelection.labels?.commission ?? `${heldSelection.projectWork.commissionId} · held choice`}</option>}
            {eligible.map(({ commission, agent }) => <option key={commission.id} value={commission.id}>{agent.label} · {commission.role ?? 'writer'}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-[12px] font-medium text-ink-soft">Endpoint
          <select aria-label="Endpoint" data-project-work-provider value={heldSelection?.execution.providerId ?? providerId} onChange={(event) => { setProviderId(event.target.value); setModelId('') }} disabled={held || !!heldSelection} className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}>
            <option value="">Choose an endpoint…</option>
            {heldProviderId && !readyProviders.some((provider) => provider.id === heldProviderId) && <option value={heldProviderId}>{heldSelection?.labels?.provider ?? selectedProvider?.label ?? `${heldProviderId} · held choice`}</option>}
            {readyProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-[12px] font-medium text-ink-soft">Model
          <select aria-label="Model" data-project-work-model value={selectedModelId} onChange={(event) => setModelId(event.target.value)} disabled={held || !!heldSelection || !selectedProvider} className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}>
            <option value="">Choose a model…</option>
            {heldModelId && !selectedProvider?.models?.some((model) => model.id === heldModelId) && <option value={heldModelId}>{heldSelection?.labels?.model ?? `${heldModelId} · held choice`}</option>}
            {selectedProvider?.models?.map((model) => <option key={model.id} value={model.id}>{model.label ?? model.id}</option>)}
          </select>
        </label>
        <div className="flex min-w-0 items-end">
          <button type="button" data-project-work-start onClick={startDraft} disabled={!canDraft} className={`${SOFT_BUTTON_CLASS} w-full whitespace-normal px-3 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-45`}>
            {heldSelection ? 'Starting private draft…' : held || dispatchStatus.busy ? 'Dispatch is being resolved…' : 'Draft response · uses budget'}
          </button>
        </div>
      </div>
      {selected && <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{selected.agent.label} · {selectedProvider?.label ?? 'Choose endpoint'}{selectedModel ? ` · ${selectedModel.label ?? selectedModel.id}` : ''}. {budgetCopy ?? commissionBudgetCopy(selected.commission, selected.agent, selectedProvider)}</p>}
      {heldSelection && !sourceStillCurrent && <p role="alert" className="mt-2 text-[12px] text-warn-text">This held Commission changed after it was selected. The queued request is frozen; use the Dispatch recovery notice to reconcile it.</p>}
      {dispatchQuery.status === 'error' && <InlineOperationStatus tone="alert" message="Couldn’t refresh private drafts. Previously loaded runs may be out of date." action={{ label: 'Retry', onClick: () => invalidate(keys.dispatch) }} />}

      {runActive && <InlineOperationStatus tone="status" message="A private response draft for this work item is still running. Wait for it to finish before starting another budgeted turn." />}
      {runs.length > 0 && <div className="mt-4 border-t border-line pt-3" data-project-work-runs>
        <h3 className="text-[12px] font-semibold text-ink">Private drafts for this work item</h3>
        <ul className="mt-2 space-y-2">{runs.map((run) => <RunRow key={run.id} run={run} onOpenSession={onOpenSession} onReview={() => { setReviewRunId(run.id); setLoadedMessageId('') }} disabledReview={shareHeld} />)}</ul>
      </div>}

      {reviewVisible && <div data-project-work-review className="mt-4 border-t border-line pt-3">
        <h3 className="text-[12px] font-semibold text-ink">Review for sharing</h3>
        {sessionQuery.status === 'error' && !commentHeld && <InlineOperationStatus tone="alert" message="Couldn’t read the private reply. Cached text is not available for sharing after a read failure." action={{ label: 'Retry', onClick: () => invalidate(keys.session(sessionId)) }} />}
        {reviewRun && !sessionQuery.data && sessionQuery.status !== 'error' && <p role="status" className="mt-2 text-[12px] text-ink-faint">Loading the saved first reply…</p>}
        {reviewRun && sessionQuery.data && !replyAvailable && sessionQuery.status !== 'error' && <p role="alert" className="mt-2 text-[12px] text-removed">The initial reply is not in the current conversation window. Open the conversation to review its history.</p>}
        {commentHeld && <InlineOperationStatus tone="status" message="This exact comment is held for acknowledgement. Retry or Dismiss it in workspace recovery." />}
        {replyAvailable && !replyHydrated && !commentHeld && <p role="status" className="mt-2 text-[12px] text-ink-faint">Preparing the saved reply for review…</p>}
        {(replyHydrated || commentHeld) && <>
          <p className="mt-1 text-[11px] text-ink-faint">{commentHeld ? 'The comment controller holds this exact text for recovery.' : 'Only the saved assistant reply is copied into this editor. The private conversation remains private.'}</p>
          <textarea aria-label="Reply to share" data-project-work-reply value={reviewBody} onChange={(event) => setReplyDraft(event.target.value)} disabled={shareHeld || held} rows={6} className={`${FORM_INPUT_CLASS} mt-2 min-h-28 w-full resize-y whitespace-pre-wrap disabled:opacity-60`} />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-faint"><span>{reviewBody.length.toLocaleString()} / {WORK_ITEM_COMMENT_MAX.toLocaleString()} characters</span><span>{item.status === 'open' ? 'Posting keeps this work item open.' : 'This work item is closed, so the reply cannot be posted here.'}</span></div>
          {reviewBody.length > WORK_ITEM_COMMENT_MAX && <p role="alert" className="mt-1 text-[12px] text-removed">This reply exceeds the comment limit. Edit it to {WORK_ITEM_COMMENT_MAX.toLocaleString()} characters or fewer; it will not be shortened automatically.</p>}
          {shareError && <p role="alert" className="mt-1 text-[12px] text-removed">{shareError}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-project-work-share onClick={() => void shareReply()} disabled={item.status !== 'open' || !replyAvailable || !reviewBody.trim() || reviewBody.length > WORK_ITEM_COMMENT_MAX || shareHeld || held} className={`${SOFT_BUTTON_CLASS} inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-45`}>
              {commentHeld ? 'Sharing…' : <><SendHorizontal size={13} /> Post as comment</>}
            </button>
            <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:opacity-50`} disabled={shareHeld || held} onClick={() => { setReviewRunId(''); setReplyDraft(''); setLoadedMessageId('') }}>Close review</button>
          </div>
        </>}
      </div>}
    </section>
  )
}

function RunRow({ run, onOpenSession, onReview, disabledReview }: { run: DispatchRun; onOpenSession: (id: string) => void; onReview: () => void; disabledReview: boolean }) {
  const canReview = run.execution?.state === 'replied' && !!run.execution.messageId
  return <li data-project-work-run={run.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2 [overflow-wrap:anywhere]">
    <span data-dispatch-run-meta className={DISPATCH_RUN_META_CLASS}>{dispatchStatusLabel(run)} · {new Date(run.startedAt).toLocaleString()}</span>
    {run.execution?.sessionId && <button type="button" onClick={() => onOpenSession(run.execution!.sessionId)} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft ${DOOR_CLASS}`}><ExternalLink size={12} /> Open conversation</button>}
    {canReview && <button type="button" onClick={onReview} disabled={disabledReview} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft hover:border-line-strong disabled:opacity-50"><Check size={12} /> Review for sharing</button>}
  </li>
}

function commissionBudgetCopy(commission: Commission, agent: { budget?: { windows: Array<{ ceiling: number; label: string }> } }, provider?: ModelProvider): string {
  const budget = commission.grant ?? agent.budget ?? provider?.plan
  if (budget?.windows.length) return `Your account is charged; Commission cap: ${budget.windows.map((window) => `${window.ceiling.toLocaleString()} / ${window.label}`).join(' · ')}.`
  return commission.grant
    ? 'Your account is charged within this Commission’s configured token budget.'
    : 'Your account is charged; this Commission inherits its Agent/provider token budget.'
}
