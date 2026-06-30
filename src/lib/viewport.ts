/** Viewport tier for the responsive layout ladder (FWD-3 / PD35). The right panel
 *  sits side-by-side with the thread on a wide window, but on smaller ones it would
 *  crush the conversation column — so below `wide` it overlays as a drawer instead.
 *
 *    wide   (≥1024) — left rail + thread + right panel side-by-side (today's layout)
 *    medium (≥640)  — right panel overlays the thread (drawer)
 *    narrow (<640)  — overlay drawer (a future slice adds the icon-rail + left-rail drawer)
 *
 *  `tierFor` is pure (unit-tested); `useViewport` wires it to the window. */
import { useEffect, useState } from 'react'

export type ViewportTier = 'wide' | 'medium' | 'narrow'

export const WIDE_MIN = 1024
export const MEDIUM_MIN = 640

export function tierFor(width: number): ViewportTier {
  if (width >= WIDE_MIN) return 'wide'
  if (width >= MEDIUM_MIN) return 'medium'
  return 'narrow'
}

/** The current viewport tier, updated on resize. SSR-safe (assumes wide when there's
 *  no window). */
export function useViewport(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() =>
    typeof window === 'undefined' ? 'wide' : tierFor(window.innerWidth),
  )
  useEffect(() => {
    const onResize = () => setTier(tierFor(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return tier
}
