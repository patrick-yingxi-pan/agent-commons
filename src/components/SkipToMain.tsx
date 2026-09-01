import { SOLID_BUTTON_CLASS } from '../lib/button'

/** The shell's one bypass control. It is first in document focus order, stays
 * visually absent at rest, and enters the viewport only for keyboard focus.
 * A button keeps pane/URL history untouched; App owns the responsive focus
 * transfer because it also owns the rail's inert overlay state. */
export function SkipToMain({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className={`fixed left-3 top-3 z-[100] -translate-y-[calc(100%+1rem)] px-3 py-2 text-[13px] focus-visible:translate-y-0 motion-reduce:transition-none ${SOLID_BUTTON_CLASS}`}
      data-skip-navigation
    >
      Skip to main content
    </button>
  )
}
