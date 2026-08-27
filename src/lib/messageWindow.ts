/** A bounded chronological view over already-loaded messages (PD36).
 *  `anchorId === null` follows the newest tail; an id holds an older reading
 *  window stable while new messages arrive. Missing anchors (for example after
 *  compaction) safely return to latest. Pure so split panes share one rule. */
export function messageWindow<T extends { id: string }>(
  messages: T[],
  anchorId: string | null,
  size: number,
): { items: T[]; start: number; hiddenEarlier: number; hiddenNewer: number } {
  const limit = Math.max(0, Math.floor(size))
  if (limit === 0 || messages.length === 0) {
    return { items: [], start: 0, hiddenEarlier: 0, hiddenNewer: messages.length }
  }
  const latestStart = Math.max(0, messages.length - limit)
  const anchored = anchorId === null ? -1 : messages.findIndex((message) => message.id === anchorId)
  const start = anchored >= 0 ? Math.min(anchored, latestStart) : latestStart
  const items = messages.slice(start, start + limit)
  return {
    items,
    start,
    hiddenEarlier: start,
    hiddenNewer: messages.length - start - items.length,
  }
}
