import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'

/** A thin draggable divider for resizing a side panel. It reports the pointer's
 *  absolute clientX during the drag; the parent converts that into a width (and
 *  decides the clamp / which edge it anchors to). Pointer listeners live on the
 *  window so the drag keeps tracking even when the cursor outruns the handle. */
export function ResizeHandle({
  side,
  onStart,
  onMove,
  onEnd,
}: {
  /** Which edge of the panel the handle sits on. */
  side: 'left' | 'right'
  onStart?: () => void
  onMove: (clientX: number) => void
  onEnd?: () => void
}) {
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      onStart?.()
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const move = (ev: PointerEvent) => onMove(ev.clientX)
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
    [onStart, onMove, onEnd],
  )

  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      className={`group absolute inset-y-0 z-20 w-2 cursor-col-resize ${
        side === 'left' ? 'left-0' : 'right-0'
      }`}
    >
      {/* A hairline that brightens on hover / drag, centered in the hit strip. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-accent/50" />
    </div>
  )
}
