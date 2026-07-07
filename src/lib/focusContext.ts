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
import { createContext, useContext } from 'react'
import type { FocusTarget } from './notificationDoor'

export interface PendingFocus {
  pending: FocusTarget | null
  /** Clear the pending target — called by the leaf once it has focused itself, so a
   *  Back or an unrelated re-render never re-fires the highlight. */
  consume: () => void
}

export const FocusContext = createContext<PendingFocus>({ pending: null, consume: () => {} })

export const usePendingFocus = (): PendingFocus => useContext(FocusContext)
