/** The React wiring for `disclosure.ts` — a content disclosure that survives the
 *  page it lives on being unmounted (owner directive 2026-08-08: an opened
 *  thread must still be open when you come back from a commenter's profile).
 *
 *  A LIVE value, not a `useState(isDisclosed(key))` copy, for the reason
 *  `useSectionFilter` is: the same subject can be on screen twice at once — a
 *  card in the Commons feed and the same card in a profile's Commons band, or
 *  two panes of the split workspace showing the same list. Two copies of one
 *  boolean drift the moment either is toggled. */
import { useCallback, useSyncExternalStore } from 'react'
import { disclosureKey, isDisclosed, setDisclosed, subscribeDisclosure, type DisclosureKind } from './disclosure'

export function useDisclosure(kind: DisclosureKind, id: string): readonly [boolean, (next: boolean) => void] {
  const key = disclosureKey(kind, id)
  const read = useCallback(() => isDisclosed(key), [key])
  const open = useSyncExternalStore(subscribeDisclosure, read, read)
  const set = useCallback((next: boolean) => setDisclosed(key, next), [key])
  return [open, set] as const
}
