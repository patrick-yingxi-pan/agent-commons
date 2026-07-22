/** The grants roster + share form (social S1, SOCIAL-5) — the owner's audience
 *  configuration, generic over the subject ref BY CONSTRUCTION (it never reads a
 *  kind-specific field; any surface can host it — the orthogonality rule). Its
 *  hosts today: a project page's owner rail, and a conversation's title-bar
 *  share popover. Callers gate on ownership; a present note is the publish act
 *  (INV-9: blank = silent access-only share).
 *
 *  Lives in its own module because it has more than one host — importing it from
 *  the section tree would drag that whole surface into the conversation chrome. */
import { useState } from 'react'
import { MinusCircle } from 'lucide-react'
import { SHARE_TIERS, type ShareTier, type SocialEntityRef } from '../../contract/index.ts'
import { createGrant, revokeGrant, useGrants } from '../api'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { FORM_INPUT_CLASS } from '../lib/formInput'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { TierBadge } from './TierBadge'
import { TIER_LABELS } from '../lib/tierBadge'
import { CopyButton } from './CopyButton'
import { Tooltip } from './Tooltip'

export function GrantsPanel({ subject }: { subject: SocialEntityRef }) {
  const roster = useGrants(subject.kind, subject.id).data ?? []
  const [audKind, setAudKind] = useState<'org' | 'principal' | 'link'>('org')
  const [audId, setAudId] = useState('')
  const [tier, setTier] = useState<ShareTier>('view')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const share = async () => {
    if (audKind !== 'link' && !audId.trim()) return
    setError(null)
    try {
      await createGrant({
        subject,
        audience:
          audKind === 'link'
            ? { kind: 'link', token: '' } // the SERVER mints the token (never caller-supplied)
            : audKind === 'org'
              ? { kind: 'org', orgId: audId.trim() }
              : { kind: 'principal', principalId: audId.trim() },
        tier,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setAudId('')
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share')
    }
  }
  return (
    <div className="space-y-2.5">
      {roster.length > 0 && (
        <ul className="space-y-1.5">
          {roster.map((g) => (
            <li key={g.id} className="group flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={g.note}>
                {g.audience.kind === 'org' ? g.audience.orgId : g.audience.kind === 'principal' ? g.audience.principalId : 'anyone with the link'}
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
                  onClick={() => void revokeGrant(g.id, g.subject)}
                  aria-label={`Revoke the ${g.tier} grant`}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 ${HOVER_REVEAL}`}
                >
                  <MinusCircle size={13} />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5">
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
        <input
          aria-label="Share note (publishes when present)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note — present = published, blank = silent share"
          className={FORM_INPUT_CLASS}
        />
        <div className="flex items-center gap-2">
          <button onClick={() => void share()} className={INLINE_ACTION_CLASS} disabled={audKind !== 'link' && !audId.trim()}>
            Share
          </button>
          {error && <span className="min-w-0 truncate text-[11px] text-danger">{error}</span>}
        </div>
      </div>
    </div>
  )
}
