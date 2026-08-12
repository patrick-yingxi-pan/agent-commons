/** ── Disclosure memory (src/lib/disclosure.ts) ───────────────────────────────
 *  Owner directive 2026-08-08: *"the toggle state should be remembered so that
 *  the comments remain the same state after clicking the commenter, jumping to
 *  its page, and then going back."*
 *
 *  The store is DOM-free precisely so the semantics can be exercised here; the
 *  round trip a reader actually makes (open → follow a byline → Back → still
 *  open) is the browser's job, in `e2e/social-square.spec.ts`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesUnder, read, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import {
  disclosureKey,
  isDisclosed,
  resetDisclosures,
  setDisclosed,
  subscribeDisclosure,
} from './disclosure.ts'

test('what is opened stays opened — the point of the store', () => {
  resetDisclosures()
  const card = disclosureKey('commons-thread', 'post:disc-1')
  assert.equal(isDisclosed(card), false, 'a card starts folded')
  setDisclosed(card, true)
  // The component that set it has since unmounted (the reader followed a door
  // out of the page). Nothing here is component state, so the answer stands.
  assert.equal(isDisclosed(card), true)
  setDisclosed(card, false)
  assert.equal(isDisclosed(card), false, 'and closing really closes — not a one-way latch')
})

test('the key is namespaced by kind: one id in two kinds is two subjects', () => {
  resetDisclosures()
  // Ids are unique WITHIN a kind and nothing promises more, so a work item and a
  // feed card that happen to share one must not open each other.
  setDisclosed(disclosureKey('commons-thread', 'x1'), true)
  assert.equal(isDisclosed(disclosureKey('work-item-thread', 'x1')), false)
  assert.notEqual(disclosureKey('commons-thread', 'x1'), disclosureKey('work-item-thread', 'x1'))
})

test('readers are woken on a real change, and left alone otherwise', () => {
  resetDisclosures()
  let woken = 0
  const stop = subscribeDisclosure(() => (woken += 1))
  const key = disclosureKey('commons-thread', 'k')
  setDisclosed(key, true)
  assert.equal(woken, 1)
  // A no-op write must stay silent: every listener is a live card's setState, so
  // re-announcing "still open" would re-render a whole feed to say nothing.
  setDisclosed(key, true)
  assert.equal(woken, 1, 'a write that changes nothing notifies nobody')
  setDisclosed(key, false)
  assert.equal(woken, 2)
  stop()
  setDisclosed(key, true)
  assert.equal(woken, 2, 'and an unsubscribed reader is really gone')
})

test('two readers of one subject see one value (why it is a store, not component state)', () => {
  resetDisclosures()
  // The Commons feed and a profile's Commons band can render the same card at
  // once, as can two panes of the split workspace. Copies would drift; this is
  // the whole reason the value lives outside the components.
  const key = disclosureKey('commons-thread', 'shared')
  const seen: boolean[] = []
  const stop = subscribeDisclosure(() => seen.push(isDisclosed(key)))
  setDisclosed(key, true)
  stop()
  assert.deepEqual(seen, [true])
})

/** The subjects are ENUMERATED, so a third disclosure can't quietly join (or a
 *  named one quietly stop using the store). Both halves are asserted: the
 *  component reads the hook, AND it no longer holds the flag itself. */
test('every remembered disclosure routes through the hook — none keeps its own useState', () => {
  const SUBJECTS = [
    { component: 'FeedCard', kind: 'commons-thread' },
    { component: 'WorkItemRow', kind: 'work-item-thread' },
  ]
  for (const { component, kind } of SUBJECTS) {
    const body = stripComments(sectionViewComponent(component)).replace(/\s+/g, ' ')
    assert.ok(body.includes(`useDisclosure('${kind}'`), `${component} reads its state from the store`)
    // The regression this guards is a re-introduced local copy, which looks
    // right and silently forgets on every navigation.
    assert.ok(
      !/const \[(open|threadOpen), set(Open|ThreadOpen)\] = useState/.test(body),
      `${component} holds the toggle in component state again — it will forget on the next trip out of the page`,
    )
  }
  // …and the hook is the ONLY door to the store: a component reaching for
  // `setDisclosed` directly would be one that skipped the live subscription.
  const strays: string[] = []
  for (const file of filesUnder('src')) {
    const rel = file.replace(/\\/g, '/').split('/src/')[1]
    if (rel === 'lib/disclosure.ts' || rel === 'lib/useDisclosure.ts') continue
    if (/\b(setDisclosed|isDisclosed)\s*\(/.test(stripComments(read(file)))) strays.push(rel)
  }
  assert.deepEqual(strays, [], 'read the store through useDisclosure — a direct call is a reader that never subscribes')
})

/** The caret is the answer to a CLICK. When the disclosure began outliving the
 *  page, an open card would autofocus its composer merely by MOUNTING — the last
 *  restored card stealing focus and scrolling itself into view on arrival. */
test('the composer autofocuses only for the press that opened it, never on a restored card', () => {
  const card = stripComments(sectionViewComponent('FeedCard')).replace(/\s+/g, ' ')
  assert.ok(card.includes('autoFocus={justOpened}'), 'the focus is conditional on this reader having pressed Reply')
  assert.ok(card.includes('setJustOpened(!open)'), '…which the toggle is what sets')
  assert.ok(!/autoFocus(?!=)/.test(card), 'a bare autoFocus would fire on every restored card')
})
