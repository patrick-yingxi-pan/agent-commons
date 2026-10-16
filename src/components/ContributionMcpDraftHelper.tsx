import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { Agent, Commission, DispatchRun, ModelProvider, OpenSubGoal, Project, ProjectWorkDraftSource, ProjectWorkMcpDraftSelection } from '../../contract/index.ts'
import { providerModelChoices } from '../../contract/providers.ts'
import { parseProjectWorkMcpDraftPreview, parseProjectWorkMcpDraftReply, projectWorkMcpDraftBindingText } from '../../contract/projectWorkMcpDraft.ts'
import { rolePermits } from '../../contract/roles.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { useAgents, useCapabilities, useCommissions, useDispatchRuns, useMe, useOpenSubGoals, useProviders, useSession } from '../api/hooks.ts'
import { useMcpConnections } from '../api/mcpConnectionHooks.ts'
import { enqueueDispatch, heldProjectWorkDraftSelection, isDispatchHeld, useDispatchMutationStatus } from '../controller/dispatchMutations.ts'
import { dispatchPresentation, dispatchStatusLabel } from '../lib/dispatchPresentation.ts'
import { modelProviderAvailable } from '../lib/modelExecution.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { DOOR_CLASS } from '../lib/textDoor.ts'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

type Tool = import('../../contract/mcpConnections.ts').McpDiscoveredTool

