/** S8 — the @-mention PICKER's logic (`src/lib/mentionPicker.ts`).
 *
 *  The read side of mentions is locked by `server/routes/mentions.test.ts` (the server
 *  resolves, `mentionSegments` lights what it resolved). This is the write side:
 *  a mention only rings if the author reproduces a whole display name, and every
 *  display name in this world contains a space — so "can the composer complete a
 *  name" is not a nicety, it is whether the feature is reachable by typing.
 *
 *  Pure functions, so the parts that fail silently — where a query starts, what
 *  ranks, the insertion arithmetic — are held here rather than left to a
 *  screenshot. The DOM wiring is `e2e/social-square.spec.ts`. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, relative, sep } from 'node:path'
import {
  applyMention,
  mentionHint,
  mentionQuery,
  narrowMention,
  squareVoices,
  suggestMentions,
  threadVoices,
  workItemVoices,
  MAX_MENTION_SUGGESTIONS,
} from './mentionPicker.ts'
import { MENTION_MAX_NAME_LEN } from '../../contract/index.ts'
import { ROOT, read, filesUnder, stripComments } from '../../tests/helpers/source.ts'

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

/* ── The other two rosters ──────────────────────────────────────────────────
 *  Same rule as the thread's, different surface: names the viewer is already
 *  looking at or has already declared. */

/** A Commons item as the server serves it — `mine` is the viewer-relative stamp. */
const item = (actor: string, mine?: boolean) =>
  ({ id: `post:${actor}`, kind: 'post', at: 0, actor, subject: { kind: 'principal', id: actor }, subjectName: actor, commentCount: 0, likes: 0, ...(mine === undefined ? {} : { mine }) }) as unknown as Parameters<typeof squareVoices>[1][number]

test('the square offers who you FOLLOW first, then the feed you are reading', () => {
  // The square is the one surface where `threadVoices` is structurally empty —
  // a post has no thread yet, and the composer IS the first word. Its roster is
  // the viewer's own two lists: the follows they declared, then the bylines in
  // front of them.
  const voices = squareVoices(['Grace Hopper'], [item('Beta Platform'), item('Acme, Inc.', true), item('Grace Hopper')])
  assert.deepEqual(voices, ['Grace Hopper', 'Beta Platform'], 'follows rank first; the feed follows; no duplicate')
  assert.ok(!voices.includes('Acme, Inc.'), 'the caller’s own acts are dropped by the server’s `mine` stamp')
  // Following nobody with an empty feed is simply an empty roster — the picker
  // never opens, and the server still resolves whatever is typed.
  assert.deepEqual(squareVoices([], []), [])
})

test('a work item offers its own participants, newest first, and never yourself', () => {
  const voices = workItemVoices(
    { postedBy: 'Beta Platform', comments: [{ author: 'Grace Hopper' }, { author: 'Acme, Inc.' }, { author: 'Grace Hopper' }] },
    'Acme, Inc.',
  )
  assert.deepEqual(voices, ['Grace Hopper', 'Beta Platform'], 'most recently heard first, then the poster; deduped')
  assert.ok(!voices.includes('Acme, Inc.'), 'the caller is dropped — here by name, since a work-item comment carries no `mine`')
  // Whoever closed it is a byline on the timeline too, so it is nameable.
  assert.ok(workItemVoices({ postedBy: 'Beta Platform', retractedBy: 'Harbor Support' })!.includes('Harbor Support'))
  // A poster with no comments is still a roster of one — the person to answer.
  assert.deepEqual(workItemVoices({ postedBy: 'Beta Platform' }), ['Beta Platform'])
  assert.deepEqual(workItemVoices(null), [], 'no item = nothing to offer (the page renders before its item resolves)')
})

