import { useLayoutEffect, type RefObject } from 'react'

/** Portaled dialogs share the live workspace bound used by anchored popovers.
 * Shell recovery remains visible above them; resizing a notice recomputes the
 * layer without remounting the form or moving focus. */
export function useBoundedDialog(ref: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const layer = ref.current?.parentElement
    if (!layer) return
    const workspace = document.querySelector<HTMLElement>('[data-popover-viewport]')
    const apply = () => {
      const bounds = workspace?.getBoundingClientRect()
      const top = Math.max(0, bounds?.top ?? 0)
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight)
      layer.style.top = `${top}px`
      layer.style.bottom = `${Math.max(0, window.innerHeight - bottom)}px`
      layer.style.setProperty('--dialog-viewport-height', `${Math.max(0, bottom - top)}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    if (workspace) observer.observe(workspace)
    window.addEventListener('resize', apply)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [ref])
}
