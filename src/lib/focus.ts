import type { PanelFocus } from '../types'

/** Whether two panel-focus values point at the same chip. */
export function sameFocus(a: PanelFocus | null, b: PanelFocus | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  const aid = 'id' in a ? a.id : undefined
  const bid = 'id' in b ? b.id : undefined
  return aid === bid
}
