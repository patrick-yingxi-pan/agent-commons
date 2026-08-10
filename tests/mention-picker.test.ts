/** S8 — the @-mention PICKER's logic (`src/lib/mentionPicker.ts`).
 *
 *  The read side of mentions is locked by `tests/mentions.test.ts` (the server
 *  resolves, `mentionSegments` lights what it resolved). This is the write side:
 *  a mention only rings if the author reproduces a whole display name, and every
 *  display name in this world contains a space — so "can the composer complete a
 *  name" is not a nicety, it is whether the feature is reachable by typing.
 *
 *  Pure functions, so the parts that fail silently — where a query starts, what
 *  ranks, the insertion arithmetic — are held here rather than left to a
 *  screenshot. The DOM wiring is `e2e/social-layer.spec.ts`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMention, mentionQuery, narrowMention, suggestMentions, threadVoices, MAX_MENTION_SUGGESTIONS } from '../src/lib/mentionPicker.ts'
import { MENTION_MAX_NAME_LEN } from '../contract/index.ts'

/** A thread projection as the server serves it — viewer-relative stamps and all. */
const thread = (posts: { author: string; mine?: boolean; mentions?: string[] }[], openedBy = 'Acme, Inc.', mine?: boolean) =>
  ({
    id: 'disc-1',
    anchor: { ref: { kind: 'project', id: 'p1' } },
    state: 'open',
    openedBy,
    openedAt: 0,
    ...(mine === undefined ? {} : { mine }),
    posts: posts.map((p, i) => ({ id: `dpost-${i}`, body: '', at: i, reactions: 0, ...p })),
  }) as unknown as Parameters<typeof threadVoices>[0]

test('the query survives a SPACE — the whole reason the picker exists', () => {
  // Stopping at whitespace would make every name in this product uncompletable.
  assert.deepEqual(mentionQuery('thanks @Beta Pl', 15), { at: 7, query: 'Beta Pl' })
  assert.deepEqual(mentionQuery('@A', 2), { at: 0, query: 'A' })
  // Right after the `@` — the moment the writer is asking "who is here".
  assert.deepEqual(mentionQuery('hey @', 5), { at: 4, query: '' })
})

test('an email local part is not a mention, and a newline ends the query', () => {
  assert.equal(mentionQuery('mail ada@acme.example now', 24), null, 'the `@` follows a word char')
  assert.equal(mentionQuery('@Beta\nPlatform', 14), null, 'a query cannot span lines')
  assert.equal(mentionQuery('no at sign here', 15), null)
  // Bounded: a name is never longer than the server will resolve.
  assert.equal(mentionQuery(`@${'x'.repeat(200)}`, 201), null, 'past the name bound, there is nothing to complete')
})

test('the roster is the thread’s own voices, newest first, and never yourself', () => {
  const voices = threadVoices(
    thread([
      { author: 'Beta Platform' },
      { author: 'Acme, Inc.', mine: true }, // the caller
      { author: 'Growthworks' },
    ]),
  )
  assert.deepEqual(voices, ['Growthworks', 'Beta Platform'], 'most recently heard first; the caller dropped')
  assert.ok(!voices.includes('Acme, Inc.'), '@-ing yourself rings nobody, so it is never offered')

  // Someone the thread has already NAMED is offered too — their name is rendered
  // right there in the body, so offering it reveals nothing new.
  assert.ok(
    threadVoices(thread([{ author: 'Beta Platform', mentions: ['Northlight Studio'] }], 'Beta Platform')).includes('Northlight Studio'),
    'a name the thread already carries is nameable',
  )
  // The OPENER counts as a voice even before the caller has read a post of
  // theirs, and `mine` on the thread is how "the opener is me" is known.
  assert.ok(threadVoices(thread([{ author: 'Beta Platform' }], 'Harbor Support')).includes('Harbor Support'))
  assert.ok(!threadVoices(thread([], 'Acme, Inc.', true)).includes('Acme, Inc.'), 'your own opened thread does not offer you')
  // No thread yet (a first post) = nobody has spoken = no roster to offer.
  assert.deepEqual(threadVoices(null), [])
})