test('the work-item hint promises a notification only where one is sent', () => {
  // COMMONS-22's wall: the fan-out runs on a SHARED project only. The hint used
  // to advertise it on every project, including the private ones where naming
  // someone rings nobody.
  assert.match(mentionHint(true), /@mention/, 'on a shared project the feature is real, so the copy teaches it')
  assert.doesNotMatch(mentionHint(false), /@|mention/i, 'on a private one it promises nothing it cannot do')
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

/* ── The funnel: one picker, and every field that advertises `@` wears it ──── */

const HOOK = 'src/lib/useMentionPicker.tsx'
const rel = (f: string) => relative(ROOT, f).split(sep).join('/')

test('the arming rules have exactly ONE consumer — the shared hook', () => {
  // The real one-home lock, and the one this slice is earned for. A second host
  // can re-style its field freely, but it cannot re-derive WHEN the picker arms
  // without importing these — and re-deriving them is what corrupted drafts the
  // first time (a caret move that re-armed a finished mention, an accept whose
  // caret restore raced React's flush). Both bugs were invisible to every node
  // suite and to every screenshot.
  const consumers = filesUnder('src')
    .filter((f) => /\b(mentionQuery|narrowMention|applyMention)\s*\(/.test(stripComments(read(f))))
    .map(rel)
    .filter((r) => r !== 'src/lib/mentionPicker.ts') // the module DEFINES them
  assert.deepEqual(consumers, [HOOK], 'route a new composer through useMentionPicker instead of re-implementing the arming')
})

/** Every `<input>` / `<textarea>` element in the tree, as its own source span —
 *  the granularity this rule needs, since one component (SectionView) hosts both
 *  fields that offer mentions and a dozen that have nothing to do with them. */
function fields(): { file: string; el: string }[] {
  const found: { file: string; el: string }[] = []
  for (const f of filesUnder('src')) {
    const src = stripComments(read(f))
    for (const m of src.matchAll(/<(?:input|textarea)\b[\s\S]*?\/?>/g)) found.push({ file: rel(f), el: m[0] })
  }
  assert.ok(found.length > 20, `the field scan found ${found.length} fields — it is reading the real tree`)
  return found
}

test('a field that ADVERTISES a mention offers the picker', () => {
  // The pairing this slice closes. S8 shipped the picker on the thread composer
  // — the one surface that never mentioned `@` in its copy — while the square
  // ("mention someone with @ to reach them") and the two work-item fields
  // ("@mention to notify") taught the feature and left the writer to reproduce a
  // multi-word display name from memory. Copy that teaches a completion the
  // field cannot make is the dead-affordance shape this layer's audits keep
  // finding, so it is now a lock rather than a habit.
  const offenders = fields()
    .filter(({ el }) => /mentionHint\(/.test(el) || /(?:placeholder|aria-label)="[^"]*@[^"]*"/i.test(el) && /mention/i.test(el))
    .filter(({ el }) => !el.includes('fieldProps'))
    .map(({ file, el }) => `${file}: ${el.slice(0, 80)}…`)
  assert.deepEqual(offenders, [], 'spread useMentionPicker’s fieldProps onto it, or stop advertising the mention')
})

test('the field is WIRED to the list it drives — the arrows move a selection it still owns', () => {
  // The field keeps focus while the arrows move the armed option, so without
  // `aria-activedescendant` a screen-reader user hears the list appear and then
  // hears nothing at all as they move through it. Supplied by `fieldProps` (one
  // home) rather than by each host, and deliberately WITHOUT `role="combobox"`:
  // that would overwrite a multi-line composer's own textbox semantics, and
  // `aria-autocomplete="list"` says the same thing without the trade.
  // PRESENCE is the compiler's: the three are REQUIRED members of `fieldProps`,
  // so dropping one is a type error, not a silently-missing attribute (checked
  // by removing it — `tsc` names the missing property). What a source scan adds
  // is the part types can't say:
  const src = stripComments(read(join(ROOT, ...HOOK.split('/'))))
  assert.match(src, /'aria-activedescendant':\s*options\.length > 0/, 'it names the ARMED option, and only while the list is up')
  assert.ok(!src.includes('role="combobox"'), 'the field keeps its own role')
  // Ids are per INSTANCE: a page hosts several composers (a routine's root
  // thread and one of its runs'), and a module-constant id would point every
  // field at the first list's options.
  assert.ok(src.includes('useId()'), 'the list id is per-instance')
  assert.ok(src.includes('id={listId}') && src.includes('id={optionId('), 'and both ends of the reference exist')
})

test('no host takes back the keys the open picker owns', () => {
  // `fieldProps` carries the picker's `onKeyDown`, and while options are showing
  // it consumes Enter / Tab / the arrows and delegates everything else to the
  // host's own handler (passed as an option). Re-declaring `onKeyDown` on the
  // element AFTER the spread silently overrides that — and on a single-line
  // field whose Enter POSTS, the first thing the writer loses is half a name.
  const offenders = fields()
    .filter(({ el }) => el.includes('fieldProps') && /onKeyDown=/.test(el))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [], 'pass the host’s keys to useMentionPicker as `onKeyDown`, so the picker still gets first refusal')
})

test('the list ESCAPES its container — it is portaled, and positioned from the field', () => {
  // Found in the running app: the work-item field sits inside a `CardList`, and
  // the shared ledger recipe gives that container `overflow-hidden` for its
  // rounded corners — so a CSS-anchored list was cut off by the very row it
  // belonged to. Every host of this picker is some other component's child, and
  // none of them can promise it an unclipped box; the picker escapes instead
  // (the `RowMenu` / `FilterMenu` / `RecentOverflowList` answer, and
  // `src/lib/popover.test.ts` holds it to that category's containment math).
  const src = stripComments(read(join(ROOT, ...HOOK.split('/'))))
  assert.ok(src.includes('createPortal('), 'the list portals out of whatever box the composer is in')
  assert.ok(src.includes('getBoundingClientRect()'), 'and takes its position from the FIELD, not from the tree')
  assert.ok(src.includes('clampLeft('), 'clamped by the shared containment math, like every portaled surface')
  // A fixed surface that never re-measures points at nothing the moment a pane
  // scrolls — and this one, unlike a click-opened menu, stays open while typing.
  assert.match(src, /addEventListener\('scroll'[\s\S]{0,40}true\)/, 'repositions on an ancestor scroll (capture)')
  assert.ok(src.includes("addEventListener('resize'"), 'and on a resize')
  // Every host renders it — a picker whose list is never mounted is arming
  // state nobody can see.
  const hosts = filesUnder('src').filter((f) => rel(f) !== HOOK && /useMentionPicker\s*[<(]/.test(stripComments(read(f))))
  assert.ok(hosts.length >= 2, 'more than one composer offers the picker (the scan is not vacuous)')
  for (const f of hosts) {
    assert.ok(stripComments(read(f)).includes('.list'), `${rel(f)} arms a picker it never renders`)
  }
})
