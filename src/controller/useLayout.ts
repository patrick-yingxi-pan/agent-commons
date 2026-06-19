import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, getLayout, setLayout } from '../lib/uiPrefs'

/** ── Controller: rail layout ──────────────────────────────────────────────
 *  Owns the collapsible, drag-resizable left rail — its width and collapsed
 *  state — and persists both. The view binds its handlers; it holds no app
 *  data, only chrome geometry. */

const LEFT_MIN = 208
const LEFT_MAX = 420

export function useLayout() {
  const [leftOpen, setLeftOpen] = useState<boolean>(() => getLayout('leftOpen', true))
  const [leftW, setLeftW] = useState(() => clamp(getLayout('leftW', 272), LEFT_MIN, LEFT_MAX))
  const [leftDragging, setLeftDragging] = useState(false)
  const leftWRef = useRef(leftW)
  leftWRef.current = leftW

  useEffect(() => setLayout('leftOpen', leftOpen), [leftOpen])

  const toggleLeft = useCallback(() => setLeftOpen((o) => !o), [])
  const openLeft = useCallback(() => setLeftOpen(true), [])
  const startResize = useCallback(() => setLeftDragging(true), [])
  const resize = useCallback((clientX: number) => setLeftW(clamp(clientX, LEFT_MIN, LEFT_MAX)), [])
  const endResize = useCallback(() => {
    setLeftDragging(false)
    setLayout('leftW', leftWRef.current)
  }, [])

  return { leftOpen, leftW, leftDragging, toggleLeft, openLeft, startResize, resize, endResize }
}
