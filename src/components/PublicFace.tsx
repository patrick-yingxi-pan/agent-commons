/** ── The public-face primitives (shared-surface UI model) ────────────────────
 *  The rendered cues every cross-tenant surface shares: the **Byline** (WHO
 *  shares — Globe + "Shared · by X"), and the **CreditLine** (the public track
 *  record — D13 contributions + D18 forks). One source so a shared project's
 *  page, its directory card, and a published agent's card/detail all state the
 *  same fact the same way (form follows function; tests/public-face.test.ts
 *  fails if a component re-hardcodes the cue). */
import { Award, GitFork, Globe } from 'lucide-react'
import { bylineLabel, SHARED_MARKER } from '../lib/publicFace'

/** The shared-entity byline: Globe + "Shared · by X (you)". `onOwnerClick`
 *  (where given) makes the owner name a door — e.g. filter the directory down
 *  to that workspace's shares. */
export function Byline({
  ownerName,
  own,
  onOwnerClick,
}: {
  ownerName?: string
  own?: boolean
  onOwnerClick?: () => void
}) {
  const label = bylineLabel(ownerName, own)
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint">
      <Globe size={12} className="shrink-0 text-emerald-600" />
      <span>
        {SHARED_MARKER}
        {onOwnerClick ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOwnerClick()
            }}
            className="underline decoration-line-strong underline-offset-2 transition hover:text-ink"
            title="Show everything this workspace shares"
          >
            {label}
          </button>
        ) : (
          label
        )}
      </span>
    </span>
  )
}

/** The public track record — the same compact pair (contributions, forks) on a
 *  directory card and the agent detail. Render inside a `flex gap-3` text row. */
export function CreditLine({ contributions, forks }: { contributions: number; forks: number }) {
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Award size={11} /> {contributions} contribution{contributions === 1 ? '' : 's'}
      </span>
      <span className="inline-flex items-center gap-1">
        <GitFork size={11} /> {forks} fork{forks === 1 ? '' : 's'}
      </span>
    </>
  )
}
