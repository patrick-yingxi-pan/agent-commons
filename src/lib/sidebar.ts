/** ── Left-panel (sidebar) interaction styling ─────────────────────────────────
 *  Every clickable element in the left rail — the header icon buttons, the nav
 *  rows, the Sessions and Routines rows, and every branch control — shares
 *  one hover cue, so the whole panel reads as a single, consistent surface. It
 *  lives here as one string so it can't drift between those elements; locked by
 *  src/lib/sidebar.test.ts.
 *
 *  The hover is a STEP OFF THE GROUND, not a direction (owner directive
 *  2026-08-10). It used to be 70% `surface` over a rail that sat a step darker
 *  than the page; that premise died when the rail went FLUSH, because
 *  `--color-sidebar` is now `--color-canvas` itself — so a surface tint paints
 *  the rail in its own colour and the hover disappears.
 *
 *  `panel-2` is the neutral one step off the canvas, and which WAY it steps is
 *  the mode's business: darker in light (#efe8e5 on #fbf9f8), lighter in dark
 *  (#352d2e on #272122). Saying this cue "darkens" would be true of half the
 *  matrix and wrong about the other half — what it actually promises is
 *  separation from the ground, in whichever direction that mode has room for.
 *
 *  Which also collapses the reason this cue was kept apart from the page's fold
 *  headers (lib/foldHeader): that note read "the rail's darker surface wants a
 *  lightening hover, the near-white page wants a darkening one, and one tint
 *  can't be visible on both". Both grounds are now the same colour, and both
 *  cues are `panel-2/70`. They stay two constants because they dress different
 *  elements (FOLD_HOVER carries its own `transition` and a panel variant), but
 *  the VALUES have converged — if a third caller ever wants it, unify them.
 *
 *  Text-color hovers stay per-element (faint→ink for nav/icon, →ink-soft for the
 *  uppercase fold header) — only the background is unified here.
 *
 *  Plain string (no JSX, no imports) so the DOM-less Node test runner can import
 *  and assert it directly. */

/** The hover background shared by every interactive element in the left panel. */
export const SIDEBAR_HOVER = 'hover:bg-panel-2/70'

/** A stacked rail split is a seam, not a rule wedged against content. The one
 * edge-owned hairline stays on the exact boundary while each neighbouring view
 * contributes eight pixels of breathing room. */
export const SIDEBAR_SPLIT_BEFORE = 'flex min-h-0 min-w-0 pb-2'
export const SIDEBAR_SPLIT_AFTER = 'relative flex min-h-0 min-w-0 pt-2'

/** The rail's ACTIVE row — where you are, in one look for every row kind (owner
 *  directive 2026-08-10).
 *
 *  Neutral, not the co-color. The Bindery duet's place seat put a Prussian-blue
 *  pill here, which made a NAVIGATION marker the most saturated thing in a panel
 *  that had just given up its solid so it would stop shouting. Standing location
 *  does not need hue: a fill plus the weight bump says "here" unambiguously, and
 *  the reference clients all mark it that way.
 *
 *  co survives where it means the system just RESPONDED to you — the focus flash
 *  on arrival, field focus, a checked box, a selected radio. That is the sharper
 *  line the duet was reaching for: co marks a transient answer, weight and fill
 *  mark a standing state.
 *
 *  One constant for the section pill AND the session rows, which had
 *  drifted into two different active looks (a tinted pill vs a ringed fill) in
 *  one panel — same role, same look. */
export const SIDEBAR_ACTIVE =
  "relative bg-panel-2 font-medium text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-ink-soft before:content-['']"

/** Focus belongs to the control that received it; its containing row gets only
 *  the shared soft wash. This keeps keyboard response visibly distinct from
 *  SIDEBAR_ACTIVE's persistent fill + location marker. */
export const SIDEBAR_FOCUS_WITHIN = 'focus-within:bg-panel-2/70'

/** The pinned create action follows the rail's 32px row rhythm. The glyph and
 * label are direct siblings: no ornamental circle competes with the action or
 * shifts the optical centre away from the surrounding resource rows. */
export const SIDEBAR_CREATE_BUTTON = `flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-ink transition ${SIDEBAR_FOCUS_WITHIN} ${SIDEBAR_HOVER}`

/** The resource forest has four visual roles, each earned by the node's place
 * in the ontology rather than by the component that happened to render it.
 *
 * - root: a top-level resource kind (Sessions, Projects, Models)
 * - group: a structural section inside a composite resource
 * - item: a canonical resource instance
 * - view: a lightweight lens over a resource root (Following, Watched)
 *
 * All four share one 32px rhythm, radius, hover/focus response and active cue.
 * Only the semantic hierarchy changes inset and type scale. Keeping the
 * complete grammar here prevents Project, Session, collection and Agent rows
 * from each inventing a nearly-identical class string. */
export type SidebarEntryKind = 'root' | 'group' | 'item' | 'view'

const SIDEBAR_ENTRY_LAYOUT: Record<SidebarEntryKind, string> = {
  root: 'group flex min-h-8 w-full items-center rounded-lg pr-2 text-[13px] transition',
  group: 'group flex min-h-8 w-full items-center gap-2 rounded-lg pl-1.5 pr-2 text-[12px] font-medium transition',
  item: 'group flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] transition',
  view: 'group flex min-h-8 w-full items-center rounded-lg px-2 text-[12px] transition',
}

/** One class funnel for every row in the resource forest. Selection needs no
 * extra bullet: SIDEBAR_ACTIVE already supplies both fill and a left marker. */
export function sidebarEntryClass(kind: SidebarEntryKind, active: boolean): string {
  return `${SIDEBAR_ENTRY_LAYOUT[kind]} ${SIDEBAR_FOCUS_WITHIN} ${
    active ? SIDEBAR_ACTIVE : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
  }`
}

/** One guide for every disclosed branch. Nesting this primitive produces the
 *  depth grammar; rows no longer hand-calculate four unrelated left paddings. */
export const SIDEBAR_BRANCH = 'ml-2.5 border-l border-line pl-1.5'

/** The rail's h-8 ghost icon button — the header trio (collapse / search /
 *  bell), the split-view controls, AND the collapsed mini-rail's vertical
 *  column in the shell (the same controls, rotated): one role, one look. */
export const SIDEBAR_ICON_BUTTON = `flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition ${SIDEBAR_HOVER} hover:text-ink`
