import { useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import type { SocialEntityRef } from '../../contract/index.ts'
import type { Project } from '../data/cowork.ts'
import { useContributions, useMe, useSocialCapability, useSocialProposals } from '../api/hooks.ts'
import {
  enqueueSocialProposalCreation,
  isSocialProposalCreationHeld,
  useSocialProposalCreationStatus,
} from '../controller/socialProposalCreationMutations.ts'
import { enqueueContributionCreation, isContributionCreationHeld, useContributionCreationStatus } from '../controller/contributionCreationMutations.ts'
import { countOr } from '../lib/countLabel.ts'
import { relativeTime } from '../lib/relativeTime.ts'
import { DOOR_CLASS } from '../lib/textDoor.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction.ts'
import { SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { ResourcePageList, ResourcePageSection } from './ResourcePage.tsx'
import { SectionAction } from './SectionAction.tsx'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { ProposalDeltaView } from './DeltaView.tsx'
import { ProposalVerdictActions } from './ProposalVerdictActions.tsx'

/** The merged project history: durable Contributions and typed proposals. */
export function ChangesPanel({ project, own, onOpenSession, onOpenContribution, onOpenDiscussion }: { project: Project; own: boolean; onOpenSession: (id: string) => void; onOpenContribution: (id: string) => void; onOpenDiscussion: (id: string) => void }) {
  const subject: SocialEntityRef = { kind: 'project', id: project.id }
  const contributionList = useContributions(project.id).data ?? []
  const proposalList = useSocialProposals(subject.kind, subject.id).data ?? []
  const tenantId = useMe().data?.tenant.id
  useContributionCreationStatus()
  useSocialProposalCreationStatus()
  const canPropose = useSocialCapability(subject.kind, subject.id).data?.canPropose === true
  const [composing, setComposing] = useState<'contribution' | 'proposal' | null>(null)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [contributionError, setContributionError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [rationale, setRationale] = useState('')
  const [offerError, setOfferError] = useState<string | null>(null)
  const contributionHeld = isContributionCreationHeld(project.id)
  const proposalHeld = isSocialProposalCreationHeld(subject)
  const changesHeld = contributionHeld || proposalHeld
  const openPage = onOpenContribution
  const declare = async () => {
    if (changesHeld || !tenantId || !title.trim()) return
    setContributionError(null)
    try {
      const result = await enqueueContributionCreation({
        tenantId,
        projectId: project.id,
        request: { title: title.trim(), summary: summary.trim() || undefined },
      })
      if (result.outcome === 'applied') {
        setTitle('')
        setSummary('')
        setComposing(null)
        openPage(result.contributionId)
      } else {
        setContributionError('Your Contribution is still here. Review it, then declare it again when ready.')
      }
    } catch (cause) {
      setContributionError(cause instanceof Error ? cause.message : 'Could not declare this Contribution.')
    }
  }
  const offer = async () => {
    if (changesHeld || !tenantId || !text.trim() || !rationale.trim()) return
    setOfferError(null)
    try {
      const outcome = await enqueueSocialProposalCreation({
        tenantId,
        request: { subject, delta: { kind: 'suggestion', text: text.trim() }, rationale: rationale.trim() },
      })
      if (outcome === 'applied') {
        setText('')
        setRationale('')
        setComposing(null)
      } else {
        setOfferError('Your change offer is still here. Review it, then offer it again when ready.')
      }
    } catch (cause) {
      setOfferError(cause instanceof Error ? cause.message : 'Could not offer this change.')
    }
  }
  const rows = [
    ...contributionList.map((c) => ({ key: c.id, band: c.status === 'open' ? 0 : 1, order: c.status === 'open' ? c.openedAt : (c.landingNumber ?? 0), c, p: undefined })),
    ...proposalList.map((p) => ({ key: p.id, band: p.state === 'offered' ? 0 : p.state === 'landed' ? 1 : 2, order: p.state === 'landed' ? (p.landingNumber ?? 0) : p.offeredAt, c: undefined, p })),
  ].sort((a, b) => a.band - b.band || b.order - a.order)

  return (
    <ResourcePageSection
      title="Changes"
      heldOpen={changesHeld}
      summary={countOr(rows.length, 'entry', 'entries', 'Nothing yet')}
      actions={<>
        <SectionAction label="Declare work" icon={<Plus size={14} />} onClick={() => { if (!changesHeld) setComposing((value) => value === 'contribution' ? null : 'contribution') }} expanded={composing === 'contribution'} disabled={changesHeld || !tenantId} disabledReason={changesHeld ? 'Finish the current Changes action first' : 'Waiting for your account'} />
        {canPropose && <SectionAction label={proposalHeld ? 'Offering change' : 'Offer a change'} icon={<Sparkles size={14} />} onClick={() => { if (!changesHeld) setComposing((value) => value === 'proposal' ? null : 'proposal') }} expanded={composing === 'proposal'} disabled={changesHeld || !tenantId} disabledReason={changesHeld ? 'Finish the current Changes action first' : 'Waiting for your account'} />}
      </>}
    >
      {composing === 'proposal' && <div data-social-proposal-creation-form className="mb-3 space-y-1.5" aria-busy={changesHeld}>
        <textarea aria-label="The change you propose" value={text} onChange={(event) => setText(event.target.value)} disabled={changesHeld} placeholder="The change — what should be different?" rows={2} className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong resize-none" />
        <input aria-label="Why this change" value={rationale} onChange={(event) => setRationale(event.target.value)} disabled={changesHeld} placeholder="Why — opens the review thread" className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong" />
        <button onClick={() => void offer()} disabled={changesHeld || !tenantId || !text.trim() || !rationale.trim()} className={INLINE_ACTION_CLASS}>{proposalHeld ? 'Offering…' : 'Offer'}</button>
        {offerError && <p className="text-[11px] text-danger">{offerError}</p>}
      </div>}
      {composing === 'contribution' && <div data-contribution-creation-form className="mb-3 space-y-1.5" aria-busy={changesHeld}>
        <p className="text-[11px] leading-relaxed text-ink-faint">Name the intended change before work begins. This becomes its durable record for review and landing.</p>
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void declare(); if (event.key === 'Escape' && !changesHeld) setComposing(null) }} placeholder="What will change? (required)" aria-label="Contribution title" disabled={changesHeld} className={FORM_INPUT_CLASS} />
        <div className="flex items-center gap-1.5">
          <input value={summary} onChange={(event) => setSummary(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void declare(); if (event.key === 'Escape' && !changesHeld) setComposing(null) }} placeholder="Why, scope, or constraints (optional)…" aria-label="Contribution summary" disabled={changesHeld} className={`${FORM_INPUT_CLASS} min-w-0 flex-1`} />
          <button onClick={() => void declare()} disabled={changesHeld || !tenantId || !title.trim()} className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}>{contributionHeld ? 'Declaring…' : 'Declare'}</button>
        </div>
        {contributionError && <p className="text-[11px] text-danger">{contributionError}</p>}
      </div>}
      {rows.length === 0 && composing === null ? <p className="text-[12px] text-ink-faint">Nothing yet. A contribution is declared before the work; a proposal is a typed change the owner lands by consent. Both land as numbered entries — one history, L1 up.</p> : rows.length > 0 ? (
        <ResourcePageList>
          {rows.map((row) => {
            if (row.c) return <div key={row.key} className="flex items-center gap-2.5 py-3">
              <span className="flex w-8 shrink-0 items-center justify-end">{row.c.status === 'open' ? <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-label="In flight" /> : <span className="text-[12px] font-semibold tabular-nums text-ink-faint">L{row.c.landingNumber}</span>}</span>
              <div className="min-w-0 flex-1">
                <button onClick={() => openPage(row.c!.id)} className={`block max-w-full truncate text-left text-[13px] text-ink ${DOOR_CLASS}`}>{row.c.title}</button>
                <div className="truncate text-[11px] text-ink-faint">by {row.c.contributor}{row.c.status === 'open' ? ` · opened ${relativeTime(row.c.openedAt)}` : row.c.landedAt ? ` · landed ${relativeTime(row.c.landedAt)}` : ''}{row.c.subGoal ? ` · ${row.c.subGoal}` : ''}{row.c.envelope ? ` · ${row.c.envelope.lines.length} act${row.c.envelope.lines.length === 1 ? '' : 's'} ${row.c.envelope.status === 'approved' ? '· approved' : '· awaiting approval'}` : ''}</div>
              </div>
              {row.c.status === 'open' && row.c.sessionId && row.c.mine === true && <button onClick={() => onOpenSession(row.c!.sessionId!)} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink" title="Open the conversation doing this work">View the work</button>}
            </div>
            if (row.p) return <div key={row.key} className="flex items-start gap-2.5 py-3">
              <span className="flex w-8 shrink-0 items-center justify-end pt-0.5">{row.p.state === 'offered' ? <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-label="Offered" /> : row.p.state === 'landed' ? <span className="text-[12px] font-semibold tabular-nums text-ink-faint">L{row.p.landingNumber}</span> : <span className="text-[11px] text-ink-faint">no</span>}</span>
              <div className="min-w-0 flex-1"><ProposalDeltaView proposal={row.p} /><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint"><span>by {row.p.offeredBy} {relativeTime(row.p.offeredAt)}</span><button onClick={() => onOpenDiscussion(row.p!.discussionId)} className={INLINE_ACTION_CLASS}>Review thread</button><ProposalVerdictActions proposal={row.p} subject={subject} own={own} /></div></div>
            </div>
            return null
          })}
        </ResourcePageList>
      ) : null}
    </ResourcePageSection>
  )
}
