import { useEffect, useRef, useState } from 'react'
import type { ContributionMcpSelection, OpenSubGoal, Project, ProjectWorkMcpDraftSelection } from '../../contract/index.ts'
import { CONTRIBUTION_FIELD_MAX } from '../../contract/contributions.ts'
import { useMcpConnections } from '../api/mcpConnectionHooks.ts'
import { useContributions, useMe, useOpenSubGoals } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { accountGeneration } from '../api/account.ts'
import {
  contributionCreationDraft,
  clearContributionCreationDraft,
  enqueueContributionCreation,
  heldContributionCreationIntent,
  isContributionCreationHeld,
  latestAppliedContributionCreation,
  rememberContributionCreationDraft,
  subscribeContributionCreationApplied,
  useContributionCreationStatus,
} from '../controller/contributionCreationMutations.ts'
import { heldProjectWorkDraftSelection, isDispatchHeld, useDispatchMutationStatus } from '../controller/dispatchMutations.ts'
import { CONTRIBUTION_LOCAL_STDIO_DISCLOSURE } from '../lib/contributionEffectPresentation.ts'
import { formatContributionMcpArguments, parseContributionMcpArguments } from '../lib/contributionMcpDraft.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { DOOR_CLASS } from '../lib/textDoor.ts'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { ResourcePageSection } from './ResourcePage.tsx'
import { SectionAction } from './SectionAction.tsx'
import { DeferredContributionMcpDraftHelper } from './DeferredContributionMcpDraftHelper.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { Wrench } from 'lucide-react'

