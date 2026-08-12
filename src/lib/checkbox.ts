/** The one checkbox cue + the "Default" registry-flag cues — lib-hosted literals
 *  (like COPY_BUTTON_CLASS / SCRIM_CLASS) so the shared components and the lock test
 *  both source them from one place; src/lib/checkbox.test.ts fails if a component
 *  re-hardcodes them.
 *
 *  The checkbox square is the repo's single checkbox idiom (it started life as the
 *  Add-context "Don't ask again" row): a co-filled rounded square with a white
 *  check when on, a quiet bordered square when off. Checked is a PLACE cue, so it
 *  wears the co voice (the seat law) — on the co family's SOLID seat, since the
 *  white check has to be legible on it in both modes (UI-20). */
export const CHECKBOX_BOX_CLASS = 'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border'
export const CHECKBOX_BOX_ON_CLASS = 'border-co-solid bg-co-solid text-on-solid'
export const CHECKBOX_BOX_OFF_CLASS = 'border-line-strong'

/** The row a create/edit dialog offers to flag a registry entry as the picker
 *  default (providers, system prompts) — a full-width bordered row so the choice
 *  reads as a first-class field, not fine print. */
export const DEFAULT_TOGGLE_CLASS =
  'flex w-full items-start gap-2.5 rounded-lg border border-line bg-panel px-3 py-2 text-left transition hover:border-accent/60'

/** The registry-row chip marking the flagged default entry. */
export const DEFAULT_BADGE_CLASS =
  'rounded bg-accent-tint px-1.5 py-0.5 text-[10px] font-medium text-accent-strong'
