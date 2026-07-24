/** The LIVE value behind a section's "Filter & sort" menu (src/lib/sectionFilter.ts).
 *
 *  A facet used to be URL state, so the rail and the page read it from the same
 *  place by construction. Now it is a stored preference read by two trees at
 *  once — the rail row's menu + its instance children, and the section page —
 *  so it has to be one live value: a `useState(load…)` per consumer would let
 *  the page keep showing "Documents" after the rail switched to "Images". This
 *  subscribes both to the prefs store (which notifies on write AND on an
 *  account-scope switch), so every reader of a section's facet re-renders
 *  together. */
import { useCallback, useSyncExternalStore } from 'react'
import type { SectionId } from '../types'
import { subscribeLayout } from './uiPrefs'
import { loadSectionFilter, saveSectionFilter, type SectionFilterValue } from './sectionFilter'

// useSyncExternalStore demands a referentially STABLE snapshot — `loadSectionFilter`
// mints a fresh object per call, which would re-render forever. Memoize per
// section and drop the memo whenever the store says the values may have moved
// (registered at module load, so it runs BEFORE the React subscribers appended
// after it — the Set preserves insertion order).
let cache = new Map<SectionId, SectionFilterValue>()
subscribeLayout(() => {
  cache = new Map()
})

function snapshot(section: SectionId): SectionFilterValue {
  const held = cache.get(section)
  if (held) return held
  const value = loadSectionFilter(section)
  cache.set(section, value)
  return value
}

export function useSectionFilter(section: SectionId): readonly [SectionFilterValue, (next: SectionFilterValue) => void] {
  const read = useCallback(() => snapshot(section), [section])
  const value = useSyncExternalStore(subscribeLayout, read, read)
  const set = useCallback((next: SectionFilterValue) => saveSectionFilter(section, next), [section])
  return [value, set] as const
}
