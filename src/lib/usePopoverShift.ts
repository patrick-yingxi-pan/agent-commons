import { useLayoutEffect, useRef, type RefObject } from 'react'
import { POPOVER_MARGIN, shiftIntoSpan } from './popover'

/** ── Keep an anchored popover inside the viewport ─────────────────────────────
 *  The behavioural half of lib/popover.ts: attach the returned ref to a
 *  CSS-anchored surface (absolute bottom-full/top-full + left-0/right-0) and,
 *  while `open`, the hook measures the anchored rect before paint, clamps the
 *  surface's height to the viewport (scrolling inside when taller), and applies
 *  a `translate(dx, dy)` that brings it inside the viewport margins. Re-runs on
 *  window resize and on the surface's own size changes (a popover that swaps
 *  views mid-open), so containment is continuous, not measured-once.
 *
 *  The transform is written to the element directly (not React state): the
 *  correction is derived layout, never rendering input, so a state round-trip
 *  would only add re-renders and a frame of flicker. Setting a transform does
 *  not change the element's size, so the ResizeObserver cannot loop.
 *
 *  It also stamps `data-popover` on the surface — the enumeration handle that
 *  lets browser tests find *every* live popover generically and assert the
 *  containment invariant, instead of maintaining a hand-list
 *  (e2e/responsive.spec.ts). */
export function usePopoverShift<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
): RefObject<T | null> {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    const apply = () => {
      // Height clamp: a popover taller than the viewport can't be *shifted*
      // into it — cap it and let it scroll (shiftIntoSpan would otherwise pin
      // the top and leave the bottom unreachable — found by /ui-review at
      // 844×390, where the usage popover outgrows a landscape phone). Inline
      // styles so the clamp beats any overflow utility deterministically, and
      // set unconditionally (idempotent) so the ResizeObserver can't ping-pong
      // on a clear-measure-reset cycle; when content fits, auto ≡ no scrollbar.
      el.style.maxHeight = `${window.innerHeight - 2 * POPOVER_MARGIN}px`
      el.style.overflowY = 'auto'
      // Measure the natural anchored position, without a previous shift.
      el.style.transform = ''
      const r = el.getBoundingClientRect()
      const dx = shiftIntoSpan(r.left, r.right, window.innerWidth)
      const dy = shiftIntoSpan(r.top, r.bottom, window.innerHeight)
      if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    el.dataset.popover = 'true'
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    window.addEventListener('resize', apply)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [open])

  return ref
}
