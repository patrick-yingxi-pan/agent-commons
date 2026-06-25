import { useEffect, type RefObject } from 'react'
import { FOCUSABLE_SELECTOR, nextTrapFocus } from './focusTrap'

/** Every focusable element inside `root`, in DOM (tab) order. */
function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Make a `role="dialog" aria-modal="true"` element honour that contract
 * (WCAG 2.4.3 — focus must stay within the modal, not leak to the background):
 *
 *  • move focus into the dialog on open — an explicit `initialFocus`, else the
 *    first focusable element, else the dialog container itself;
 *  • cycle Tab / Shift+Tab within the dialog instead of reaching the background;
 *  • close on Escape (unless the dialog owns Escape itself — see `closeOnEscape`);
 *  • restore focus to whatever was focused before it opened, on close.
 *
 * Extracted from the original inline implementation in IntroOverlay so every
 * modal traps focus identically rather than re-deriving it — or omitting it.
 *
 * @param dialogRef the dialog container to trap focus within
 * @param onClose   invoked on Escape (the modal's dismiss path)
 * @param options.initialFocus  element to focus on open (defaults to first focusable)
 * @param options.closeOnEscape bind Escape → onClose (default true); pass false when
 *                              the dialog handles Escape itself (e.g. a capture-phase
 *                              handler that must run before an ancestor's)
 */
export function useFocusTrap<T extends HTMLElement, F extends HTMLElement = HTMLElement>(
  dialogRef: RefObject<T | null>,
  onClose: () => void,
  options?: { initialFocus?: RefObject<F | null>; closeOnEscape?: boolean },
): void {
  const initialFocus = options?.initialFocus
  const closeOnEscape = options?.closeOnEscape ?? true

  // Focus-in on open, focus-restore on close. Deliberately a mount-only effect:
  // it must NOT re-run when `onClose` is re-created each render (callers pass
  // inline arrows), or every keystroke in the dialog would yank the caret back
  // to the initial element.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const target = initialFocus?.current ?? getFocusable(dialogRef.current)[0] ?? dialogRef.current
    target?.focus()
    return () => opener?.focus?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The keyboard trap. Rebinding a document keydown listener (when onClose
  // changes) doesn't move focus, so depending on onClose here is safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const target = nextTrapFocus(getFocusable(dialogRef.current), document.activeElement, e.shiftKey)
        if (target) {
          e.preventDefault()
          target.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialogRef, onClose, closeOnEscape])
}
