/** The shared input style — one source so every text field in the app reads the
 *  same (form follows function, src/CLAUDE.md). Lives in `lib/` rather than
 *  beside its first caller so components outside the section tree — the
 *  conversation's turn composer among them — can share the cue instead of
 *  re-hardcoding it. Locked by `tests/form-input.test.ts`. */
export const FORM_INPUT_CLASS =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent'
