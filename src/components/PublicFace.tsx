/** ── The public-face primitives (shared-surface UI model) ────────────────────
 *  The rendered cues every cross-tenant surface shares: the **Byline** (WHO
 *  shares — Globe + "Shared · by X"), and the **CreditLine** (the public track
 *  record — D13 contributions + D18 forks). One source so a shared project's
 *  page, its directory card, and a published agent's card/detail all state the
 *  same fact the same way (form follows function; tests/public-face.test.ts
 *  fails if a component re-hardcodes the cue). */
import { Award, Bot, GitFork, Globe } from 'lucide-react'
import type { PrincipalKind } from '../../contract/index.ts'
import { AGENT_ACTOR_TITLE, agentActorLabel, bylineLabel, identityHue, identityInitial, SHARED_MARKER } from '../lib/publicFace'

/** The workspace identity mark — the avatar's role, derived deterministically from
 *  the display name (identityHue / identityInitial): a small tinted disc with the
 *  name's initial, so bylines disambiguate at a glance the way GitHub avatars do.
 *  `aria-hidden` — pure texture; the NAME stays the accessible identity. Worn by
 *  <OwnerLink> automatically; pass a larger `size` for headers (the profile page). */
export function WorkspaceMark({ name, size = 13 }: { name?: string; size?: number }) {
  const n = name ?? 'this workspace'
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

/** The one owner-door style — an underlined owner name that opens "everything this
 *  workspace shares". Local to this module on purpose: consumers use <OwnerLink>,
 *  never the class (the lock greps for strays). */
const OWNER_LINK_CLASS = 'underline decoration-line-strong underline-offset-2 transition hover:text-ink'

/** The clickable owner byline — the same door on a directory subtitle and inside
 *  a Byline: click the owner to open that workspace's profile page (D21). */
export function OwnerLink({
  ownerName,
  own,
  bare,
  onClick,
}: {
  ownerName?: string
  own?: boolean
  /** Render JUST the name (derived from the one label source, "by " stripped) — for
   *  bylines embedded in a phrase that already says "posted by"/"retracted by", or a
   *  bare comment author. Off = the standalone "by X (you)" byline. */
  bare?: boolean
  onClick: () => void
}) {
  const label = bylineLabel(ownerName, own)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex items-center gap-1 align-bottom ${OWNER_LINK_CLASS}`}
      title="Show everything this workspace shares"
    >
      {/* The identity mark rides every owner door (aria-hidden — texture, not name). */}
      <WorkspaceMark name={ownerName} />
      <span>{bare ? label.replace(/^by /, '') : label}</span>
    </button>
  )
}

/** The shared-entity byline: Globe + "Shared · by X (you)". `onOwnerClick`
 *  (where given) makes the owner name a door to that workspace's profile page
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
      <Globe size={12} className="shrink-0 text-emerald-600" />
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
 *  funnel, which picks the cue by principal KIND: a human/workspace actor is an
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

/** The public track record — the same compact pair (contributions, forks) on a
 *  directory card and the agent page. Layout-SELF-CONTAINED (its own inline-flex
 *  gap): the ui-review sweep caught the pair butting together when a caller put
 *  it in a plain <p> — a composite cue must not depend on the caller's flex. */
export function CreditLine({ contributions, forks }: { contributions: number; forks: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {/* Each counter is atomic (nowrap); when space runs out the PAIR wraps as units. */}
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Award size={11} /> {contributions} contribution{contributions === 1 ? '' : 's'}
      </span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <GitFork size={11} /> {forks} fork{forks === 1 ? '' : 's'}
      </span>
    </span>
  )
}
