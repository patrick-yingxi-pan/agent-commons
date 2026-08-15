import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

/** Arrow-key step in px; Shift steps coarse. One press is one complete
 *  start → move → end gesture, so keyboard and pointer resizes share every
 *  call site's clamp and persist logic unchanged. */
const KEY_STEP = 16
const KEY_COARSE = 4

/** A thin draggable divider for resizing a panel. Vertical handles (`left`/`right`)
 *  resize width and report the pointer's absolute clientX; horizontal handles
 *  (`top`/`bottom`) resize height and report clientY. The parent converts that into
 *  a size (and decides the clamp / which edge it anchors to). Pointer listeners live
 *  on the window so the drag keeps tracking even when the cursor outruns the handle.
 *
 *  Keyboard-operable (WCAG 2.1.1, invariant UI-11): the strip is a focusable
 *  separator — axis arrow keys step the divider (Shift for coarse steps) through
 *  the same pipeline a pointer drag runs, the app-wide focus-visible ring
 *  (src/index.css) marks it when focused, and the size it controls is exposed as
 *  aria-valuenow/-min/-max (WCAG 4.1.2) so a screen reader hears each step land —
 *  or not, at the clamp.
 *
 *  One primitive serves the rail width, the panel width AND the rail's pane-height
 *  dividers, so the three never drift (form follows function). A vertical handle
 *  owns the one visible edge hairline; its host omits a second border while the
 *  full eight-pixel hit strip remains available for pointer input. */
export function ResizeHandle({
  side,
  label,
  ownsEdge = false,
  value,
  min,
  max,
  onStart,
  onMove,
  onEnd,
}: {
  /** Which edge of the panel the handle sits on. left/right resize width (report
   *  clientX); top/bottom resize height (report clientY). */
  side: 'left' | 'right' | 'top' | 'bottom'
  /** Accessible name — distinct per divider ("Resize sidebar", "Resize panel", …)
   *  so focusable separators never share a name (the WCAG 2.5.3 lesson the pane
   *  fold headers already learned). */
  label: string
  /** True when this handle supplies its host's only visible edge. The hairline
   * sits on the actual boundary rather than in the center of the hit strip;
   * other vertical hosts retain their own border and hover-only handle cue. */
  ownsEdge?: boolean
  /** The size this divider controls, in px, with its current bounds — exposed as
   *  aria-valuenow/-min/-max (REQUIRED for a focusable separator, WCAG 4.1.2): a
   *  screen reader announces each step, and "pinned at the clamp" is audible where
   *  the visual motion alone said nothing. */
  value: number
  min: number
  max: number
  onStart?: () => void
  /** clientX for vertical (left/right) handles; clientY for horizontal (top/bottom). */
  onMove: (client: number) => void
  onEnd?: () => void
}) {
  const horizontal = side === 'top' || side === 'bottom'
  // The parent's client→size map is affine with slope ±1 (grow-direction by side:
  // a left/top handle's size grows as the client coordinate shrinks). A keyboard
  // sequence reads the strip's rect ONCE (its first press), then chains each press
  // off the last coordinate it SENT, checking the committed `value` for what the
  // last press actually realized — so steps are exactly a step apart (an absolute
  // re-read would re-enter the half-strip bias every press), a clamp-cut step
  // walks the anchor back by its unrealized remainder (no banked overshoot), and
  // none of it trusts the rect again, which lies to a rapid second press when the
  // container ANIMATES its size (the panel's motion.div applies width a frame
  // late; the committed value never lags).
  const slope = side === 'left' || side === 'top' ? -1 : 1
  const keyLast = useRef<{ next: number; value: number; req: number } | null>(null)
  // True while a pointer drag's window listeners are live — a key press then must
  // NOT run its own gesture (its onEnd would drop the call site's dragging flag
  // mid-drag and the rest of the drag would animate behind the cursor).
  const pointerActive = useRef(false)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      keyLast.current = null // a real drag re-anchors any in-progress keyboard sequence
      pointerActive.current = true
      onStart?.()
      document.body.style.cursor = horizontal ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
      const move = (ev: PointerEvent) => onMove(horizontal ? ev.clientY : ev.clientX)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        pointerActive.current = false
        onEnd?.()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      // pointercancel (a touch interrupted by a system gesture / orientation
      // change mid-drag) must end the drag too — otherwise the move listener
      // leaks, the body keeps cursor/user-select frozen, and pointerActive stays
      // true, blocking the keyboard path and pinning the call site's dragging flag.
      window.addEventListener('pointercancel', up)
    },
    [onStart, onMove, onEnd, horizontal],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (pointerActive.current) return // mid-pointer-drag, keys don't start a second gesture
      const dir = horizontal
        ? e.key === 'ArrowUp'
          ? -1
          : e.key === 'ArrowDown'
            ? 1
            : 0
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowRight'
            ? 1
            : 0
      if (dir === 0) return
      e.preventDefault() // the arrow steps the divider; it must not scroll the pane
      const last = keyLast.current
      let from: number
      if (last == null) {
        // First press: the strip's center stands in for the divider (a one-time
        // half-strip bias, accepted); every later press chains, never re-reads.
        const rect = e.currentTarget.getBoundingClientRect()
        from = horizontal ? rect.top + rect.height / 2 : rect.left + rect.width / 2
      } else {
        // What did the last press actually realize? Landed (within half a plain
        // step — pixel rounding and the one-time bias pass) → chain exactly.
        // Cut short by the call site's clamp (or the size moved under us) → walk
        // the anchor back by the unrealized remainder, so the next press answers
        // from the real edge instead of unwinding banked overshoot.
        const realized = value - last.value
        from =
          Math.abs(realized - last.req) <= KEY_STEP / 2
            ? last.next
            : last.next - slope * (last.req - realized)
      }
      const step = dir * KEY_STEP * (e.shiftKey ? KEY_COARSE : 1)
      const next = from + step
      keyLast.current = { next, value, req: slope * step }
      onStart?.()
      onMove(next)
      onEnd?.()
    },
    [horizontal, slope, value, onStart, onMove, onEnd],
  )

  const edge =
    side === 'left' ? 'left-0' : side === 'right' ? 'right-0' : side === 'top' ? 'top-0' : 'bottom-0'

  return (
    <div
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onBlur={() => (keyLast.current = null)}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      title={label}
      className={`group absolute z-20 touch-none ${
        horizontal ? `inset-x-0 h-2 cursor-row-resize ${edge}` : `inset-y-0 w-2 cursor-col-resize ${edge}`
      }`}
    >
      {/* Horizontal pane gutters keep a centered line. A vertical handle either
          owns the host edge (one persistent line on the actual boundary) or
          keeps its centered cue hover-only behind the host's existing border. */}
      <div
        className={`pointer-events-none absolute transition-colors duration-150 ${
          horizontal
            ? 'inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong group-hover:bg-accent group-focus-visible:bg-accent'
            : ownsEdge
              ? `inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-px bg-line group-hover:bg-accent/50 group-focus-visible:bg-accent/50`
              : 'inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-accent/50 group-focus-visible:bg-accent/50'
        }`}
      />
    </div>
  )
}
