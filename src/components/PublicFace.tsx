/** ── The public-face primitives (shared-surface UI model) ────────────────────
 *  The rendered cues every cross-tenant surface shares: the **Byline** (WHO
 *  shares — Globe + "Shared · by X"), and the **CreditLine** (the public track
 *  record — D13 contributions + D18 forks). One source so a shared project's
 *  page, its directory card, and a published agent's card/detail all state the
 *  same fact the same way (form follows function; src/lib/public-face.test.ts
 *  fails if a component re-hardcodes the cue). */
import { Award, Bot, GitFork, Globe } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PrincipalKind } from '../../contract/index.ts'
import { AGENT_ACTOR_TITLE, agentActorLabel, bylineLabel, identityHue, identityInitial, SHARED_MARKER } from '../lib/publicFace'
import { STANDING_DOOR_CLASS } from '../lib/textDoor'

/** The identity mark — the avatar's role, derived deterministically from
 *  the display name (identityHue / identityInitial): a small tinted disc with the
 *  name's initial, so bylines disambiguate at a glance the way GitHub avatars do.
 *  `aria-hidden` — pure texture; the NAME stays the accessible identity. Worn by
 *  <OwnerLink> automatically; pass a larger `size` for headers (the profile page). */
export function IdentityMark({ name, size = 13 }: { name?: string; size?: number }) {
  const n = name ?? ''
  const hue = identityHue(n)
  return (
    <span
      aria-hidden
      data-initial={identityInitial(n)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.55)),
        backgroundColor: `hsl(${hue} 50% 88%)`,
        color: `hsl(${hue} 45% 32%)`,
      }}
      // The initial is PAINT, not text (CSS content from data-initial): a real text
      // node would leak into text selection ("Pby Personal" on copy) and into
      // text-matching assertions — the letter is texture, exactly like the color.
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none before:content-[attr(data-initial)]"
    />
  )
}

/** This module's standing door — the shared cue (lib/textDoor) plus the hover color
 *  these bylines use. Worn by BOTH doors here: the owner name that opens "everything
 *  this owner shares", and a CreditLine count that opens its lineage. Named for
 *  the cue rather than for one of its two wearers, because the previous name
 *  (OWNER_LINK_CLASS) is precisely why CreditStat retyped the literal instead of
 *  reusing it — inside the very module whose comment promised nobody would. */
const STANDING_DOOR = `${STANDING_DOOR_CLASS} hover:text-ink`

/** The clickable owner byline — the same door on a directory subtitle and inside
 *  a Byline: click the owner to open that namespace's profile page (D21). */
export function OwnerLink({
  ownerName,
  own,
  bare,
  markSize,
  onClick,
}: {
  ownerName?: string
  own?: boolean
  /** Render JUST the name (derived from the one label source, "by " stripped) — for
   *  bylines embedded in a phrase that already says "posted by"/"retracted by", or a
   *  bare comment author. Off = the standalone "by X (you)" byline. */
  bare?: boolean
  /** A larger identity mark for a byline that LEADS its surface (the feed card's
   *  actor line) — the mark stays the shared <IdentityMark>, only scaled. */
  markSize?: number
  onClick: () => void
}) {
  const label = bylineLabel(ownerName, own)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex items-center ${markSize && markSize > 16 ? 'gap-2' : 'gap-1'} align-bottom ${STANDING_DOOR}`}
      title={`Show everything ${ownerName ?? 'this owner'} shares`}
    >
      {/* The identity mark rides every owner door (aria-hidden — texture, not name). */}
      <IdentityMark name={ownerName} size={markSize} />
      <span>{bare ? label.replace(/^by /, '') : label}</span>
    </button>
  )
}

/** The shared-entity byline: Globe + "Shared · by X (you)". `onOwnerClick`
 *  (where given) makes the owner name a door to that namespace's profile page
 *  (D21 — everything it shares, one surface). */
export function Byline({
  ownerName,
  own,
  onOwnerClick,
}: {
  ownerName?: string
  own?: boolean
  onOwnerClick?: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint">
      <Globe size={12} className="shrink-0 text-ok-strong" />
      <span>
        {SHARED_MARKER}
        {onOwnerClick ? (
          <OwnerLink ownerName={ownerName} own={own} onClick={onOwnerClick} />
        ) : (
          bylineLabel(ownerName, own)
        )}
      </span>
    </span>
  )
}

/** The agent-actor badge (FWD-5 Phase 3): Bot + label. An agent actor is TEXT,
 *  not a door — an agent has no profile page of its own; its OWNER namespace
 *  does (pair with an <OwnerLink> for the chain's owner leg). */
export function AgentActor({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={AGENT_ACTOR_TITLE}>
      <Bot size={12} className="shrink-0 text-ink-faint" />
      {agentActorLabel(label)}
    </span>
  )
}

/** The actor byline (FWD-5 Phase 3) — every act's WHO renders through this one
 *  funnel, which picks the cue by principal KIND: a human/namespace actor is an
 *  owner DOOR (D21 profile); an agent actor wears the Bot badge. Kind absent =
 *  a legacy or foreign (A2A) actor — rendered as the door its display name is. */
export function ActorByline({
  name,
  kind,
  onOwnerClick,
}: {
  name: string
  kind?: PrincipalKind
  onOwnerClick: () => void
}) {
  if (kind === 'agent') return <AgentActor label={name} />
  return <OwnerLink bare ownerName={name} onClick={onOwnerClick} />
}

/** One CreditLine counter — a plain span, or (given a handler) a DOOR to the
 *  count's lineage: a number that is a lineage should open the lineage. */
function CreditStat({ title, onClick, children }: { title?: string; onClick?: () => void; children: ReactNode }) {
  const cls = 'inline-flex items-center gap-1 whitespace-nowrap'
  if (!onClick) return <span className={cls}>{children}</span>
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      className={`${cls} ${STANDING_DOOR}`}
    >
      {children}
    </button>
  )
}

/** The public track record — the same compact pair (contributions, forks) on a
 *  directory card and the agent page. Layout-SELF-CONTAINED (its own inline-flex
 *  gap): the ui-review sweep caught the pair butting together when a caller put
 *  it in a plain <p> — a composite cue must not depend on the caller's flex.
 *  `onContributions` / `onForks` (where given) make each count a door to its
 *  lineage — the resolved-work list / the public-forks list. */
export function CreditLine({
  contributions,
  forks,
  onContributions,
  onForks,
}: {
  contributions: number
  forks: number
  onContributions?: () => void
  onForks?: () => void
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {/* Each counter is atomic (nowrap); when space runs out the PAIR wraps as units. */}
      <CreditStat title="The resolved work behind this count" onClick={onContributions}>
        <Award size={11} /> {contributions} contribution{contributions === 1 ? '' : 's'}
      </CreditStat>
      <CreditStat title="The public forks of this definition" onClick={onForks}>
        <GitFork size={11} /> {forks} fork{forks === 1 ? '' : 's'}
      </CreditStat>
    </span>
  )
}