type Tool = import('../../contract/mcpConnections.ts').McpDiscoveredTool
export function WorkItemMcpProposalPanel({ project, item, onOpenSession, onOpenContribution }: {
  project: Project
  item: OpenSubGoal
  onOpenSession: (id: string) => void
  onOpenContribution: (contributionId: string) => void
}) {
  const meQuery = useMe()
  const me = meQuery.data
  const tenantId = me?.tenant.id
  const itemQuery = useOpenSubGoals(project.id)
  const contributionsQuery = useContributions(project.id)
  const connectionsQuery = useMcpConnections()
  const mutation = useContributionCreationStatus()
  const dispatchMutation = useDispatchMutationStatus()
  const dispatchHeld = isDispatchHeld()
  const dispatchDraft = heldProjectWorkDraftSelection(project.id, item.id)
  const heldDispatchMcp = dispatchDraft?.mcpProposal
  const latestApplied = latestAppliedContributionCreation(project.id, item.id)
  const savedDraft = contributionCreationDraft(project.id, item.id)
  const manualDraftExists = !!savedDraft && !savedDraft.mcpDraft && !savedDraft.initialMcpProposal
  const heldCreationIntent = heldContributionCreationIntent(project.id, item.id)
  const heldIntent = heldCreationIntent?.request.initialMcpProposal ? heldCreationIntent : null
  const held = isContributionCreationHeld(project.id)
  const heldForAnother = held && !heldIntent
  const initialProposal = heldIntent?.request.initialMcpProposal ?? savedDraft?.initialMcpProposal
  const savedMcpDraft = savedDraft?.mcpDraft
  const restoredSelection = savedMcpDraft?.selection ?? (initialProposal ? {
    connectionId: initialProposal.connectionId,
    connectionRevision: initialProposal.connectionRevision,
    toolName: initialProposal.toolName,
  } : undefined)
  const restoredArguments = savedMcpDraft?.argumentsText ?? (initialProposal
    ? formatContributionMcpArguments(initialProposal.arguments)
    : '{}')
  const userId = me?.user.id
  const generation = accountGeneration()
  const identityKey = `${project.id}\0${item.id}\0${tenantId ?? ''}\0${userId ?? ''}\0${generation}`
  const identity = useRef({ projectId: project.id, itemId: item.id, tenantId, userId, generation })
  const previousIdentity = useRef(identityKey)
  const mounted = useRef(true)
  const draftRef = useRef({ title: item.subGoal, summary: '', intentId: undefined as string | undefined, isMcpProposal: false })
  const navigatedIntent = useRef('')
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(item.subGoal)
  const [summary, setSummary] = useState('')
  const [selection, setSelection] = useState<ProjectWorkMcpDraftSelection | undefined>(heldDispatchMcp ?? restoredSelection)
  const [argumentsText, setArgumentsText] = useState(restoredArguments)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [helperOpen, setHelperOpen] = useState(!!heldDispatchMcp)
  const [adoptedNotice, setAdoptedNotice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const argumentsInput = useRef<HTMLTextAreaElement>(null)

  identity.current = { projectId: project.id, itemId: item.id, tenantId, userId, generation }
  const mcpDraft = savedMcpDraft
  draftRef.current = {
    title: savedDraft?.title ?? title,
    summary: savedDraft?.summary ?? summary,
    intentId: savedDraft?.intentId ?? heldIntent?.intentId,
    isMcpProposal: !!savedDraft?.initialMcpProposal || !!savedDraft?.mcpDraft || !!heldIntent,
  }
  const currentItem = itemQuery.data?.find((candidate) => candidate.projectId === project.id && candidate.id === item.id)
  const eligibleItem = item.status === 'open' && item.type === 'mcp.mutate' && currentItem?.status === 'open' &&
    currentItem.type === 'mcp.mutate' && currentItem.target === item.target && currentItem.subGoal === item.subGoal
  const connections = connectionsQuery.data?.connections ?? []
  const choices = connections.flatMap((connection) => {
    if (connection.status !== 'connected' || connection.inspectedAt === null || connection.execution !== 'approval-required') return []
    if (!(connection.executableTools ?? []).includes(item.target)) return []
    const tool = connection.tools.find((candidate) => candidate.name === item.target)
    return tool ? [{ connection, tool }] : []
  })
  const activeSelection = heldDispatchMcp ?? heldIntent?.request.initialMcpProposal ?? selection
  const choice = activeSelection && choices.find(({ connection, tool }) =>
    connection.id === activeSelection.connectionId && connection.revision === activeSelection.connectionRevision && tool.name === activeSelection.toolName)
  const restoredChoiceMissing = !!activeSelection && !choice
  const itemReady = itemQuery.status === 'success' && eligibleItem
  const readsReady = meQuery.status === 'success' && itemQuery.status === 'success' && connectionsQuery.status === 'success' && !!me
  const parsedArguments = parseContributionMcpArguments(argumentsText)
  const showPanel = item.type === 'mcp.mutate' && (item.status === 'open' || !!heldIntent || !!heldDispatchMcp || !!mcpDraft || !!latestApplied?.initialMcpProposal)
  const blockedByCreation = held || !!savedDraft?.intentId
  const draftFieldsDisabled = blockedByCreation || !!heldIntent || !!heldDispatchMcp
  const canPublish = readsReady && itemReady && !blockedByCreation && !manualDraftExists && !heldForAnother && !!choice &&
    parsedArguments.ok && !!title.trim() && !mutation.busy && !dispatchHeld && !dispatchMutation.busy
  const retryReads = () => {
    invalidate(keys.me)
    invalidate(keys.openSubGoals(project.id))
    invalidate(keys.mcpConnections)
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const changed = previousIdentity.current !== identityKey
    previousIdentity.current = identityKey
    if (changed) {
      setExpanded(false)
      setTitle(item.subGoal)
      setSummary('')
      setSelection(undefined)
      setArgumentsText('{}')
      setDetailsOpen(false)
      setHelperOpen(false)
      setAdoptedNotice(false)
      setError(null)
      draftRef.current = { title: item.subGoal, summary: '', intentId: undefined, isMcpProposal: false }
      navigatedIntent.current = ''
    }
    if (savedDraft) {
      setTitle(savedDraft.title)
      setSummary(savedDraft.summary)
      if (savedDraft.mcpDraft) {
        setSelection(savedDraft.mcpDraft.selection)
        setArgumentsText(savedDraft.mcpDraft.argumentsText)
        setExpanded(true)
      }
      if (savedDraft.initialMcpProposal && !savedDraft.mcpDraft) {
        const proposal = savedDraft.initialMcpProposal
        setSelection({ connectionId: proposal.connectionId, connectionRevision: proposal.connectionRevision, toolName: proposal.toolName })
        setArgumentsText(formatContributionMcpArguments(proposal.arguments))
        setExpanded(true)
      }
    }
    if (heldIntent) {
      setExpanded(true)
      const proposal = heldIntent.request.initialMcpProposal
      if (proposal) {
        setSelection({ connectionId: proposal.connectionId, connectionRevision: proposal.connectionRevision, toolName: proposal.toolName })
        setArgumentsText(formatContributionMcpArguments(proposal.arguments))
      }
    }
  }, [identityKey, item.subGoal, savedDraft?.title, savedDraft?.summary, savedDraft?.intentId, savedDraft?.mcpDraft, savedDraft?.initialMcpProposal, heldIntent?.intentId])

  useEffect(() => subscribeContributionCreationApplied((event) => {
    if (!mounted.current || !draftRef.current.isMcpProposal || !event.workItemId || event.projectId !== identity.current.projectId ||
        event.workItemId !== identity.current.itemId || event.tenantId !== identity.current.tenantId ||
        event.intentId !== draftRef.current.intentId || event.title !== draftRef.current.title ||
        event.summary !== draftRef.current.summary || navigatedIntent.current === event.intentId) return
    navigatedIntent.current = event.intentId
    onOpenContribution(event.contributionId)
  }), [onOpenContribution])

  const remember = (next: { title?: string; summary?: string; selection?: ProjectWorkMcpDraftSelection; argumentsText?: string }) => {
    if (manualDraftExists || heldDispatchMcp || blockedByCreation || heldIntent) return
    const nextTitle = next.title ?? title
    const nextSummary = next.summary ?? summary
    const nextSelection = next.selection ?? selection
    const nextArguments = next.argumentsText ?? argumentsText
    setTitle(nextTitle)
    setSummary(nextSummary)
    if (next.selection) setSelection(next.selection)
    if (next.argumentsText !== undefined) setArgumentsText(next.argumentsText)
    rememberContributionCreationDraft(project.id, item.id, {
      title: nextTitle,
      summary: nextSummary,
      ...(nextSelection && choice ? { mcpDraft: {
        selection: nextSelection,
        argumentsText: nextArguments,
        connectionLabel: choice.connection.label,
        ...(choice.connection.transport === 'stdio' ? { transport: 'stdio' as const } : {}),
      } } : nextSelection && savedMcpDraft ? { mcpDraft: { ...savedMcpDraft, selection: nextSelection, argumentsText: nextArguments } } : {}),
    })
  }

  const chooseTool = (connectionId: string) => {
    if (manualDraftExists || heldDispatchMcp || blockedByCreation || heldIntent) return
    const found = choices.find(({ connection }) => connection.id === connectionId)
    if (!found) {
      if (held || savedDraft?.intentId || !clearContributionCreationDraft(project.id, item.id, 'mcp')) return
      setSelection(undefined)
      setArgumentsText('{}')
      setHelperOpen(false)
      setExpanded(false)
      setTitle(item.subGoal)
      setSummary('')
      return
    }
    const nextSelection = { connectionId: found.connection.id, connectionRevision: found.connection.revision, toolName: item.target }
    setSelection(nextSelection)
    setHelperOpen(false)
    setAdoptedNotice(false)
    setError(null)
    rememberContributionCreationDraft(project.id, item.id, {
      title, summary,
      mcpDraft: {
        selection: nextSelection,
        argumentsText,
        connectionLabel: found.connection.label,
        ...(found.connection.transport === 'stdio' ? { transport: 'stdio' as const } : {}),
      },
    })
  }

  const cancelLocalDraft = () => {
    if (held || heldIntent || heldDispatchMcp || savedDraft?.intentId || !clearContributionCreationDraft(project.id, item.id, 'mcp')) return
    setExpanded(false)
    setSelection(undefined)
    setArgumentsText('{}')
    setTitle(item.subGoal)
    setSummary('')
    setDetailsOpen(false)
    setHelperOpen(false)
    setAdoptedNotice(false)
    setError(null)
  }

  const adoptArguments = (value: ContributionMcpSelection['arguments']) => {
    if (manualDraftExists || heldDispatchMcp || blockedByCreation || heldIntent || !readsReady || !itemReady ||
        connectionsQuery.status !== 'success' || restoredChoiceMissing || !choice) return
    remember({ argumentsText: formatContributionMcpArguments(value) })
    setAdoptedNotice(true)
    setHelperOpen(false)
    requestAnimationFrame(() => argumentsInput.current?.focus())
  }

  const publish = async () => {
    if (!canPublish || manualDraftExists || heldDispatchMcp || isContributionCreationHeld(project.id) || !me || !choice || !parsedArguments.ok || !selection ||
        itemQuery.status !== 'success' || connectionsQuery.status !== 'success' || !eligibleItem) return
    const requestedProjectId = project.id
    const requestedItemId = item.id
    const requestedTenantId = me.tenant.id
    const requestedGeneration = accountGeneration()
    const requestedUserId = me.user.id
    const stillSameRequest = () => mounted.current && identity.current.projectId === requestedProjectId &&
      identity.current.itemId === requestedItemId && identity.current.tenantId === requestedTenantId &&
      identity.current.userId === requestedUserId && identity.current.generation === requestedGeneration && accountGeneration() === requestedGeneration
    const requestSelection: ContributionMcpSelection = {
      connectionId: choice.connection.id,
      connectionRevision: choice.connection.revision,
      toolName: item.target,
      arguments: parsedArguments.value,
    }
    rememberContributionCreationDraft(project.id, item.id, {
      title, summary,
      mcpDraft: {
        selection: { connectionId: choice.connection.id, connectionRevision: choice.connection.revision, toolName: item.target },
        argumentsText,
        connectionLabel: choice.connection.label,
        ...(choice.connection.transport === 'stdio' ? { transport: 'stdio' as const } : {}),
      },
    })
    setError(null)
    try {
      const pending = enqueueContributionCreation({
        tenantId: me.tenant.id,
        projectId: project.id,
        request: {
          title: title.trim(),
          summary: summary.trim() || undefined,
          subGoal: item.subGoal,
          workItemId: item.id,
          initialMcpProposal: requestSelection,
        },
      })
      const submitted = heldContributionCreationIntent(project.id, item.id)
      if (submitted) draftRef.current = {
        title: submitted.request.title,
        summary: submitted.request.summary ?? '',
        intentId: submitted.intentId,
        isMcpProposal: true,
      }
      const result = await pending
      if (!stillSameRequest()) return
      if (result.outcome === 'applied' && navigatedIntent.current !== result.intentId) {
        navigatedIntent.current = result.intentId
        onOpenContribution(result.contributionId)
      } else if (result.outcome !== 'applied') {
        setError('Couldn’t confirm whether this Contribution was published. The exact MCP call is retained; check the Changes ledger before starting another.')
      }
    } catch (cause) {
      if (!stillSameRequest()) return
      setError(`Couldn’t confirm whether this Contribution was published. The exact MCP call is retained. ${cause instanceof Error ? cause.message : 'Check the Changes ledger before starting another.'}`)
    }
  }

  if (!showPanel) return null
  return <ResourcePageSection
    title="Work this item now"
    summary="Draft an exact MCP call, review its arguments, and publish one unapproved Contribution."
    defaultFolded
    reveal={expanded || !!heldIntent || !!heldDispatchMcp || !!latestApplied?.initialMcpProposal}
    heldOpen={!!heldIntent || !!heldDispatchMcp}
    actions={<SectionAction
      label="Work this item now"
      icon={<Wrench size={14} />}
      expanded={expanded || !!heldIntent || !!heldDispatchMcp || !!mcpDraft || !!latestApplied?.initialMcpProposal}
      disabled={!!heldIntent || !!heldDispatchMcp || (!!mcpDraft?.selection && !!savedDraft?.intentId)}
      disabledReason={heldDispatchMcp ? 'The exact model argument-draft request is being resolved.' : 'A Contribution request is being resolved.'}
      onClick={() => { if (!heldIntent && !heldDispatchMcp && !blockedByCreation) setExpanded((current) => !current) }}
    />}
  >
    {latestApplied?.initialMcpProposal && contributionsQuery.status === 'success' && (() => {
      const applied = contributionsQuery.data?.find((contribution) => contribution.id === latestApplied.contributionId && contribution.workItemId === item.id)
      return applied ? <p role="status" data-work-item-mcp-proposal-applied className="mb-3 text-[11px] text-ink-soft">
        This exact MCP Contribution was published. <button type="button" aria-label="Open saved Contribution" onClick={() => onOpenContribution(applied.id)} className={`max-w-full break-words text-left [overflow-wrap:anywhere] font-medium underline underline-offset-2 ${DOOR_CLASS}`}>Open saved Contribution</button>
      </p> : null
    })()}
    {manualDraftExists && <p role="status" data-work-item-mcp-proposal-manual-draft className="mb-3 text-[11px] text-ink-soft">A prose Contribution draft is already saved for this item. Continue in the Contributions form below, or cancel that draft there before starting a structured MCP proposal.</p>}
    {expanded || heldIntent || heldDispatchMcp || mcpDraft ? !manualDraftExists ? <section data-work-item-mcp-proposal className="min-w-0 space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">Choose a currently inspected connection for the exact tool <span className="break-words [overflow-wrap:anywhere] font-mono">{item.target}</span>. Nothing runs here. Publishing shares the reviewed arguments with Project readers and creates one unapproved call; approval and Run remain separate.</p>
      {(connectionsQuery.status === 'error' || itemQuery.status === 'error' || meQuery.status === 'error') && <InlineOperationStatus tone="alert" message="Couldn’t refresh account, work item, or inspected MCP tools. No call can be published until current reads succeed." action={{ label: 'Retry reads', onClick: retryReads }} />}
      {(connectionsQuery.status === 'idle' || connectionsQuery.status === 'loading' || itemQuery.status === 'idle' || itemQuery.status === 'loading' || meQuery.status === 'idle' || meQuery.status === 'loading') && <p role="status" className="text-[11px] text-ink-faint">Checking the open work item, account, and inspected MCP tools…</p>}
      {itemQuery.status === 'success' && !eligibleItem && <p role="alert" className="text-[11px] text-warn-text">This work item is no longer open for the exact MCP target. No Contribution can be published from this form.</p>}
      <label className="block min-w-0 text-[11px] font-medium text-ink-soft">Inspected MCP tool
        <select
          aria-label="MCP tool"
          data-work-item-mcp-proposal-tool
          value={activeSelection ? `${activeSelection.connectionId}\0${activeSelection.connectionRevision}\0${activeSelection.toolName}` : ''}
          onChange={(event) => chooseTool(event.target.value.split('\0')[0] ?? '')}
          disabled={blockedByCreation || connectionsQuery.status !== 'success' || itemQuery.status !== 'success' || !eligibleItem || !!heldIntent || !!heldDispatchMcp}
          className={`${FORM_INPUT_CLASS} mt-1 w-full min-w-0`}
        >
          <option value="">Choose an inspected connection for {item.target}…</option>
          {restoredChoiceMissing && activeSelection && <option value={`${activeSelection.connectionId}\0${activeSelection.connectionRevision}\0${activeSelection.toolName}`}>
            {savedMcpDraft?.connectionLabel ?? dispatchDraft?.mcpLabels?.connection ?? 'Saved connection'} · {activeSelection.toolName} · saved revision {activeSelection.connectionRevision}
          </option>}
          {choices.map(({ connection, tool }) => <option key={`${connection.id}:${connection.revision}:${tool.name}`} value={`${connection.id}\0${connection.revision}\0${tool.name}`}>
            {connection.label} · {tool.title || tool.name}{connection.transport === 'stdio' ? ' · Local MCP process' : ''}
          </option>)}
        </select>
      </label>
      {connectionsQuery.status === 'success' && choices.length === 0 && <p className="text-[11px] text-ink-faint">No connected, inspected MCP tool currently matches this work item’s exact target.</p>}
      {restoredChoiceMissing && <p role="alert" data-work-item-mcp-proposal-stale className="text-[11px] text-warn-text">The saved connection or revision is no longer current. The exact saved choice is retained; choose a current matching tool explicitly before publishing.</p>}
      {activeSelection && <div data-work-item-mcp-proposal-review className="min-w-0 space-y-2 rounded-md border border-line bg-panel px-2.5 py-2">
        <h3 className="text-[11px] font-semibold text-ink">Review the exact call to publish</h3>
        <p className="break-words text-[11px] leading-relaxed text-ink-soft">{choice?.connection.label ?? savedMcpDraft?.connectionLabel ?? 'Saved connection'} · <span className="font-mono">{activeSelection.toolName}</span>. The server rechecks this inspected connection and schema before creating the Contribution.</p>
        {(choice?.connection.transport === 'stdio' || savedMcpDraft?.transport === 'stdio') && <p data-work-item-mcp-proposal-stdio className="text-[11px] leading-relaxed text-ink-soft">{CONTRIBUTION_LOCAL_STDIO_DISCLOSURE}</p>}
        {choice && <details className="text-[11px] text-ink-soft">
          <summary className="cursor-pointer font-medium">Review inspected tool schema</summary>
          <pre tabIndex={0} aria-label="Inspected MCP tool schema" className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface p-2 font-mono text-[10px]">{JSON.stringify(choice.tool.inputSchema, null, 2)}</pre>
        </details>}
        {(helperOpen || !!heldDispatchMcp) && choice ? <DeferredContributionMcpDraftHelper
          project={project}
          item={item}
          selection={activeSelection}
          tool={choice.tool as Tool}
          connectionLabel={choice.connection.label}
          connectionTransport={choice.connection.transport}
          currentArgumentsText={argumentsText}
          disabled={blockedByCreation || !itemReady || connectionsQuery.status !== 'success' || restoredChoiceMissing}
          onOpenSession={onOpenSession}
          onAdopt={adoptArguments}
          onClose={() => setHelperOpen(false)}
        /> : <button type="button" data-work-item-mcp-proposal-draft onClick={() => setHelperOpen(true)} disabled={!choice || blockedByCreation || !!heldIntent || !itemReady || restoredChoiceMissing} className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[11px] disabled:opacity-45`}>Draft arguments with a model</button>}
        <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} className="text-[11px] text-ink-soft">
          <summary className="cursor-pointer font-medium">Contribution details</summary>
          <div className="mt-2 space-y-2">
            <label className="block">Title
              <input aria-label="Contribution title" value={title} maxLength={CONTRIBUTION_FIELD_MAX} disabled={draftFieldsDisabled} onChange={(event) => remember({ title: event.target.value })} className={`${FORM_INPUT_CLASS} mt-1 w-full`} />
            </label>
            <label className="block">Summary
              <textarea aria-label="Contribution summary" value={summary} maxLength={CONTRIBUTION_FIELD_MAX} rows={3} disabled={draftFieldsDisabled} onChange={(event) => remember({ summary: event.target.value })} className={`${FORM_INPUT_CLASS} mt-1 w-full resize-y`} />
            </label>
          </div>
        </details>
        <label className="block text-[11px] font-medium text-ink-soft">Reviewed arguments for {activeSelection.toolName}
          <textarea
            aria-label="MCP arguments"
            data-work-item-mcp-proposal-arguments
            id="work-item-mcp-proposal-arguments"
            ref={argumentsInput}
            aria-describedby={adoptedNotice ? 'work-item-mcp-proposal-adopted' : undefined}
            value={argumentsText}
            rows={6}
            disabled={draftFieldsDisabled}
            onChange={(event) => { setAdoptedNotice(false); remember({ argumentsText: event.target.value }) }}
            className={`${FORM_INPUT_CLASS} mt-1 w-full resize-y font-mono text-[11px]`}
          />
        </label>
        {adoptedNotice && <p id="work-item-mcp-proposal-adopted" role="status" data-work-item-mcp-proposal-adopted className="text-[11px] text-ink-soft">Copied from the saved reply. Review these exact arguments before publishing.</p>}
        {!parsedArguments.ok && <p role="alert" data-work-item-mcp-proposal-invalid className="text-[11px] text-danger">{parsedArguments.message}</p>}
      </div>}
      {heldForAnother && <p role="status" className="text-[11px] text-ink-faint">Another Contribution for this Project is being resolved. This exact draft is retained and cannot be submitted yet.</p>}
      {dispatchHeld && <p role="status" className="text-[11px] text-ink-faint">A model argument draft is being resolved. Wait for its saved reply or dismiss the shared Dispatch notice before publishing.</p>}
      {mcpDraft && !savedDraft?.intentId && !heldDispatchMcp && <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" data-work-item-mcp-proposal-cancel onClick={cancelLocalDraft} disabled={held || !!heldIntent} className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[11px] disabled:opacity-45`}>Cancel MCP proposal draft</button>
        <span className="text-[10px] text-ink-faint">This clears local edits only; any saved model reply remains in Dispatch.</span>
      </div>}
      {mutation.error && heldIntent && <p role="status" className="text-[11px] text-warn-text">This MCP Contribution is held for safe recovery. Use the shared notice to Retry or Dismiss.</p>}
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
      {choice && <p className="text-[10px] leading-relaxed text-ink-faint">The complete tool schema and saved workspace reply are visible to workspace members. Publishing shares this exact call with Project readers but does not run it.</p>}
      <button
        type="button"
        data-work-item-mcp-proposal-publish
        onClick={() => void publish()}
        disabled={!canPublish}
        className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-45`}
      >{heldIntent ? 'Publishing…' : 'Publish contribution'}</button>
    </section> : <p className="text-[12px] text-ink-faint">Choose a tool and review its exact arguments to publish one linked Contribution.</p> : null}
  </ResourcePageSection>
}
