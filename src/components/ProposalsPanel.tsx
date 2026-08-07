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
import { useState } from 'react'
import {
  PROPOSABLE_SCHEDULE_FIELDS,
  type ProposableScheduleField,
  type SocialEntityRef,
  type SocialProposal,
} from '../../contract/index.ts'
import {
  declineSocialProposal,
  landSocialProposal,
  openSocialProposal,
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
  schedulePatchDelta,
  suggestionDelta,
} from '../lib/proposalForm'
import { useRelations } from '../controller/useRelations'

export function ProposalsPanel({ subject, own }: { subject: SocialEntityRef; own: boolean }) {
  const list = useSocialProposals(subject.kind, subject.id).data ?? []
  const canPropose = useSocialCapability(subject.kind, subject.id).data?.canPropose === true
  const [composing, setComposing] = useState(false)
  const [field, setField] = useState<ProposableScheduleField>('cadence')
  const [value, setValue] = useState('')
  const [block, setBlock] = useState<number | null>(null)
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)

  // An artifact subject resolves its body through the ONE name-keyed library
  // the previews read — already the server's per-caller projection, so the
  // blocks offered here are the blocks this viewer can actually see. The id→name
  // join goes through the relation graph's `allArtifacts`, the same resolver the
  // gallery uses: the bare `/artifacts` list carries only the SEEDED set, so
  // joining against it would offer no blocks at all on a created artifact.
  const isArtifact = subject.kind === 'artifact'
  const artifactName = useRelations().allArtifacts().find((a) => a.id === subject.id)?.name
  // Only an artifact subject reads the body library, so only it fetches one
  // (`useQuery`'s enabled gate) — this panel also renders on routines.
  const lib = useArtifactContent(isArtifact).data
  // Prefer the exact ID key the server stamps for an edited body; fall back to
  // the file name (see `ArtifactBodyView` — a name is not a unique handle).
  const body = isArtifact ? (lib?.[subject.id] ?? (artifactName ? lib?.[artifactName] : undefined)) : undefined
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
    if (!delta || !rationale.trim()) return
    setError(null)
    try {
      await openSocialProposal({ subject, delta, rationale: rationale.trim() })
      setValue('')
      setBlock(null)
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
          {form === 'schedule-fields' ? (
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
              {BOOLEAN_SCHEDULE_FIELDS.has(field) ? (
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
          ) : form === 'artifact-blocks' ? (
            <>
              <select
                aria-label="Block to rewrite"
                value={block ?? ''}
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
                disabled={block === null}
                placeholder="The rewritten text"
                className={`${FORM_INPUT_CLASS} w-full resize-y`}
              />
            </>
          ) : (
            <textarea
              aria-label="Suggested change"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder="What should change"
              className={`${FORM_INPUT_CLASS} w-full resize-y`}
            />
          )}
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
                <ProposalDeltaView proposal={p} />
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
