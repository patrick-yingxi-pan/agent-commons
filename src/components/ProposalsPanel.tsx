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
 *  The offer form is per-kind because a DELTA is per-kind: a routine's proposable
 *  fields are enumerated by the contract (`PROPOSABLE_SCHEDULE_FIELDS`), the same
 *  list the server validates against, so the form can't offer a field the wall
 *  refuses. Other kinds fall back to the reviewable-suggestion floor (prose),
 *  which every subject supports. */
import { useState } from 'react'
import {
  PROPOSABLE_SCHEDULE_FIELDS,
  describeSchedulePatch,
  type ProposableScheduleField,
  type ProposalDelta,
  type SocialEntityRef,
  type SocialProposal,
} from '../../contract/index.ts'
import {
  declineSocialProposal,
  landSocialProposal,
  openSocialProposal,
  useSocialCapability,
  useSocialProposals,
} from '../api'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { FORM_INPUT_CLASS } from '../lib/formInput'

/** Boolean fields render as a two-option select rather than a text box. */
const BOOLEAN_FIELDS = new Set<ProposableScheduleField>(['enabled', 'notifyOnFailure'])

/** The delta a form's raw inputs mean — exported for the lock test: an empty or
 *  whitespace value yields NO delta, so the form can't post something the
 *  server's `isSchedulePatch` would refuse. */
export function schedulePatchDelta(field: ProposableScheduleField, value: string): ProposalDelta | null {
  if (BOOLEAN_FIELDS.has(field)) return { kind: 'schedule-patch', patch: { [field]: value === 'true' } }
  return value.trim() ? { kind: 'schedule-patch', patch: { [field]: value.trim() } } : null
}

export function ProposalsPanel({ subject, own }: { subject: SocialEntityRef; own: boolean }) {
  const list = useSocialProposals(subject.kind, subject.id).data ?? []
  const canPropose = useSocialCapability(subject.kind, subject.id).data?.canPropose === true
  const [composing, setComposing] = useState(false)
  const [field, setField] = useState<ProposableScheduleField>('cadence')
  const [value, setValue] = useState('')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)

  const delta = schedulePatchDelta(field, value)
  const offer = async () => {
    if (!delta || !rationale.trim()) return
    setError(null)
    try {
      await openSocialProposal({ subject, delta, rationale: rationale.trim() })
      setValue('')
      setRationale('')
      setComposing(false)
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
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">Improvements</span>
        {canPropose && (
          <button onClick={() => setComposing((v) => !v)} className={INLINE_ACTION_CLASS} aria-expanded={composing}>
            {composing ? 'Cancel' : 'Offer a change'}
          </button>
        )}
      </div>

      {composing && (
        <div className="space-y-1.5 border-b border-line px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            <select
              aria-label="Field to change"
              value={field}
              onChange={(e) => {
                setField(e.target.value as ProposableScheduleField)
                setValue('')
              }}
              className={`${FORM_INPUT_CLASS} w-36 shrink-0`}
            >
              {PROPOSABLE_SCHEDULE_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            {BOOLEAN_FIELDS.has(field) ? (
              <select aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)} className={`${FORM_INPUT_CLASS} w-32 shrink-0`}>
                <option value="">choose…</option>
                <option value="true">on</option>
                <option value="false">off</option>
              </select>
            ) : (
              <input
                aria-label="New value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. Every 4 hours"
                className={`${FORM_INPUT_CLASS} min-w-24 flex-1`}
              />
            )}
          </div>
          <input
            aria-label="Why this change"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Why — this opens the review thread"
            className={FORM_INPUT_CLASS}
          />
          <div className="flex items-center gap-2">
            <button onClick={() => void offer()} disabled={!delta || !rationale.trim()} className={INLINE_ACTION_CLASS}>
              Offer
            </button>
            {error && <span className="min-w-0 truncate text-[11px] text-danger">{error}</span>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-ink-faint">
          No improvements offered yet{canPropose ? ' — offer one above.' : '.'}
        </p>
      ) : (
        <ul>
          {rows.map((p) => (
            <li key={p.id} className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
              {/* The shared leading-slot idiom: a pulse in flight, L{n} once
                  landed, a muted "no" when declined. */}
              <span className="mt-0.5 w-8 shrink-0 text-[11px] font-medium tabular-nums text-ink-faint">
                {p.state === 'landed' ? `L${p.landingNumber}` : p.state === 'declined' ? 'no' : '···'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink-soft">
                  <span className="mr-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-faint">routine change</span>
                  {p.delta.kind === 'schedule-patch'
                    ? describeSchedulePatch(p.delta.patch)
                    : p.delta.kind === 'suggestion'
                      ? p.delta.text
                      : 'a graph edit'}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">offered by {p.offeredBy}</p>
              </div>
              {own && p.state === 'offered' && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => void landSocialProposal(p.id, subject)} className={INLINE_ACTION_CLASS}>
                    Land
                  </button>
                  <button onClick={() => void declineSocialProposal(p.id, subject)} className={INLINE_ACTION_CLASS}>
                    Decline
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
