/** ── Disclosure memory: an opened thread stays open across a trip ───────────
 *  Owner directive, 2026-08-08: *"the toggle state should be remembered so that
 *  the comments remain the same state after clicking the commenter, jumping to
 *  its page, and then going back."*
 *
 *  A disclosure that reveals an ENTITY's own content — a feed card's
 *  conversation, a work item's comments — is a READING position, and a reading
 *  position should survive leaving and coming back. Held in component state it
 *  cannot: every one of these lives on a page that unmounts the moment you
 *  follow a door out of it.
 *
 *  It became load-bearing the day the names INSIDE those threads became doors
 *  (UI-23). Before that, the only way out of an open thread was the rail; now
 *  the disclosure invites you to click a commenter, and the disclosure is what
 *  the trip destroys. The two features fight unless the state outlives the page.
 *
 *  Three decisions worth stating, because each has a cheaper wrong answer:
 *
 *  · **Keyed by the ENTITY, never by position in a list.** Two projections of
 *    one card (the Commons feed and a profile's Commons band) are the same
 *    conversation, so they open and close together — the same reasoning that
 *    makes a card's thread and the entity page's thread one object.
 *  · **In memory, not `localStorage`.** This is navigation memory, not a
 *    preference: it should die with the tab, and the key space is unbounded
 *    (one per item ever opened) — exactly what the small per-account `uiPrefs`
 *    blob must not become.
 *  · **Not for popovers, menus, or composers.** A popover must close when you
 *    leave it (`useDismissable`); a composer's real state is its unsent draft,
 *    which remembering a boolean would not restore. Only content disclosures
 *    belong here, which is why the kind is a closed union: a third subject has
 *    to be declared, not merely assumed to fit.
 *
 *  DOM-free on purpose (the `sectionFilter.ts` split): the React wiring lives in
 *  `useDisclosure.ts`, so these semantics are exercised by `node --test`. */

/** The subjects. A closed union so adding one is a decision, and so a scan can
 *  enumerate what is remembered without reading every component. */
export type DisclosureKind =
  /** A Commons feed card's conversation (`CommonsItem.id`). */
  | 'commons-thread'
  /** A work item's comment thread (`OpenSubGoal.id`). */
  | 'work-item-thread'

/** Namespaced, so two kinds sharing an id can never collide — ids are unique
 *  within a kind, and nothing guarantees more than that. */
export const disclosureKey = (kind: DisclosureKind, id: string): string => `${kind}:${id}`

const disclosed = new Set<string>()
const listeners = new Set<() => void>()

export function subscribeDisclosure(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isDisclosed(key: string): boolean {
  return disclosed.has(key)
}

/** Open or close one subject and wake its readers.
 *
 *  The notify is synchronously a setState on every live reader, so this must
 *  never run during React's render phase — call it from the handler (invariant
 *  UI-21, the rule `uiPrefs.setLayout` documents). A no-op write stays silent
 *  rather than re-rendering every card in a feed to say nothing changed. */
export function setDisclosed(key: string, next: boolean): void {
  if (disclosed.has(key) === next) return
  if (next) disclosed.add(key)
  else disclosed.delete(key)
  for (const fn of [...listeners]) fn()
}

/** Forget everything (tests; a hard reset of the shell). Deliberately NOT wired
 *  to the account switch: the key is the entity, which is the same object for
 *  every viewer who can see it, and an item the new account can't see simply
 *  isn't rendered. */
export function resetDisclosures(): void {
  disclosed.clear()
  for (const fn of [...listeners]) fn()
}
