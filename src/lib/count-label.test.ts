/** The count-and-noun helper behind every folded section's summary
 *  (src/lib/countLabel.ts). Small, and locked anyway: it is now on ~12 section
 *  headers per entity page, so a wrong plural is wrong everywhere at once —
 *  which is the same reason the string lives in one place rather than twelve. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countLabel, countOr } from './countLabel.ts'

test('the noun agrees with the number, and ONE is the only singular', () => {
  assert.equal(countLabel(1, 'session'), '1 session')
  assert.equal(countLabel(2, 'session'), '2 sessions')
  // Zero is plural in English and this is the case an `n > 1` test would miss:
  // "0 session" reads as a typo, and a summary is read at a glance.
  assert.equal(countLabel(0, 'session'), '0 sessions')
})

test('an irregular plural is GIVEN, never guessed', () => {
  assert.equal(countLabel(1, 'entry', 'entries'), '1 entry')
  assert.equal(countLabel(3, 'entry', 'entries'), '3 entries')
  // The default is the naive `+s` on purpose. A helper that tried to derive
  // "entry → entries" would have to encode a rule that does not exist — the
  // same -y shape gives "policies" and "days" — and would be wrong silently,
  // which is worse than asking the caller who knows.
  assert.equal(countLabel(3, 'entry'), '3 entrys', 'the naive default is naive on purpose — pass the plural')
})

test('the empty case is WORDS, not a zero — a summary is an index entry', () => {
  assert.equal(countOr(0, 'item', 'items', 'Nothing posted'), 'Nothing posted')
  assert.equal(countOr(1, 'item', 'items', 'Nothing posted'), '1 item')
  assert.equal(countOr(4, 'item', 'items', 'Nothing posted'), '4 items')
  // "0 items" and "Nothing posted" are different FACTS about a section, not two
  // renderings of one — which is why the empty line is a caller's string and
  // not a formatting flag.
  assert.notEqual(countOr(0, 'item', 'items', 'Nothing posted'), countLabel(0, 'item'))
  assert.equal(countOr(0, 'entry', 'entries', 'Nothing yet'), 'Nothing yet')
  assert.equal(countOr(2, 'entry', 'entries', 'Nothing yet'), '2 entries')
})