export function ContributionMcpDraftHelper({ project, item, selection, tool, connectionLabel, connectionTransport, currentArgumentsText, disabled, onOpenSession, onAdopt, onClose }: {
  project: Project
  item: OpenSubGoal
  selection: ProjectWorkMcpDraftSelection
  tool: Tool
  connectionLabel: string
  connectionTransport?: 'http' | 'stdio'
  currentArgumentsText: string
  disabled: boolean
  onOpenSession: (id: string) => void
  onAdopt: (argumentsValue: Record<string, import('../../contract/mcpExecution.ts').McpJsonValue>) => void
  onClose: () => void
}) {
  const me = useMe()
  const tenantId = me.data?.tenant.id
  const userId = me.data?.user.id
  const commissionsQuery = useCommissions(project.id)
  const agentsQuery = useAgents()
  const providersQuery = useProviders()
  const dispatchQuery = useDispatchRuns()
  const connectionsQuery = useMcpConnections()
  const workItemsQuery = useOpenSubGoals(project.id)
  const capabilities = useCapabilities()
  const dispatch = dispatchPresentation(capabilities.status === 'error' ? undefined : capabilities.data?.features.dispatchExecution)
  const mutation = useDispatchMutationStatus()
  const held = heldProjectWorkDraftSelection(project.id, item.id)
  const dispatchHeld = isDispatchHeld()
  const commissions = commissionsQuery.data ?? []
  const agents = agentsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const currentItem = (workItemsQuery.data ?? []).find((candidate) => candidate.id === item.id && candidate.projectId === project.id)
  const readQueries = [me, commissionsQuery, agentsQuery, providersQuery, dispatchQuery, connectionsQuery, workItemsQuery, capabilities]
  const readError = readQueries.some((query) => query.status === 'error')
  const readLoading = readQueries.some((query) => query.status === 'idle' || query.status === 'loading')
  const readsReady = !readError && !readLoading
  const eligible = useMemo(() => commissions.flatMap((commission) => {
    const agent = agents.find((candidate) => candidate.id === commission.agentId)
    const role = commission.role ?? 'writer'
    return commission.projectId === project.id && commission.mine === true && rolePermits(role, 'read') && agent
      ? [{ commission, agent }]
      : []
  }), [agents, commissions, project.id, tenantId])
  const [commissionId, setCommissionId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [reviewRunId, setReviewRunId] = useState('')
  const [hashResult, setHashResult] = useState<{ key: string; hash: string } | null>(null)
  const [hashError, setHashError] = useState(false)
  const [adoptedRunId, setAdoptedRunId] = useState('')

  useEffect(() => {
    if (!held?.mcpProposal) return
    setCommissionId(held.projectWork.commissionId)
    setProviderId(held.execution.providerId)
    setModelId(held.execution.modelId)
  }, [held?.projectWork.commissionId, held?.execution.providerId, held?.execution.modelId, held?.mcpProposal?.connectionId])

  const selected = eligible.find(({ commission }) => commission.id === (held?.mcpProposal ? held.projectWork.commissionId : commissionId))
  const activeProviderId = held?.mcpProposal ? held.execution.providerId : providerId
  const activeModelId = held?.mcpProposal ? held.execution.modelId : modelId
  const selectedProvider = providers.find((provider) => provider.id === activeProviderId && provider.kind !== 'session')
  const selectedModelChoices = providerModelChoices(selectedProvider)
  const selectedModel = selectedModelChoices.find((candidate) => candidate.id === activeModelId)
  const readyProviders = providers.filter((provider) => provider.kind !== 'session' && modelProviderAvailable(provider) && providerModelChoices(provider).length > 0)
  const mcpConnection = (connectionsQuery.data?.connections ?? []).find((connection) => connection.id === selection.connectionId)
  const currentTool = mcpConnection?.tools.find((candidate) => candidate.name === selection.toolName)
  const executable = mcpConnection?.status === 'connected' && mcpConnection.execution === 'approval-required' &&
    mcpConnection.revision === selection.connectionRevision && (mcpConnection.executableTools ?? []).includes(selection.toolName) &&
    mcpConnection.label === connectionLabel && currentTool?.name === tool.name
  const itemCurrent = currentItem?.status === 'open' && currentItem.type === 'mcp.mutate' && currentItem.target === selection.toolName && item.id === currentItem.id
  const heldMatches = held?.mcpProposal?.connectionId === selection.connectionId &&
    held.mcpProposal.connectionRevision === selection.connectionRevision && held.mcpProposal.toolName === selection.toolName
  const source: ProjectWorkDraftSource | undefined = selected ? {
    projectId: project.id,
    itemId: item.id,
    commissionId: selected.commission.id,
    expectedRevision: selected.commission.configurationRevision ?? 0,
  } : undefined
  const sourceStillCurrent = !held?.mcpProposal || (eligible.some(({ commission }) =>
    commission.id === held.projectWork.commissionId && (commission.configurationRevision ?? 0) === held.projectWork.expectedRevision))

  const bindingText = useMemo(() => {
    if (!tenantId || !userId || !currentTool || !executable) return null
    try { return projectWorkMcpDraftBindingText(tenantId, userId, selection, currentTool) }
    catch { return null }
  }, [tenantId, userId, selection.connectionId, selection.connectionRevision, selection.toolName, currentTool, executable])
  const bindingKey = bindingText && tenantId && userId
    ? JSON.stringify([tenantId, userId, project.id, item.id, selected?.commission.id, selected?.commission.configurationRevision ?? 0, bindingText])
    : ''

  useEffect(() => {
    let current = true
    setHashResult(null)
    setHashError(false)
    if (!bindingText || !bindingKey) return () => { current = false }
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(bindingText)).then((digest) => {
      if (!current) return
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      setHashResult({ key: bindingKey, hash })
    }).catch(() => { if (current) setHashError(true) })
    return () => { current = false }
  }, [bindingText, bindingKey])

  const currentHash = hashResult?.key === bindingKey ? hashResult.hash : null
  const runs = (dispatchQuery.data ?? []).filter((run) =>
    Boolean(tenantId) && run.tenantId === tenantId &&
    run.execution?.projectWork?.projectId === project.id && run.execution.projectWork.itemId === item.id &&
    run.execution.mcpProposal?.toolName === selection.toolName,
  ).sort((a, b) => b.startedAt - a.startedAt)
  const activeRun = runs.some((run) => run.execution?.state === 'running')
  const reviewRun = runs.find((run) => run.id === reviewRunId && run.execution?.messageId) ?? null
  const sessionId = reviewRun?.execution?.sessionId ?? ''
  const sessionQuery = useSession(sessionId)
  const messageId = reviewRun?.execution?.messageId ?? ''
  const reply = sessionQuery.data?.messages?.find((message) => message.id === messageId && message.role === 'assistant')
  const savedReply = sessionQuery.status === 'success' ? reply : undefined
  const preview = reviewRun?.execution?.mcpProposal ? parseProjectWorkMcpDraftPreview(reviewRun.execution.mcpProposal) : undefined
  const parsedReply = savedReply && preview ? parseProjectWorkMcpDraftReply(savedReply.content, preview.toolName) : undefined
  const runSource = reviewRun?.execution?.projectWork
  const runCommission = runSource && eligible.find(({ commission }) => commission.id === runSource.commissionId)?.commission
  const runIsCurrent = !!reviewRun && reviewRun.execution?.state === 'replied' && !!runSource && !!preview && sessionQuery.status === 'success' && !!savedReply && readsReady && itemCurrent && executable &&
    reviewRun.tenantId === tenantId && runSource.projectId === project.id && runSource.itemId === item.id &&
    !!runCommission && (runCommission.configurationRevision ?? 0) === runSource.expectedRevision &&
    preview.toolName === selection.toolName && preview.connectionLabel === connectionLabel &&
    preview.transport === (connectionTransport === 'stdio' ? 'stdio' : undefined) &&
    preview.bindingHash === currentHash
  const stale = !!reviewRun && (!runIsCurrent || !currentHash)
  const canStart = readsReady && dispatch.available && !dispatchHeld && !mutation.busy && !disabled && !held?.mcpProposal &&
    !!tenantId && !!userId && !!source && sourceStillCurrent && itemCurrent && executable && !!selected &&
    !!selectedProvider && modelProviderAvailable(selectedProvider) && !!selectedModel && !activeRun && !!currentHash

  const adoptArguments = () => {
    if (!parsedReply?.ok || !runIsCurrent || !readsReady || disabled || dispatchHeld || held?.mcpProposal || !reviewRun) return
    onAdopt(parsedReply.arguments)
    setAdoptedRunId(reviewRun.id)
  }

  const start = () => {
    if (!canStart || !tenantId || !source || !selected || !selectedProvider || !selectedModel) return
    void enqueueDispatch({
      tenantId,
      title: `Draft MCP arguments: ${selection.toolName}`,
      execution: { agentId: selected.agent.id, providerId: selectedProvider.id, modelId: selectedModel.id },
      projectWork: source,
      projectWorkLabels: {
        commission: `${selected.agent.label} · ${selected.commission.role ?? 'writer'}`,
        provider: selectedProvider.label,
        model: selectedModel.label ?? selectedModel.id,
      },
      mcpProposal: { ...selection },
      mcpProposalLabels: { connection: connectionLabel, tool: selection.toolName },
    })
  }

  const retryReads = () => {
    invalidate(keys.me)
    invalidate(keys.capabilities)
    invalidate(keys.commissions(project.id))
    invalidate(keys.workerAgents)
    invalidate(keys.providers)
    invalidate(keys.dispatch)
    invalidate(keys.mcpConnections)
    invalidate(keys.openSubGoals(project.id))
  }

  return <section data-contribution-mcp-draft-helper className="mt-2 min-w-0 rounded-md border border-line bg-surface px-2.5 py-2 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-[11px] font-semibold text-ink">Draft arguments for {selection.toolName}</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">Its workspace-private first reply is a suggestion only. Drafting uses your account and Commission budget; it does not call a tool or local process, propose or approve an envelope, or resolve work.</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">Saved in your workspace. Workspace members can read the selected tool schema and reply; other Project viewers cannot.</p>
        <details data-contribution-mcp-draft-inputs className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          <summary className="cursor-pointer font-medium">What the model receives</summary>
          <p className="mt-1">The chosen model receives the selected Agent’s configured system prompt and instructions, this Project’s visible description and instructions, this open work item, the selected Commission role, and the selected MCP tool schema.</p>
        </details>
      </div>
      <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[11px]`}>Close</button>
    </div>

    {readError && <InlineOperationStatus tone="alert" message="Current account, work item, Commission, model, Dispatch, or MCP choices could not be refreshed. No argument draft can start or be adopted." action={{ label: 'Retry reads', onClick: retryReads }} />}
    {readLoading && !readError && <p role="status" className="mt-2 text-[11px] text-ink-faint">Checking the current work item, Commission, model, and MCP tool…</p>}
    {!readError && readsReady && !itemCurrent && <p role="alert" data-contribution-mcp-draft-stale className="mt-2 text-[11px] text-warn-text">The linked work item is no longer open for this exact MCP tool. No draft can start or be adopted.</p>}
    {!readError && readsReady && !eligible.length && <p className="mt-2 text-[11px] text-ink-faint">No owned read-capable Commission with its existing Agent is available for this draft.</p>}
    {!dispatch.available && <InlineOperationStatus tone="status" message={dispatch.note} />}

    <div className="mt-2 grid min-w-0 gap-2 @md:grid-cols-2">
      <label className="min-w-0 text-[11px] font-medium text-ink-soft">Commission and Agent
        <select aria-label="Commission and Agent" value={held?.mcpProposal ? held.projectWork.commissionId : commissionId} onChange={(event) => setCommissionId(event.target.value)} disabled={dispatchHeld || !!held?.mcpProposal || disabled} className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}>
          <option value="">Choose a Commission…</option>
          {held?.mcpProposal && !eligible.some(({ commission }) => commission.id === held.projectWork.commissionId) && <option value={held.projectWork.commissionId}>{held.labels?.commission ?? `${held.projectWork.commissionId} · held choice`}</option>}
          {eligible.map(({ commission, agent }) => <option key={commission.id} value={commission.id}>{agent.label} · {commission.role ?? 'writer'}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-[11px] font-medium text-ink-soft">Endpoint
        <select aria-label="Endpoint" value={held?.mcpProposal ? held.execution.providerId : providerId} onChange={(event) => { setProviderId(event.target.value); setModelId('') }} disabled={dispatchHeld || !!held?.mcpProposal || disabled} className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}>
          <option value="">Choose an endpoint…</option>
          {held?.mcpProposal && !readyProviders.some((provider) => provider.id === held.execution.providerId) && <option value={held.execution.providerId}>{held.labels?.provider ?? `${held.execution.providerId} · held choice`}</option>}
          {readyProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-[11px] font-medium text-ink-soft">Model
        <select aria-label="Model" value={held?.mcpProposal ? held.execution.modelId : modelId} onChange={(event) => setModelId(event.target.value)} disabled={dispatchHeld || !!held?.mcpProposal || disabled || !selectedProvider} className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}>
          <option value="">Choose a model…</option>
          {held?.mcpProposal && !selectedModelChoices.some((candidate) => candidate.id === held.execution.modelId) && <option value={held.execution.modelId}>{held.labels?.model ?? `${held.execution.modelId} · held choice`}</option>}
          {selectedModelChoices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </label>
      <div className="flex min-w-0 items-end">
        <button type="button" data-contribution-mcp-draft-start onClick={start} disabled={!canStart} className={`${SOFT_BUTTON_CLASS} w-full whitespace-normal px-3 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-45`}>
          {held?.mcpProposal ? 'Draft request is awaiting acknowledgement…' : dispatchHeld || mutation.busy ? 'Dispatch is being resolved…' : 'Draft arguments · uses budget'}
        </button>
      </div>
    </div>
    {selected && <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">{selected.agent.label} · {selectedProvider?.label ?? 'Choose endpoint'}{selectedModel ? ` · ${selectedModel.label}${selectedProvider && !selectedProvider.models?.length ? ' · configured model only' : ''}` : ''}. {commissionBudgetCopy(selected.commission, selected.agent, selectedProvider)}</p>}
    {held?.mcpProposal && !heldMatches && <p role="alert" data-contribution-mcp-draft-stale className="mt-2 text-[11px] text-warn-text">A different MCP draft request is still held for this work item. Resolve it in workspace recovery before starting another.</p>}
    {held?.mcpProposal && !sourceStillCurrent && <p role="alert" data-contribution-mcp-draft-stale className="mt-2 text-[11px] text-warn-text">The held Commission changed after it was selected. Its Dispatch request is frozen; use workspace recovery to reconcile it.</p>}
    {hashError && <p role="alert" className="mt-2 text-[11px] text-warn-text">The current tool binding could not be verified. Retry the reads before drafting or adopting arguments.</p>}
    {dispatchQuery.status === 'error' && <InlineOperationStatus tone="alert" message="Couldn’t load workspace argument drafts." action={{ label: 'Retry reads', onClick: retryReads }} />}
    {activeRun && <InlineOperationStatus tone="status" message="An argument draft for this work item and tool is still running. Wait before starting another budgeted turn." />}
    {runs.length > 0 && <div className="mt-3 border-t border-line pt-2" data-contribution-mcp-draft-runs>
      <h5 className="text-[11px] font-semibold text-ink">Workspace argument drafts for this tool</h5>
      <ul className="mt-2 space-y-1.5">{runs.map((run) => <DraftRunRow key={run.id} run={run} selected={reviewRunId === run.id} onReview={() => setReviewRunId(run.id)} onOpenSession={onOpenSession} />)}</ul>
    </div>}

    {reviewRun && <div data-contribution-mcp-draft-review className="mt-3 border-t border-line pt-2">
      <h5 className="text-[11px] font-semibold text-ink">Review saved workspace reply</h5>
      <p data-contribution-mcp-draft-source className="mt-1 text-[11px] leading-relaxed text-ink-soft">
        Saved run: {agents.find((agent) => agent.id === reviewRun.execution?.agentId)?.label ?? reviewRun.execution?.agentId}
        {' · '}{providers.find((provider) => provider.id === reviewRun.execution?.providerId)?.label ?? reviewRun.execution?.providerId}
        {' · '}{reviewRun.execution?.modelId}. Choices above apply to a new draft, not this saved reply.
      </p>
      {sessionQuery.status === 'error' && <InlineOperationStatus tone="alert" message="Couldn’t read the saved workspace reply. Cached text cannot be used to adopt arguments." action={{ label: 'Retry reply read', onClick: () => invalidate(keys.session(sessionId)) }} />}
      {!sessionQuery.data && sessionQuery.status !== 'error' && <p role="status" className="mt-2 text-[11px] text-ink-faint">Loading the exact saved first reply…</p>}
      {sessionQuery.status === 'success' && !savedReply && <p role="alert" className="mt-2 text-[11px] text-removed">The exact saved first reply is not available in the current conversation read. Open the conversation to review its history.</p>}
      {savedReply && <>
        <p className="mt-1 text-[10px] text-ink-faint">This workspace-private reply is shown in full before adoption; nothing is proposed, approved, or run.</p>
        <div data-contribution-mcp-draft-reply className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel px-2 py-2 text-[11px] leading-relaxed text-ink">{savedReply.content}</div>
        {parsedReply?.ok ? <>
          {stale && <p role="alert" data-contribution-mcp-draft-stale className="mt-2 text-[11px] text-warn-text">This saved draft no longer matches the current caller, Commission revision, connection revision, or tool schema. It cannot be adopted.</p>}
          <p className="mt-2 text-[10px] text-ink-faint">Target: <span className="font-mono text-ink">{selection.toolName}</span>. These exact arguments replace the current editable JSON only when you choose Use draft arguments.</p>
          <details className="mt-2 rounded-md border border-line bg-panel px-2 py-1.5">
            <summary className="cursor-pointer text-[10px] font-medium text-ink-soft">Current editable arguments</summary>
            <pre data-contribution-mcp-draft-current-arguments className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-ink">{currentArgumentsText}</pre>
          </details>
          <pre data-contribution-mcp-draft-preview className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel px-2 py-2 font-mono text-[10px] leading-relaxed text-ink">{JSON.stringify(parsedReply.arguments, null, 2)}</pre>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" data-contribution-mcp-draft-adopt onClick={adoptArguments} disabled={!runIsCurrent || !readsReady || disabled || dispatchHeld || !!held?.mcpProposal} className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-45`}>Use draft arguments</button>
            {adoptedRunId === reviewRun.id && <span role="status" className="text-[10px] text-ink-faint">Copied to the editable JSON field; review it before proposing.</span>}
          </div>
        </> : <p role="alert" data-contribution-mcp-draft-invalid className="mt-2 text-[11px] text-removed">{parsedReply?.message ?? 'The saved draft binding could not be verified.'}</p>}
      </>}
    </div>}
  </section>
}

