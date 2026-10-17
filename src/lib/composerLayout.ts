/** The model label yields to standing controls at the composer's actual width,
 * including a split pane. Every wrapper in the flex chain must allow shrink;
 * clipping the outer page must never conceal an unreachable Usage button. */
export const COMPOSER_MODEL_LAYOUT = {
  group: 'flex min-w-0 max-w-full items-center gap-1.5',
  picker: 'relative min-w-0',
  trigger: 'min-w-0 max-w-full',
} as const

/** Recovery is task content, not optional chrome. Keep exact identifiers
 * readable even when the model name is an unbroken provider-issued string. */
export function composerExecutionNoteClass(blocked: boolean): string {
  return `mt-2 min-w-0 text-center text-[11px] text-ink-faint [overflow-wrap:anywhere]${blocked ? '' : ' short:hidden'}`
}
