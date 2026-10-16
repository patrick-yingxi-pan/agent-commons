/** The model label yields to standing controls at the composer's actual width,
 * including a split pane. Every wrapper in the flex chain must allow shrink;
 * clipping the outer page must never conceal an unreachable Usage button. */
export const COMPOSER_MODEL_LAYOUT = {
  group: 'flex min-w-0 max-w-full items-center gap-1.5',
  picker: 'relative min-w-0',
  trigger: 'min-w-0 max-w-full',
} as const
