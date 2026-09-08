import type { SavedContext } from '../../contract/contexts.ts'

/** A source-qualified reference never falls back to a mutable label. Legacy
 * names are doors only when the viewer's own registry resolves them uniquely. */
export function resolveSavedContext(
  items: readonly SavedContext[], label: string, sourceId?: string,
): SavedContext | undefined {
  if (sourceId !== undefined) return items.find(item => item.id === sourceId)
  const normalized = label.trim().toLowerCase()
  const exact = items.find(item => item.id.toLowerCase() === normalized)
  if (exact) return exact
  const matches = items.filter(item => item.label.toLowerCase() === normalized)
  return matches.length === 1 ? matches[0] : undefined
}
