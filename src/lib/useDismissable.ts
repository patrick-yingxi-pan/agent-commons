import { useEffect, useRef, type RefObject } from 'react'

/** ── Dismiss-on-outside-click + Escape ───────────────────────────────────────
 *  The "close when you click away or press Escape" effect every popover / dropdown
 *  / menu shares. Extracted to one source of truth so the dismiss behaviour stays
 *  identical across them and a fix lands everywhere at once instead of in only the
 *  copies someone remembered: same role ⇒ same behaviour (form follows function,
 *  like lib/inlineAction + lib/foldHeader).
 *
 *  Attach the returned ref to the element that counts as "inside":
 *    • the wrapper that contains both the trigger and its panel (the common case),
 *      or
 *    • the trigger alone when the panel is portaled out of that subtree — in which
 *      case the portaled panel must stop its own `mousedown` (so a click on it
 *      never reaches this document listener and is treated as "inside").
 *  The generic element type defaults to `HTMLDivElement` but widens to whatever you
 *  attach the ref to (a `<span>` dropdown, a `<button>` trigger, …).
 *
 *  While `open`, a `mousedown` outside that element or an `Escape` keypress calls
 *  `onDismiss`; the listeners are bound only while open and torn down on close /
 *  unmount. `onDismiss` is read through a ref, so the listeners rebind only when
 *  `open` flips — never when a caller passes a fresh inline arrow each render —
 *  matching the hand-written effects this replaces.
 *
 *  `options.escape` (default `true`) binds the Escape→dismiss key. Pass `false`
 *  for a popover nested inside a modal that already owns Escape (a focus-trapped
 *  dialog via `useFocusTrap`), so one Escape doesn't collapse both layers at once
 *  — the same coordination as `useFocusTrap`'s `closeOnEscape` option.
 *
 *  Locked by tests/useDismissable.test.ts, which fails if a component re-hardcodes
 *  the document `mousedown` listener instead of going through this hook. */
export function useDismissable<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onDismiss: () => void,
  options?: { escape?: boolean },
): RefObject<T | null> {
  const escapeEnabled = options?.escape ?? true
  const ref = useRef<T>(null)
  // Always call the latest onDismiss without making it an effect dependency (which
  // would rebind the listeners every render for inline-arrow callers).
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismissRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismissRef.current()
    }
    document.addEventListener('mousedown', onDown)
    if (escapeEnabled) document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      if (escapeEnabled) document.removeEventListener('keydown', onKey)
    }
  }, [open, escapeEnabled])

  return ref
}
