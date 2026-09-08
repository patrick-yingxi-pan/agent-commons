/** ── Improvements on any subject (social S3) ─────────────────────────────────
 *  Offered proposals + the landed ledger, generic over the subject ref (the
 *  GrantsPanel rule). A project renders this merged with its contribution
 *  ledger (`ChangesPanel` — two paths into ONE L# sequence); every other subject
 *  kind renders it alone, which is what this component is for.
 *
 *  Capability shapes affordances throughout: the offer form appears only at the
 *  `propose` tier, and land/decline only for the subject's owner — both from the
 *  server's own answers, never a client guess.
 *
 *  The offer FORM is per-kind because a DELTA is per-kind, and each kind's form
 *  is driven by the very predicate the server validates with, so a form can
 *  never offer what the wall would refuse:
 *    · `schedule` → the fields `PROPOSABLE_SCHEDULE_FIELDS` enumerates;
 *    · `artifact` → the blocks `docBlockText` calls patchable;
 *    · everything else → the reviewable-suggestion floor (prose), which every
 *      subject supports. That floor used to be claimed in this comment and not
 *      implemented — the panel rendered the ROUTINE form on every kind — which
 *      was harmless only while a routine was the sole host. */
import { useState, type ComponentType, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import {
  PROPOSABLE_SCHEDULE_FIELDS,
  type ProposableScheduleField,
  type SocialEntityRef,
  type SocialProposal,
} from '../../contract/index.ts'
import {
  useMe,
  useArtifactContent,
  useSocialCapability,
  useSocialProposals,
} from '../api'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { ProposalDeltaView } from './DeltaView'
import {
  BOOLEAN_SCHEDULE_FIELDS,
  artifactPatchDelta,
  offerFormFor,
  patchableBlocks,
  scheduleProposalBooleanLabel,
  scheduleProposalFieldLabel,
  schedulePatchDelta,
  suggestionDelta,
} from '../lib/proposalForm'
import {
  enqueueSocialProposalCreation,
  isSocialProposalCreationHeld,
  useSocialProposalCreationStatus,
} from '../controller/socialProposalCreationMutations.ts'
import { SectionAction } from './SectionAction'
import { ProposalVerdictActions } from './ProposalVerdictActions'

/** The one main-page section surface, injected by the page owner to avoid a
 * circular dependency on SectionView. Requiring it here closes the old escape:
 * Improvements used to redraw its own framed header while every neighbouring
 * project/routine section used FoldSection. */
export type MainPageSectionComponent = ComponentType<{
  title: string
  summary: ReactNode
  actions?: ReactNode
  defaultFolded?: boolean
  heldOpen?: boolean
  persist?: boolean
  children: ReactNode
}>

export function ProposalsPanel({
  subject,
  own,
  Section,
}: {
  subject: SocialEntityRef
  own: boolean
  Section: MainPageSectionComponent
}) {
  const list = useSocialProposals(subject.kind, subject.id).data ?? []
  const canPropose = useSocialCapability(subject.kind, subject.id).data?.canPropose === true
  const tenantId = useMe().data?.tenant.id
  useSocialProposalCreationStatus()
  const [composing, setComposing] = useState(false)
  const [field, setField] = useState<ProposableScheduleField>('cadence')
  const [value, setValue] = useState('')
  const [block, setBlock] = useState<number | null>(null)
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const held = isSocialProposalCreationHeld(subject)

  // Proposals and previews read the same exact-ID, per-caller body projection.
  // A metadata-only artifact must never offer patches to a same-name fixture.
  const isArtifact = subject.kind === 'artifact'
  // Only an artifact subject reads the body library, so only it fetches one
  // (`useQuery`'s enabled gate) — this panel also renders on routines.
  const lib = useArtifactContent(isArtifact).data
  const body = isArtifact ? lib?.[subject.id] : undefined
  const blocks = patchableBlocks(body)
  const chosen = blocks.find((b) => b.index === block)

  // WHICH form this subject gets — the choice itself lives in the pure module,
  // so `node --test` can hold it (an artifact with no addressable prose must
  // reach the floor, not a picker that can never submit).
  const form = offerFormFor(subject.kind, blocks.length)

  const delta =
    form === 'schedule-fields'
      ? schedulePatchDelta(field, value)
      : form === 'artifact-blocks'
        ? artifactPatchDelta(block, value, chosen?.text)
        : suggestionDelta(value)

  const offer = async () => {
    if (held || !tenantId || !delta || !rationale.trim()) return
    setError(null)
    try {
      const outcome = await enqueueSocialProposalCreation({
        tenantId,
        request: { subject, delta, rationale: rationale.trim() },
      })
      if (outcome === 'applied') {
        setValue('')
        setBlock(null)
        setRationale('')
        setComposing(false)
      } else {
        setError('Your change offer is still here. Review it, then offer it again when ready.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not offer that change.')
    }
  }

  // In flight first (newest first), then the landed ledger by L# descending,
  // then the polite no's — the three bands the merged Changes panel uses, so a
  // proposal reads the same wherever it is listed.
  const rows = [...list].sort((a, b) => {
    const band = (p: SocialProposal) => (p.state === 'offered' ? 0 : p.state === 'landed' ? 1 : 2)
    const order = (p: SocialProposal) => (p.state === 'landed' ? (p.landingNumber ?? 0) : p.offeredAt)
    return band(a) - band(b) || order(b) - order(a)
  })

  return (
    <Section
      title="Improvements"
      heldOpen={held}
      summary={rows.length === 0 ? 'No improvements offered' : `${rows.length} improvement${rows.length === 1 ? '' : 's'}`}
      actions={
        canPropose ? (
          <SectionAction
            label={held ? 'Offering change' : composing ? 'Cancel change offer' : 'Offer a change'}
            icon={<Plus size={14} />}
            onClick={() => { if (!held) setComposing((v) => !v) }}
            expanded={composing}
            disabled={held || !tenantId}
            disabledReason={held ? 'Waiting for server acknowledgement' : 'Waiting for your account'}
          />
        ) : undefined
      }
    >
      {composing && (
        <div data-social-proposal-creation-form className="space-y-1.5 border-b border-line pb-3" aria-busy={held}>
          {form === 'schedule-fields' ? (
            <div className="flex flex-wrap gap-1.5">
              <select
                aria-label="Field to change"
                value={field}
                disabled={held}
                onChange={(e) => {
                  setField(e.target.value as ProposableScheduleField)
                  setValue('')
                }}
                className={`${FORM_INPUT_CLASS} w-36 shrink-0`}
              >
                {PROPOSABLE_SCHEDULE_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {scheduleProposalFieldLabel(f)}
                  </option>
                ))}
              </select>
              {BOOLEAN_SCHEDULE_FIELDS.has(field) ? (
                <select aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)} disabled={held} className={`${FORM_INPUT_CLASS} w-32 shrink-0`}>
                  <option value="">choose…</option>
                  <option value="true">{scheduleProposalBooleanLabel(field, true)}</option>
                  <option value="false">{scheduleProposalBooleanLabel(field, false)}</option>
                </select>
              ) : (
                <input
                  aria-label="New value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={held}
                  placeholder={field === 'cadence' ? 'e.g. Every 2 hours' : 'New value'}
                  className={`${FORM_INPUT_CLASS} min-w-24 flex-1`}
                />
              )}
            </div>
          ) : form === 'artifact-blocks' ? (
            <>
              <select
                aria-label="Block to rewrite"
                value={block ?? ''}
                disabled={held}
                onChange={(e) => {
                  const next = e.target.value === '' ? null : Number(e.target.value)
                  setBlock(next)
                  // Seed the box with what the block says now, so the offer is
                  // an EDIT of the real text rather than a blank rewrite.
                  setValue(next === null ? '' : (blocks.find((b) => b.index === next)?.text ?? ''))
                }}
                className={`${FORM_INPUT_CLASS} w-full`}
              >
                <option value="">choose a block…</option>
                {blocks.map((b) => (
                  <option key={b.index} value={b.index}>
                    {b.index + 1}. {b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Rewritten text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={3}
                disabled={held || block === null}
                placeholder="The rewritten text"
                className={`${FORM_INPUT_CLASS} w-full resize-y`}
              />
            </>
          ) : (
            <textarea
              aria-label="Suggested change"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={held}
              rows={3}
              placeholder="What should change"
              className={`${FORM_INPUT_CLASS} w-full resize-y`}
            />
          )}
          <input
            aria-label="Why this change"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            disabled={held}
            placeholder="Why — this opens the review thread"
            className={FORM_INPUT_CLASS}
          />
          <div className="flex items-center gap-2">
            <button onClick={() => void offer()} disabled={held || !tenantId || !delta || !rationale.trim()} className={INLINE_ACTION_CLASS}>
              {held ? 'Offering…' : 'Offer'}
            </button>
            {error && <span className="min-w-0 truncate text-[11px] text-danger">{error}</span>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-1.5 text-[13px] text-ink-faint">
          No improvements offered yet{canPropose ? ' — offer one above.' : '.'}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.id} className="flex items-start gap-3 py-3">
              {/* The shared leading-slot idiom: a pulse in flight, L{n} once
                  landed, a muted "no" when declined. */}
              <span className="mt-0.5 w-8 shrink-0 text-[11px] font-medium tabular-nums text-ink-faint">
                {p.state === 'landed' ? `L${p.landingNumber}` : p.state === 'declined' ? 'no' : '···'}
              </span>
              <div className="min-w-0 flex-1">
                <ProposalDeltaView proposal={p} />
                <p className="mt-0.5 text-[11px] text-ink-faint">offered by {p.offeredBy}</p>
              </div>
              <ProposalVerdictActions proposal={p} subject={subject} own={own} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
