import { useEffect, useRef, useState } from 'react'
import { CONTRIBUTION_FIELD_MAX, type Contribution, type OpenSubGoal } from '../../contract/index.ts'
import { useContributions, useMe } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { accountGeneration } from '../api/account.ts'
import {
  contributionCreationDraft,
  enqueueContributionCreation,
  heldContributionCreationIntent,
  isContributionCreationHeld,
  rememberContributionCreationDraft,
  subscribeContributionCreationApplied,
  useContributionCreationStatus,
} from '../controller/contributionCreationMutations.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { DOOR_CLASS } from '../lib/textDoor.ts'
import { LEDGER_LIST_CLASS } from '../lib/ledger.ts'
import { ResourcePageSection } from './ResourcePage.tsx'
import { SectionAction } from './SectionAction.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { Plus } from 'lucide-react'

export function WorkItemContributionPanel({
  projectId,
  item,
  onOpenContribution,
}: {
  projectId: string
  item: OpenSubGoal
  onOpenContribution: (contributionId: string) => void
}) {
  const query = useContributions(projectId)
  const me = useMe().data
  const mutation = useContributionCreationStatus()
  const held = isContributionCreationHeld(projectId)
  const heldIntent = heldContributionCreationIntent(projectId, item.id)
  const savedDraft = contributionCreationDraft(projectId, item.id)
  const heldForAnotherContribution = held && !heldIntent
  const linked = (query.data ?? []).filter((contribution) => contribution.workItemId === item.id)
    .sort((a, b) => b.openedAt - a.openedAt)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState(item.subGoal)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const identity = useRef({ projectId, itemId: item.id, tenantId: me?.tenant.id })
  const identityKey = `${projectId}\0${item.id}\0${me?.tenant.id ?? ''}`
  const previousIdentityKey = useRef(identityKey)
  const draftRef = useRef({ title, summary, intentId: savedDraft?.intentId })
  draftRef.current = { title, summary, intentId: savedDraft?.intentId ?? draftRef.current.intentId }
  identity.current = { projectId, itemId: item.id, tenantId: me?.tenant.id }
  const eligible = item.status === 'open' && item.type === 'mcp.mutate'
  const count = `${linked.length} linked contribution${linked.length === 1 ? '' : 's'}`

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const identityChanged = previousIdentityKey.current !== identityKey
    previousIdentityKey.current = identityKey
    if (identityChanged) {
      setComposing(false)
      setTitle(item.subGoal)
      setSummary('')
      setError(null)
      draftRef.current = { title: item.subGoal, summary: '', intentId: undefined }
    }
    if (savedDraft) {
      setComposing(true)
      setTitle(savedDraft.title)
      setSummary(savedDraft.summary)
      draftRef.current = { title: savedDraft.title, summary: savedDraft.summary, intentId: savedDraft.intentId }
    }
    if (heldIntent) setError(null)
  }, [identityKey, item.id, item.subGoal, savedDraft?.title, savedDraft?.summary, savedDraft?.intentId, heldIntent?.intentId])

  useEffect(() => subscribeContributionCreationApplied((event) => {
    if (
      event.tenantId !== identity.current.tenantId ||
      event.projectId !== identity.current.projectId ||
      event.workItemId !== identity.current.itemId ||
      event.intentId !== draftRef.current.intentId ||
      event.title !== draftRef.current.title ||
      event.summary !== draftRef.current.summary ||
      !mounted.current
    ) return
    setComposing(false)
    setTitle(item.subGoal)
    setSummary('')
    setError(null)
    draftRef.current = { title: item.subGoal, summary: '', intentId: undefined }
  }), [item.subGoal])

  const start = async () => {
    if (!eligible || !me || held || !title.trim()) return
    const requestedItemId = item.id
    const requestedProjectId = projectId
    const requestedTenantId = me.tenant.id
    const requestedAccountGeneration = accountGeneration()
    const stillSameRequest = () => mounted.current &&
      identity.current.projectId === requestedProjectId &&
      identity.current.itemId === requestedItemId &&
      identity.current.tenantId === requestedTenantId &&
      accountGeneration() === requestedAccountGeneration
    setError(null)
    rememberContributionCreationDraft(projectId, item.id, { title, summary })
    try {
      const pending = enqueueContributionCreation({
        tenantId: me.tenant.id,
        projectId,
        request: {
          title: title.trim(),
          summary: summary.trim() || undefined,
          subGoal: item.subGoal,
          workItemId: item.id,
        },
      })
      const submittedIntent = heldContributionCreationIntent(projectId, item.id)
      if (submittedIntent) {
        draftRef.current = {
          title: submittedIntent.request.title,
          summary: submittedIntent.request.summary ?? '',
          intentId: submittedIntent.intentId,
        }
      }
      const result = await pending
      if (!stillSameRequest()) return
      if (result.outcome === 'applied') {
        setComposing(false)
        onOpenContribution(result.contributionId)
      } else {
        setError('Couldn’t confirm whether this Contribution was created. Your title and summary are retained; check the Changes ledger before starting another.')
      }
    } catch (cause) {
      if (!stillSameRequest()) return
      setError(`Couldn’t confirm whether this Contribution was created. Your title and summary are retained. ${cause instanceof Error ? cause.message : 'Check the Changes ledger before starting another.'}`)
    }
  }

  return (
    <div data-work-item-contribution>
    <ResourcePageSection
      title="Contributions"
      summary={count}
      heldOpen={Boolean(heldIntent) || composing}
      actions={eligible ? (
        <SectionAction
          label="Start contribution"
          icon={<Plus size={14} />}
          expanded={composing}
          disabled={!me || held}
          disabledReason={heldForAnotherContribution ? 'Another Contribution for this Project is being resolved; this form is not part of that request.' : heldIntent ? 'This Contribution is being resolved.' : 'Waiting for your account'}
          onClick={() => { if (!held) setComposing((open) => !open) }}
        />
      ) : undefined}
    >
      <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">
        {item.status === 'open'
          ? <>A linked Contribution organizes the work but does not claim or reserve this work item. Its MCP effect must use the exact tool name “<span className="break-words [overflow-wrap:anywhere]">{item.target}</span>”. The Project owner can resolve this work item only after that matching effect has a successful saved MCP result.</>
          : 'This work item is closed. Existing linked Contributions remain visible, but cannot resolve it.'}
      </p>
      {query.status === 'error' && (
        <InlineOperationStatus
          tone="alert"
          message="Couldn’t refresh linked Contributions. Previously loaded entries may be out of date."
          action={{ label: 'Retry', onClick: () => invalidate(keys.contributions(projectId)) }}
        />
      )}
      {!query.data && query.status !== 'error' && <p role="status" className="mb-2 text-[12px] text-ink-faint">Loading linked Contributions…</p>}
      {linked.length > 0 ? (
        <ul className={LEDGER_LIST_CLASS}>
          {linked.map((contribution) => (
            <li key={contribution.id} className="flex min-w-0 items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenContribution(contribution.id)}
                  className={`block min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-left text-[13px] text-ink ${DOOR_CLASS}`}
                >
                  {contribution.title}
                </button>
                <p className="text-[11px] text-ink-faint">
                  {linkedContributionStatus(contribution, item.contributionResolution?.contributionId === contribution.id)} · {contribution.contributor}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : query.data ? (
        <p className="text-[12px] text-ink-faint">No Contributions are linked to this work item yet.</p>
      ) : null}
      {composing && (eligible || Boolean(heldIntent) || Boolean(savedDraft)) && (
        <div data-work-item-contribution-form className="mt-3 space-y-2" aria-busy={Boolean(heldIntent) || undefined}>
          <input
            aria-label="Contribution title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              rememberContributionCreationDraft(projectId, item.id, { title: event.target.value, summary })
            }}
            disabled={held || !eligible}
            maxLength={CONTRIBUTION_FIELD_MAX}
            className={FORM_INPUT_CLASS}
          />
          <textarea
            aria-label="Contribution summary"
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value)
              rememberContributionCreationDraft(projectId, item.id, { title, summary: event.target.value })
            }}
            disabled={held || !eligible}
            maxLength={CONTRIBUTION_FIELD_MAX}
            rows={3}
            className={`${FORM_INPUT_CLASS} resize-y`}
          />
          {eligible && <p className="text-[11px] leading-relaxed text-ink-faint">
            Configure the effect with tool name “<span className="break-words [overflow-wrap:anywhere]">{item.target}</span>”. Multiple Contributions may be linked; this does not reserve the item.
          </p>}
          {eligible && <button
            type="button"
            data-work-item-contribution-submit
            onClick={() => void start()}
            disabled={!me || held || !title.trim()}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            {heldIntent ? 'Starting…' : 'Create contribution'}
          </button>}
          {!eligible && <p role="status" className="text-[11px] text-ink-faint">The work item is closed; the retained form is read-only.</p>}
          {mutation.error && heldIntent && <p role="status" className="text-[11px] text-warn-text">This Contribution is held for safe recovery. Use the shared notice to Retry or Dismiss.</p>}
          {heldForAnotherContribution && <p role="status" className="text-[11px] text-ink-faint">Another Contribution for this Project is being resolved; this edited form has not been submitted.</p>}
          {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
        </div>
      )}
    </ResourcePageSection>
    </div>
  )
}

function linkedContributionStatus(contribution: Contribution, resolvedThisItem: boolean): string {
  if (contribution.status === 'landed' && contribution.workItemResolution === 'closed') {
    return resolvedThisItem
      ? 'Landed and resolved this work item'
      : 'Landed; linked work item closed by another act'
  }
  if (contribution.status === 'open' && contribution.workItemResolution === 'closed') {
    return 'Open; linked work item closed by another act'
  }
  return contribution.status === 'landed' ? `Landed · L${contribution.landingNumber}` : 'Open'
}