function DraftRunRow({ run, selected, onReview, onOpenSession }: { run: DispatchRun; selected: boolean; onReview: () => void; onOpenSession: (id: string) => void }) {
  const sessionId = run.execution?.sessionId
  const replied = run.execution?.state === 'replied' && !!run.execution.messageId
  return <li data-contribution-mcp-draft-run={run.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5 [overflow-wrap:anywhere]">
    <span className="min-w-0 grow basis-48 text-[10px] text-ink-soft">{dispatchStatusLabel(run)} · {new Date(run.startedAt).toLocaleString()}</span>
    {sessionId && <button type="button" onClick={() => onOpenSession(sessionId)} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-ink-soft ${DOOR_CLASS}`}><ExternalLink size={11} /> Open conversation</button>}
    {replied && <button type="button" onClick={onReview} aria-pressed={selected} className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-soft hover:border-line-strong">Review saved reply</button>}
  </li>
}

function commissionBudgetCopy(commission: Commission, agent: Agent, provider?: ModelProvider): string {
  const budget = commission.grant ?? agent.budget ?? provider?.plan
  if (budget?.windows.length) return `Your account is charged; Commission cap: ${budget.windows.map((window) => `${window.ceiling.toLocaleString()} / ${window.label}`).join(' · ')}.`
  return commission.grant
    ? 'Your account is charged within this Commission’s configured token budget.'
    : 'Your account is charged; this Commission inherits its Agent/provider token budget.'
}

// Kept as an indirection so the lazy leaf owns the work-item read lifecycle.
