/** The one copy-to-clipboard button cue — a compact bordered pill whose label swaps
 *  to "Copied" on click. Kept in lib (like SCRIM_CLASS / INLINE_ACTION_CLASS) so the
 *  shared <CopyButton> component and the lock test both source the literal from one
 *  place; src/lib/copy-button.test.ts fails if any component re-hardcodes it. */
export const COPY_BUTTON_CLASS =
  'shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-soft transition hover:border-accent hover:text-ink'
