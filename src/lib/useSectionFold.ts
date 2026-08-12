/** React wiring for `sectionFold.ts` — the semantics live there, DOM-free.
 *
 *  `useSyncExternalStore` over the prefs store rather than `useState`, for the
 *  reason `useSectionFilter.ts` states about facets and which applies harder
 *  here: a page's Fold all button and the twelve section headers underneath it
 *  read the same value from twelve component instances. A `useState(load…)` per
 *  header would leave every header showing its mount-time posture after the
 *  page-level act wrote a new one — twelve carets disagreeing with the sections
 *  they belong to. Subscribed, they re-render together. */
import { useCallback, useSyncExternalStore } from 'react'
import { subscribeLayout } from './uiPrefs'
import { isSectionFolded, setSectionFolded } from './sectionFold'

export function useSectionFold(title: string, defaultFolded = false): readonly [boolean, (next: boolean) => void] {
  const read = useCallback(() => isSectionFolded(title, defaultFolded), [title, defaultFolded])
  const folded = useSyncExternalStore(subscribeLayout, read, read)
  const set = useCallback((next: boolean) => setSectionFolded(title, next), [title])
  return [folded, set] as const
}
