import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, getLayout, setLayout } from '../lib/uiPrefs'
import type { ViewportTier } from '../lib/viewport'

/** ── Controller: rail layout ──────────────────────────────────────────────
 *  Owns the collapsible, drag-resizable left rail — its width and collapsed
 *  state — and persists both. The view binds its handlers; it holds no app
 *  data, only chrome geometry.
 *
 *  On the narrow tier (FWD-3) the rail is an off-canvas drawer: it starts
 *  closed regardless of the stored preference, closes again when the viewport
 *  shrinks into narrow, and its open state is NOT persisted while narrow — a
 *  phone visit must not clobber the desktop layout. The stored width is never
 *  rewritten either; the view clamps it at render (railWidthCss). */

const LEFT_MIN = 208
const LEFT_MAX = 420

export function useLayout(tier: ViewportTier) {
  const narrow = tier === 'narrow'
  const [leftOpen, setLeftOpen] = useState<boolean>(() =>
    narrow ? false : getLayout('leftOpen', true),
  )
  const [leftW, setLeftW] = useState(() => clamp(getLayout('leftW', 272), LEFT_MIN, LEFT_MAX))
  const [leftDragging, setLeftDragging] = useState(false)
  const leftWRef = useRef(leftW)
  leftWRef.current = leftW

  useEffect(() => {
    if (!narrow) setLayout('leftOpen', leftOpen)
  }, [leftOpen, narrow])

  // Crossing into narrow closes the drawer; leaving narrow restores the
  // desktop preference (the drawer's transient state doesn't carry over).
  const prevNarrow = useRef(narrow)
  useEffect(() => {
    if (narrow !== prevNarrow.current) {
      prevNarrow.current = narrow
      setLeftOpen(narrow ? false : getLayout('leftOpen', true))
    }
  }, [narrow])

  const toggleLeft = useCallback(() => setLeftOpen((o) => !o), [])
  const openLeft = useCallback(() => setLeftOpen(true), [])
  const closeLeft = useCallback(() => setLeftOpen(false), [])
  const startResize = useCallback(() => setLeftDragging(true), [])
  const resize = useCallback((clientX: number) => setLeftW(clamp(clientX, LEFT_MIN, LEFT_MAX)), [])
  const endResize = useCallback(() => {
    setLeftDragging(false)
    setLayout('leftW', leftWRef.current)
  }, [])

  return { leftOpen, leftW, leftDragging, toggleLeft, openLeft, closeLeft, startResize, resize, endResize }
}
