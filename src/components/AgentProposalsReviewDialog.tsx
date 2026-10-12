import { useEffect, useRef, type ComponentType } from 'react'
import { AlertCircle, X, type LucideIcon } from 'lucide-react'
import type { Agent, AgentChangeProposal } from '../../contract/index.ts'
import { useMe } from '../api/hooks.ts'
import {
  enqueueAgentProposalVerdict,
  heldAgentProposalVerdictIntent,
  useAgentProposalVerdictStatus,
} from '../controller/agentProposalVerdictMutations.ts'
import { FOCUS_FLASH_CLASS } from '../lib/focusContext.ts'
import { relativeTime } from '../lib/relativeTime.ts'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'

type ThreadProps = { agentId: string; proposal: AgentChangeProposal; openForComments: boolean }
type DiffProps = { fields: AgentChangeProposal['fields']; current: Record<string, string> }

export function AgentProposalsReviewDialog({
  agent,
  proposals,
  onClose,
  focusProposalId = null,
  Thread,
  FieldDiff,
  GitPullRequestIcon,
  GitMergeIcon,
}: {
  agent: Agent
  proposals: AgentChangeProposal[]
  onClose: () => void
  focusProposalId?: string | null
  Thread: ComponentType<ThreadProps>
  FieldDiff: ComponentType<DiffProps>
  GitPullRequestIcon: LucideIcon
  GitMergeIcon: LucideIcon
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, onClose)
  const tenantId = useMe().data?.tenant.id
  useAgentProposalVerdictStatus()
  const currentVersion = agent.version ?? 1
  const focusRef = useRef<HTMLDivElement>(null)
  const focusPresent = proposals.some((proposal) => proposal.id === focusProposalId)
  useEffect(() => {
    if (focusProposalId && focusPresent) focusRef.current?.scrollIntoView({ block: 'center' })
  }, [focusProposalId, focusPresent])
  const verdict = (proposalId: string, action: 'merge' | 'decline') => {
    if (!tenantId) return
    void enqueueAgentProposalVerdict({ tenantId, agentId: agent.id, proposalId, action })
  }
  const current: Record<string, string> = {
    label: agent.label,
    systemPrompt: agent.systemPrompt,
    instructions: agent.instructions,
    tools: agent.tools.join(', '),
  }
  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[10dvh] short:pt-[5dvh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Proposals — ${agent.label}`}
    >
      <div className={SCRIM_CLASS} />
      <div ref={dialogRef} onMouseDown={(event) => event.stopPropagation()}
        className={`relative flex max-h-[76dvh] w-[640px] max-w-full flex-col ${DIALOG_SURFACE_CLASS}`}>
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
          <GitPullRequestIcon size={16} className="shrink-0 text-ink-faint" />
          <span style={{ overflowWrap: 'anywhere' }} className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
            Proposals — {agent.label} <span className="font-normal text-ink-faint">(v{currentVersion})</span>
          </span>
          <button onClick={onClose} aria-label="Close" className="text-ink-faint transition hover:text-ink"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {proposals.map((proposal) => {
            const isFocus = proposal.id === focusProposalId
            const heldVerdict = heldAgentProposalVerdictIntent(agent.id, proposal.id)
            return <div key={proposal.id} ref={isFocus ? focusRef : undefined}
              className={`scroll-mt-4 rounded-xl border p-3 transition-colors ${isFocus ? `border-co ${FOCUS_FLASH_CLASS}` : 'border-line'}`}>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-medium text-ink">{proposal.proposedBy}</span>
                <span className="text-ink-faint">· {relativeTime(proposal.at)} · against v{proposal.baseVersion}</span>
                {proposal.status === 'open' && proposal.baseVersion < currentVersion && <span
                  title="Authored against an older version — review with care (never auto-rebased)"
                  className="rounded-full bg-warn/10 px-1.5 py-px text-[10px] font-medium text-warn-text">stale</span>}
                {proposal.status !== 'open' && <span className="rounded-full bg-panel-2 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-faint">{proposal.status}</span>}
                {proposal.status !== 'open' && proposal.resolvedAt && <span className="text-ink-faint">· {relativeTime(proposal.resolvedAt)}</span>}
              </div>
              {proposal.note && <p className="mt-1 text-[12px] text-ink-soft">{proposal.note}</p>}
              <FieldDiff fields={proposal.fields} current={current} />
              {proposal.check && <p className="mt-2 flex items-start gap-1 rounded-lg bg-warn/10 px-2 py-1.5 text-[11px] leading-snug text-warn-text">
                <AlertCircle size={12} className="mt-0.5 shrink-0" /> {proposal.check.note}
              </p>}
              <Thread agentId={agent.id} proposal={proposal} openForComments={proposal.status === 'open'} />
              {proposal.status === 'open' || heldVerdict ? <div
                className="mt-2.5 flex items-center gap-2"
                data-agent-proposal-verdict={heldVerdict ? 'held' : 'ready'}
                aria-busy={heldVerdict ? 'true' : undefined}>
                <button onClick={() => void verdict(proposal.id, 'merge')} disabled={!!heldVerdict}
                  className={`inline-flex items-center gap-1.5 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}>
                  <GitMergeIcon size={13} /> {heldVerdict?.action === 'merge' ? 'Merging…' : 'Merge'}
                </button>
                <button onClick={() => void verdict(proposal.id, 'decline')} disabled={!!heldVerdict} className={INLINE_ACTION_CLASS}>
                  {heldVerdict?.action === 'decline' ? 'Declining…' : 'Decline'}
                </button>
              </div> : proposal.responseNote ? <p className="mt-2 text-[11px] text-ink-faint">Owner’s note: {proposal.responseNote}</p> : null}
            </div>
          })}
        </div>
      </div>
    </div>
  )
}