test('suggestions rank prefix before containment, and are capped', () => {
  const names = ['Beta Platform', 'Northlight Studio', 'Acme, Inc.']
  assert.deepEqual(suggestMentions(names, 'Beta Pl'), ['Beta Platform'], 'a multi-word prefix completes')
  assert.deepEqual(suggestMentions(names, 'beta'), ['Beta Platform'], 'case-folded, like a handle')
  assert.deepEqual(suggestMentions(names, 'Studio'), ['Northlight Studio'], 'containment finds a later word')
  assert.deepEqual(suggestMentions(names, 'zzz'), [], 'no match offers nothing rather than everything')
  assert.deepEqual(suggestMentions(names, ''), names, 'an empty query is the roster itself')
  const many = Array.from({ length: 20 }, (_, i) => `Name ${i}`)
  assert.equal(suggestMentions(many, '').length, MAX_MENTION_SUGGESTIONS, 'a completion list, not a directory')
})

test('a caret move never OPENS the picker — it only narrows or closes an open one', () => {
  // The bug this is earned for corrupted drafts. Arming on caret placement meant
  // clicking inside a mention finished minutes ago re-offered it; an open picker
  // owns Enter, so the next Enter — pressed for a NEWLINE — spliced the name in
  // a second time: "thanks @Grace Hopper for the review" became
  // "thanks @Grace Hopper Hopper for the review". Verified in the browser.
  const done = 'thanks @Grace Hopper for the review'
  assert.equal(narrowMention(null, done, 14), null, 'nothing open ⇒ nothing opens, even mid-mention')
  // …while a picker that IS open tracks the query the caret now implies.
  const open = { at: 7, query: 'Grace Ho' }
  assert.deepEqual(narrowMention(open, 'thanks @Grace Ho', 16), { at: 7, query: 'Grace Ho' })
  assert.deepEqual(narrowMention(open, 'thanks @Grace Ho', 12), { at: 7, query: 'Grac' }, 'moving inside re-reads the query')
  // A caret that leaves the query — before the `@`, or past a different one —
  // closes it, so `accept` can never splice at a stale offset.
  assert.equal(narrowMention(open, 'thanks @Grace Ho', 3), null, 'caret before the @ closes it')
  assert.equal(narrowMention(open, 'hi @Ada and @Grace Ho', 21), null, 'a different @ is not this picker')
})

test('the mentionable-name bound is the contract’s, not a second copy', () => {
  // A picker that kept completing past the length the SERVER will resolve is a
  // dead affordance; the two were briefly a `const 80` each, joined by a comment
  // claiming they matched.
  assert.equal(mentionQuery(`@${'x'.repeat(MENTION_MAX_NAME_LEN)}`, MENTION_MAX_NAME_LEN + 1)?.query.length, MENTION_MAX_NAME_LEN)
  assert.equal(mentionQuery(`@${'x'.repeat(MENTION_MAX_NAME_LEN + 1)}`, MENTION_MAX_NAME_LEN + 2), null)
})

test('accepting inserts the WHOLE name and leaves the caret after it', () => {
  const out = applyMention('thanks @Beta Pl', 7, 15, 'Beta Platform')
  assert.equal(out.text, 'thanks @Beta Platform ')
  assert.equal(out.caret, out.text.length, 'after the name and its trailing space')
  // Mid-sentence: the tail survives and the caret does NOT jump to the end.
  const mid = applyMention('cc @Beta Pl on this', 3, 11, 'Beta Platform')
  assert.equal(mid.text, 'cc @Beta Platform  on this')
  assert.equal(mid.caret, 18, 'the caret lands after the mention, not at the end of the line')
  assert.equal(mid.text.slice(mid.caret), ' on this', 'so typing continues where the writer was')
})
