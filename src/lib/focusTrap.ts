/** Pure focus-trap helpers — no React and no DOM construction — so the wrap
 *  decision can be unit-tested under `node --test` (which has no DOM). The React
 *  hook that wires these to a live `aria-modal` dialog lives in ./useFocusTrap. */

/** Elements that can take keyboard focus, minus disabled controls and anything
 *  explicitly pulled out of the tab order. Disabled controls are excluded so the
 *  computed first/last boundary matches where the browser actually stops Tab
 *  (e.g. a disabled "Create" button is skipped natively — it must not count as
 *  the trap's last stop). */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Decide where a Tab press should send focus to keep it inside the dialog:
 *   • wrap from the last focusable forward to the first (and first → last on Shift),
 *   • recapture focus to an end if it has somehow escaped the focusable set,
 *   • return `null` when focus is mid-list (let the browser advance natively) or
 *     there is nothing focusable to trap.
 *  Pure and DOM-free: it only compares identities within `nodes`, so it can be
 *  exercised with plain placeholder values in a test. */
export function nextTrapFocus<E>(nodes: readonly E[], active: unknown, shiftKey: boolean): E | null {
  if (nodes.length === 0) return null
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const inside = (nodes as readonly unknown[]).includes(active)
  if (shiftKey) return active === first || !inside ? last : null
  return active === last || !inside ? first : null
}
