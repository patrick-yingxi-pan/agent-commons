import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'

/** A thin draggable divider for resizing a panel. Vertical handles (`left`/`right`)
 *  resize width and report the pointer's absolute clientX; horizontal handles
 *  (`top`/`bottom`) resize height and report clientY. The parent converts that into
 *  a size (and decides the clamp / which edge it anchors to). Pointer listeners live
 *  on the window so the drag keeps tracking even when the cursor outruns the handle.
 *  One primitive serves the rail width AND the rail's pane-height dividers, so the
 *  two never drift (form follows function). */
export function ResizeHandle({
  side,
  onStart,
  onMove,
  onEnd,
}: {
  /** Which edge of the panel the handle sits on. left/right resize width (report
   *  clientX); top/bottom resize height (report clientY). */
  side: 'left' | 'right' | 'top' | 'bottom'
  onStart?: () => void
  /** clientX for vertical (left/right) handles; clientY for horizontal (top/bottom). */
  onMove: (client: number) => void
  onEnd?: () => void
}) {
  const horizontal = side === 'top' || side === 'bottom'
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      onStart?.()
      document.body.style.cursor = horizontal ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
      const move = (ev: PointerEvent) => onMove(horizontal ? ev.clientY : ev.clientX)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onEnd?.()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [onStart, onMove, onEnd, horizontal],
  )

  const edge =
    side === 'left' ? 'left-0' : side === 'right' ? 'right-0' : side === 'top' ? 'top-0' : 'bottom-0'

  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      title="Drag to resize"
      className={`group absolute z-20 touch-none ${
        horizontal ? `inset-x-0 h-2 cursor-row-resize ${edge}` : `inset-y-0 w-2 cursor-col-resize ${edge}`
      }`}
    >
      {/* A hairline centered in the hit strip. Horizontal (pane) dividers show a
          persistent line so they're easy to spot; the vertical width handle stays
          invisible until hover (the rail's own border-r is its at-rest cue). Both
          brighten to the accent on hover / drag. */}
      <div
        className={`pointer-events-none absolute transition-colors duration-150 ${
          horizontal
            ? 'inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong group-hover:bg-accent'
            : 'inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-accent/50'
        }`}
      />
    </div>
  )
}
