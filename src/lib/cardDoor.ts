/** ── The card door ────────────────────────────────────────────────────────────
 *  A card or list ROW that fronts a page opens it from anywhere on its surface,
 *  and says so on hover. The companion to lib/textDoor: that module owns "this
 *  WORD opens a page", this one owns "this whole CARD does". Same rule (form
 *  follows function) — a rich card that fronts a resource and a synopsis row in
 *  an index are one navigation role, so they get one behaviour and a
 *  container-appropriate cue.
 *
 *  Before this funnel the eight surfaces that front a page used three idioms and
 *  two of them were lies:
 *    • ProjectCard / ArtifactCard — the whole card was one <button>. Clickable,
 *      but a screen reader read the ENTIRE card as the button's name ("Release
 *      Notes Atelier by Beta Platform · updated 2 days ago Notes per release —
 *      staged sends…"), and the cue was hand-rolled identically in both.
 *    • ContextRow / ScheduledRow — the row lit up on hover but only its left ~⅔
 *      was clickable; the gap beside the status pill swallowed the click.
 *    • the former SharedProjectCard / PublishedAgentCard / AdminUserRowView — nothing but
 *      the title responded, no hover cue at all, and a redundant "Open project" /
 *      "View definition" / chevron button restated the door the title already was.
 *  (docs/ui-invariants.md UI-17.)
 *
 *  ── The model every card door now shares ──
 *  The TITLE is the door: a real <button> (lib/textDoor's DOOR_CLASS), the
 *  keyboard tab stop, and the accessible name. The CARD is the mouse target: a
 *  plain container with `cardDoorClick` and one of the cues below.
 *
 *  Deliberately NOT `role="button" tabIndex={0}` on the container. That would put
 *  a second tab stop around a door that already has one, and hand the screen
 *  reader the card's whole text as its name — the exact defect the whole-card
 *  <button> had. WCAG 2.1.1 is satisfied by the title: the FUNCTION is keyboard
 *  reachable; the card surface is a redundant pointer affordance, which is what a
 *  hover-only cue should be.
 *
 *  A card that has no nested controls and no title (there are none today) would
 *  still need its own tab stop — add one deliberately, don't assume this model. */
import type { MouseEvent } from 'react'

/** A standalone bordered CARD whose rich body still earns containment: the
 *  border sharpens and the surface tints — no lift, because the flat direction
 *  (lib/ledger) reserves elevation for things that FLOAT (lib/popover); a
 *  resting card gaining a shadow on hover was the old card language's cue.
 *  Append the resting border and background; a card wearing a transient border
 *  (the focus flash) must apply this only while it isn't flashing, since two
 *  `border-*` colors in one class attribute have no defined winner (the cascade
 *  lesson in lib/textDoor). */
export const CARD_DOOR_CLASS = 'cursor-pointer transition hover:border-line-strong hover:bg-panel/40'

/** A ROW inside a frameless divider list (Contexts, Scheduled, runs, admin
 *  users): it has no border of its own to sharpen, so the surface washes instead.
 *  Same role, different container — the two cues are one decision, made once. */
export const ROW_DOOR_CLASS = 'cursor-pointer transition hover:bg-panel-2/50'

/** Marks a whole REGION inside a card as not-card-body: everything under it is
 *  spared, chrome included. For a nested interaction area whose inert pixels are
 *  still not "the card" — the LocusGutter's inline composer, where a click on the
 *  padding beside the textarea must not navigate away and drop the draft. Reach
 *  for a control tag first; this is for regions, not for opting a button out. */
export const CARD_DOOR_OPT_OUT = 'data-no-card-door'

/** Everything inside a card that handles its own click. A card door must not fire
 *  when one of these was hit — the owner byline opens a profile, Fork forks, the
 *  credit counts open lineage, the trash deletes. Kept here rather than relying on
 *  each child calling `stopPropagation`: a child that forgets is silent, and a new
 *  child added later would inherit the bug. */
export const CARD_CONTROL_SELECTOR =
  `a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="switch"], [contenteditable="true"], [${CARD_DOOR_OPT_OUT}]`

/** True when the click landed on a control INSIDE the card (the card itself never
 *  counts, even when it is one of those tags). */
export function isCardControlClick(target: Element | null, card: Element): boolean {
  if (!target) return false
  const hit = target.closest(CARD_CONTROL_SELECTOR)
  return !!hit && hit !== card && card.contains(hit)
}

/** True when text is currently selected — a drag across a card's description ends
 *  in a `click` on the card, and navigating away from what you just highlighted is
 *  the classic clickable-card defect. A plain click collapses the selection first,
 *  so this only fires on a real drag-select. */
function hasLiveSelection(): boolean {
  const sel = typeof window === 'undefined' ? null : window.getSelection()
  return !!sel && !sel.isCollapsed
}

/** The card door's click handler. Attach to the card container alongside
 *  CARD_DOOR_CLASS / ROW_DOOR_CLASS; the title keeps its own DOOR_CLASS button. */
export function cardDoorClick(onOpen: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if (isCardControlClick(e.target instanceof Element ? e.target : null, e.currentTarget)) return
    if (hasLiveSelection()) return
    onOpen()
  }
}
