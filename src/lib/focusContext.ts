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
 *  src/CLAUDE.md); callers supply their own resting border/ring. Wears the
 *  CO-COLOR: "you were brought here" is a PLACE cue (the Bindery seat law,
 *  src/index.css), so under the duet it flashes Prussian, not claret. */
export const FOCUS_FLASH_CLASS = 'bg-co-tint ring-1 ring-co/40'

/** Delays (ms) between scroll re-assertions while a page's layout settles —
 *  the first is immediate, the rest back off. The whole sequence finishes well
 *  inside `FOCUS_FLASH_MS`, so a door never keeps tugging after its highlight
 *  has faded. */
const SCROLL_SETTLE_MS = [0, 60, 160, 320, 640]

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
  // The scroll-settle chain, owned by the COMPONENT rather than the activation
  // effect (which is torn down as soon as the target is consumed).
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(settleRef.current), [])
  useEffect(() => {
    if (!active) return
    onActivateRef.current?.()
    setFlash(true)
    // Scroll, then RE-ASSERT until the layout settles. A page whose panels
    // resolve progressively grows ABOVE the target after the first call, and
    // `scrollIntoView` does not recompute — so the one call landed nowhere and
    // the row sat off-screen (a routine's 50-row run list did exactly this).
    // Corrects only a target that is FULLY off-screen, so it never yanks a
    // page that already landed and never fights a user; the whole backoff
    // window finishes inside the flash.
    let attempt = 0
    const settle = () => {
      const el = ref.current
      // Correct only when the target is actually off-screen — so this never
      // yanks a page that already landed, and never fights a user. The schedule
      // RUNS to the end regardless: at first paint the page is often SHORT and
      // the target trivially in view, and only later does the content above it
      // resolve and push it away. (An early exit on "in view" was exactly that
      // bug — a routine's run row read as landed, then dropped 1100px.)
      if (el) {
        const r = el.getBoundingClientRect()
        // "Landed" means VISIBLE, not fully contained: a target taller than the
        // viewport can never be contained, so demanding it would re-center on
        // every tick forever — and re-centering a tall row pushes its lower half
        // (where a gutter lives) back off-screen.
        if (r.bottom <= 0 || r.top >= window.innerHeight) {
          // Smooth for the first move (a visible glide from where you were);
          // instant for corrections, so they don't fight the animation.
          el.scrollIntoView({ block: 'center', behavior: attempt === 0 ? 'smooth' : 'auto' })
        }
      }
      attempt += 1
      if (attempt < SCROLL_SETTLE_MS.length) settleRef.current = setTimeout(settle, SCROLL_SETTLE_MS[attempt])
    }
    settle()
    // Consumed LAST, after the first scroll is under way. Consuming first
    // re-renders every surface that reads the pending target — and a surface
    // with its own default landing (the conversation's scroll-to-bottom) then
    // sees no pending turn and re-asserts that default, winning the race. Later
    // settle ticks heal it anyway, but the first paint should be right.
    consume()
    // Deliberately NOT cleaned up here. `consume()` flips `active` false
    // on the very next render, which tears this effect down — an effect-scoped
    // cleanup would cancel the settle chain before its first retry ever ran
    // (it did: only attempt 0 ever fired). The chain is owned by the component
    // and cleared on unmount by the effect above.
  }, [active, consume, ref])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), FOCUS_FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])
  return flash
}
