/** The grants roster + share form (social S1, SOCIAL-5) — the owner's audience
 *  configuration, generic over the subject ref BY CONSTRUCTION (it never reads a
 *  kind-specific field; any surface can host it — the orthogonality rule). Its
 *  hosts today: a project page's owner rail, and a conversation's title-bar
 *  share popover. Callers gate on ownership; a present note is the publish act
 *  (INV-9: blank = silent access-only share).
 *
 *  Lives in its own module because it has more than one host — importing it from
 *  the section tree would drag that whole surface into the conversation chrome.
 *
 *  ── Why the form is DISCLOSED, and why it defaults to standing open ─────────
 *  `composing` is UI-18 arriving here late (2026-08-13). This form stood open
 *  inside the project page's Sharing section, which made that one section 346px
 *  against a 97px median and the only place on the page holding a form field at
 *  all — five of them, where every other section held zero. The rule was already
 *  written: *a section's compose form is disclosed by its header verb; a
 *  standing form is only for a surface that IS the thing being composed.*
 *
 *  The default is `true` because the OTHER host is exactly that surface: the
 *  title-bar share POPOVER is opened to share, so a form you must then disclose
 *  again is a click that buys nothing. The exception is principled — the same
 *  one the discussion page's standing composer holds — so it is spelled as the
 *  default and the section passes `false` until its verb is pressed. */
import { useEffect, useId, useRef, useState } from 'react'
import { MinusCircle } from 'lucide-react'
import {
  canonicalGrantNote,
  MAX_GRANT_NOTE_CHARS,
  SHARE_TIERS,
  type Grant,
  type ShareTier,
  type SocialEntityRef,
} from '../../contract/index.ts'
import { useGrants } from '../api'
import {
  enqueueGrantChange,
  enqueueGrantRevocation,
  isGrantMutationHeld,
  useGrantMutationStatus,
} from '../controller/grantMutations.ts'
import { audienceLabel } from '../lib/audienceLabel'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { TierBadge } from './TierBadge'
import { TIER_LABELS } from '../lib/tierBadge'
import { CopyButton } from './CopyButton'
import { Tooltip } from './Tooltip'
import { Spinner } from './Spinner'

export function GrantsPanelContent({
  subject,
  composing = true,
  onHeldChange,
}: {
  subject: SocialEntityRef
  composing?: boolean
  onHeldChange?: (held: boolean) => void
}) {
  const roster = useGrants(subject.kind, subject.id).data ?? []
  useGrantMutationStatus()
  const held = isGrantMutationHeld(subject)
  const [audKind, setAudKind] = useState<'org' | 'principal' | 'link'>('org')
  const [audId, setAudId] = useState('')
  const [tier, setTier] = useState<ShareTier>('view')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<'share' | string | null>(null)
  const actingRef = useRef(false)
  const noteHelpId = useId()

  // The same subject can be projected in more than one pane. Every host must
  // inherit the shared controller hold, not only the panel that initiated it.
  useEffect(() => onHeldChange?.(held), [held, onHeldChange])

  const settle = async (
    action: 'share' | string,
    run: () => ReturnType<typeof enqueueGrantChange>,
  ) => {
    if (actingRef.current || held) return null
    actingRef.current = true
    setActiveAction(action)
    setError(null)
    onHeldChange?.(true)
    try {
      return await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that sharing change.')
      return null
    } finally {
      actingRef.current = false
      setActiveAction(null)
      // Another projection may have queued the same subject while this action
      // was settling. Mirror the shared hold instead of closing this host early.
      onHeldChange?.(isGrantMutationHeld(subject))
    }
  }

  const share = async () => {
    if (audKind !== 'link' && !audId.trim()) return
    const publishNote = canonicalGrantNote(note)
    const outcome = await settle('share', () =>
      enqueueGrantChange({
        subject,
        audience:
          audKind === 'link'
            ? { kind: 'link', token: '' } // the SERVER mints the token (never caller-supplied)
            : audKind === 'org'
              ? { kind: 'org', orgId: audId.trim() }
              : { kind: 'principal', principalId: audId.trim() },
        tier,
        ...(publishNote === undefined ? {} : { note: publishNote }),
      }),
    )
    if (outcome === 'applied') {
      setAudId('')
      setNote('')
    } else if (outcome === 'discarded') {
      setError('That sharing change was not applied. Your audience and note are still here.')
    }
  }

  const revoke = async (grant: Grant) => {
    const outcome = await settle(grant.id, () => enqueueGrantRevocation(grant))
    if (outcome === 'discarded') setError('Access was not revoked. Review the refreshed audience, then try again.')
  }

  return (
    <div className="space-y-2.5" aria-busy={held || undefined}>
      {roster.length > 0 && (
        <ul className="space-y-1.5">
          {roster.map((g) => (
            <li key={g.id} className="group flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={g.note}>
                {audienceLabel(g.audience)}
                {g.note ? ' · published' : ''}
              </span>
              {g.audience.kind === 'link' && (
                // The copyable URL (S6): a signed-in visitor who opens it redeems
                // the tier; re-minting Link rotates the token (the old link dies).
                <CopyButton text={`${window.location.origin}/shared/${g.audience.token}`} label="Copy link" ariaLabel="Copy the share link" />
              )}
              <TierBadge tier={g.tier} />
              <Tooltip label="Revoke">
                <button
                  onClick={() => void revoke(g)}
                  disabled={held}
                  aria-label={`Revoke the ${g.tier} grant`}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 disabled:cursor-wait disabled:opacity-50 ${HOVER_REVEAL}`}
                >
                  {activeAction === g.id ? <Spinner size={12} /> : <MinusCircle size={13} />}
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
      {composing && (
      <fieldset disabled={held} className="min-w-0 space-y-1.5 border-0 p-0 disabled:cursor-wait disabled:opacity-70">
        {/* flex-wrap + min-w-0: the 288px rail can't fit all three controls on
            one line — the tier select wraps rather than clipping off the card
            (a real wide-tier finding from the ui-sweep judgment pass). */}
        <div className="flex flex-wrap gap-1.5">
          <select
            aria-label="Audience kind"
            value={audKind}
            onChange={(e) => setAudKind(e.target.value as 'org' | 'principal' | 'link')}
            className={`${FORM_INPUT_CLASS} w-24 shrink-0`}
          >
            <option value="org">Org</option>
            <option value="principal">Person</option>
            <option value="link">Link</option>
          </select>
          {audKind !== 'link' && (
            <input
              aria-label="Audience id"
              value={audId}
              onChange={(e) => setAudId(e.target.value)}
              placeholder="tenant-…"
              className={`${FORM_INPUT_CLASS} min-w-24 flex-1`}
            />
          )}
          <select aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value as ShareTier)} className={`${FORM_INPUT_CLASS} w-28 shrink-0`}>
            {SHARE_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <input
            aria-label="Share note (publishes when present)"
            aria-describedby={noteHelpId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_GRANT_NOTE_CHARS}
            placeholder="Optional note"
            className={FORM_INPUT_CLASS}
          />
          <p id={noteHelpId} className="text-[11px] leading-snug text-ink-faint">
            Add a note to publish to this audience. Leave blank to share access only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void share()} className={INLINE_ACTION_CLASS} disabled={held || (audKind !== 'link' && !audId.trim())}>
            {activeAction === 'share' ? <><Spinner size={12} /> Sharing…</> : 'Share'}
          </button>
        </div>
      </fieldset>
      )}
    </div>
  )
}
