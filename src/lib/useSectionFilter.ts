/** The LIVE value behind a section's "Filter & sort" menu (src/lib/sectionFilter.ts).
 *
 *  A facet used to be URL state, so the rail and the page read it from the same
 *  place by construction. Now it is a stored preference read by two trees at
 *  once — the rail row's menu + its instance children, and the section page —
 *  so it has to be one live value: a `useState(load…)` per consumer would let
 *  the page keep showing "Documents" after the rail switched to "Images". This
 *  subscribes every reader to the prefs store, so they re-render together.
 *
 *  React wiring ONLY. The stable snapshot — and the two things that invalidate
 *  it, a write and an account switch — live in the DOM-free `sectionFilter.ts`,
 *  where tests can exercise them (`sectionFilterSnapshot`). */
import { useCallback, useSyncExternalStore } from 'react'
import type { SectionId } from '../types'
import { subscribeLayout } from './uiPrefs'
import { saveSectionFilter, sectionFilterSnapshot, type SectionFilterValue } from './sectionFilter'

export function useSectionFilter(section: SectionId): readonly [SectionFilterValue, (next: SectionFilterValue) => void] {
  const read = useCallback(() => sectionFilterSnapshot(section), [section])
  const value = useSyncExternalStore(subscribeLayout, read, read)
  const set = useCallback((next: SectionFilterValue) => saveSectionFilter(section, next), [section])
  return [value, set] as const
}
