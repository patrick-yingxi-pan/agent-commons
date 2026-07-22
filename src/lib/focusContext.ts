/** ── Pending-focus context (docs/notification-routing.md) ───────────────────
 *  A notification door navigates to a page AND sets a transient `FocusTarget` in the
 *  controller (`pendingFocus`). The destination sub-entity — a work item row deep
 *  inside the project page, a proposal inside the review dialog, an agent card —
 *  reads it to scroll + highlight itself, then `consume()`s it so it fires once.
 *
 *  This is delivered by context, not prop-drilling: the target lives 3–4 layers
 *  below `SectionView` (project detail → OpenWorkList → WorkItemRow), and drilling a
 *  transient highlight through every intermediate signature would bloat them for a
 *  cross-cutting concern. One provider wraps `SectionView`; the leaf that matches the
 *  target consumes it. */
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import type { FocusTarget } from './notificationDoor'

export interface PendingFocus {
  pending: FocusTarget | null
  /** Clear the pending target — called by the leaf once it has focused itself, so a
   *  Back or an unrelated re-render never re-fires the highlight. */
  consume: () => void
}

/** The empty value — the context default AND what panes outside a notification
 *  door's landing pane receive (one frozen object: stable identity, no
 *  per-render churn). */
export const NO_PENDING_FOCUS: PendingFocus = { pending: null, consume: () => {} }

export const FocusContext = createContext<PendingFocus>(NO_PENDING_FOCUS)

export const usePendingFocus = (): PendingFocus => useContext(FocusContext)

/** How long a focus flash lingers before fading (ms). */
export const FOCUS_FLASH_MS = 1600

/** The ONE lit-highlight cue every focus target wears — a work item row, a
 *  comment, an agent card, a conversation turn. One token so "you were brought
 *  here" reads identically wherever a door lands (form follows function,
 *  src/CLAUDE.md); callers supply their own resting border/ring. */
export const FOCUS_FLASH_CLASS = 'bg-accent-tint ring-1 ring-accent/40'

/** The ONE focus-flash behavior every notification-door target shares (a work item
 *  row, an agent card): when `active` flips true, run the optional side effect (e.g.
 *  open a thread), scroll the element into view, flash a highlight for
 *  `FOCUS_FLASH_MS`, and `consume()` the pending target so it fires exactly once.
 *  Returns whether the flash is currently lit (the caller styles on it). `onActivate`
 *  is read through a ref so it need not be memoised and never re-triggers the effect —
 *  the single trigger is `active`, which the pending-target consume flips back to
 *  false. */
export function useFocusFlash(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  onActivate?: () => void,
): boolean {
  const { consume } = usePendingFocus()
  const [flash, setFlash] = useState(false)
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  useEffect(() => {
    if (!active) return
    onActivateRef.current?.()
    setFlash(true)
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    consume()
  }, [active, consume, ref])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), FOCUS_FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])
  return flash
}
