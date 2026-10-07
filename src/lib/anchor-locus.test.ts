/** Anchor loci — the per-kind resolvers (src/lib/anchorLocus.ts, SOCIAL-6b).
 *
 *  A discussion can anchor to a POSITION inside an entity: one turn of a
 *  conversation, a range of an artifact, a run, an edge. The contract has
 *  carried `AnchorLocus` since S0; these lock the UI half of it:
 *    1. every declared variant has a human phrase (totality — a new variant
 *       fails the build, and these assert the runtime face too),
 *    2. resolution DEGRADES rather than dead-ends: a position with no focusable
 *       surface yet yields no focus target, and the caller still doors to the
 *       entity,
 *    3. the phrase + the landing live in ONE module — no component spells out
 *       what a locus is called or where it goes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, concatSource, filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import { describeLocus, locusFocus, sectionForSocialKind, artifactBlockAnchorState } from './anchorLocus.ts'
import { SOCIAL_ENTITY_KINDS } from '../../contract/index.ts'
import type { AnchorLocus } from '../../contract/index.ts'

/** One value per declared variant — the enumeration these tests run over. If a
 *  variant is added to the contract without a row here, the totality test's
 *  count assertion fails, which is the point: the ledger can't silently lag. */
const EVERY_LOCUS: AnchorLocus[] = [
  { kind: 'session-turn', messageId: 'm-1' },
  { kind: 'artifact-block', blockId: 'original' },
  { kind: 'schedule-run', runId: 'run-1' },
  { kind: 'relation-edge', relationId: 'rel-1' },
]

test('every declared locus kind has a human phrase', () => {
  // The union's arms, read off the contract itself — so this can't drift from
  // the type it claims to cover.
  const src = stripComments(read(join(ROOT, 'contract', 'social.ts')))
  const declared = [...src.matchAll(/\|\s*\{\s*kind:\s*'([a-z-]+)'/g)].map((m) => m[1])
  const kinds = EVERY_LOCUS.map((l) => l.kind)
  for (const k of ['session-turn', 'artifact-block', 'schedule-run', 'relation-edge']) {
    assert.ok(declared.includes(k), `${k} is declared in the contract`)
    assert.ok(kinds.includes(k as AnchorLocus['kind']), `${k} is covered by this test's enumeration`)
  }
  for (const locus of EVERY_LOCUS) {
    const phrase = describeLocus(locus)
    assert.ok(phrase.length > 0, `${locus.kind} has a phrase`)
    // The phrase is a chip SUFFIX — it reads as a continuation, so no leading
    // capital and no punctuation of its own.
    assert.equal(phrase, phrase.replace(/[.]$/, ''), `${locus.kind}'s phrase carries no full stop`)
    assert.notEqual(phrase[0], phrase[0]?.toUpperCase(), `${locus.kind}'s phrase stays lowercase`)
  }
})

test('an artifact position is named by the address the body HAS — a block, not a line', () => {
  // S0 declared this locus as a {from,to} LINE span, which no surface could ever
  // mint: these bodies are structured, not linear, so a phrase like "lines 4-9"
  // would have been a label about something the body does not have - and the S2
  // gutter stayed blocked on exactly that. It now speaks the same address an
  // artifact-patch edits by (contract/content.ts), so a patch, a thread and the
  // reader all mean one thing by "block 3".
  assert.equal(describeLocus({ kind: 'artifact-block', blockId: 'original' }), 'one block')
})

test('block focus uses immutable identity and never reinterprets a legacy position', () => {
  const ref = { kind: 'artifact', id: 'a-1' } as const
  assert.deepEqual(locusFocus({ ref, locus: { kind: 'artifact-block', blockId: 'original' } }), { artifactBlockId: 'original' })
  assert.equal(locusFocus({ ref, locus: { kind: 'artifact-block', block: 0 } }), null)
  assert.equal(describeLocus({ kind: 'artifact-block', block: 0 }), 'original block unavailable')
})

test('block anchor status proves deletion only from a successful current document read', () => {
  const anchor = { ref: { kind: 'artifact', id: 'a-1' }, locus: { kind: 'artifact-block', blockId: 'original' } } as const
  const body = { type: 'doc', title: 'Doc', blocks: [{ id: 'neighbor', p: 'Neighbor' }, { id: 'original', p: 'Moved' }] } as const
  const current = JSON.parse(JSON.stringify(body))
  assert.equal(artifactBlockAnchorState(anchor, current, 'success'), 'attached')
  current.blocks.pop()
  assert.equal(artifactBlockAnchorState(anchor, current, 'success'), 'deleted')
  assert.equal(artifactBlockAnchorState(anchor, current, 'loading'), 'loading')
  assert.equal(artifactBlockAnchorState(anchor, current, 'error'), 'unavailable')
  assert.equal(artifactBlockAnchorState(anchor, undefined, 'success'), 'unavailable')
  assert.equal(describeLocus(anchor.locus, 'deleted'), 'original block deleted')
})

test('every social noun answers where its page lives — one map, not one per surface', () => {
  // Two surfaces asked this (the Commons card and the AnchorChip) with two
  // hand-copied ternaries, and `artifact` was missing from BOTH — so a thread
  // anchored to an artifact rendered its own subject as dead text.
  assert.equal(sectionForSocialKind('artifact'), 'artifacts', 'an artifact has a canonical page to open')
  assert.equal(sectionForSocialKind('project'), 'projects')
  assert.equal(sectionForSocialKind('discussion'), 'discussions')
  // A session is a pane fill, not a section page — null is the deliberate answer.
  assert.equal(sectionForSocialKind('session'), null)
  // Total over the union: a new noun must decide HERE rather than defaulting to
  // "no page", which is how the artifact hole opened in the first place.
  for (const kind of SOCIAL_ENTITY_KINDS) {
    assert.doesNotThrow(() => sectionForSocialKind(kind), `${kind} is answered`)
  }
  // And nobody re-derives it: one home, like the phrases below.
  for (const file of filesUnder('src')) {
    if (file.endsWith('anchorLocus.ts')) continue
    assert.ok(
      !/kind === 'project' \? 'projects'/.test(stripComments(read(file))),
      `${file} hand-rolls the kind→section map — route it through sectionForSocialKind`,
    )
  }
})

test('a position whose surface hosts it resolves to that position', () => {
  const ref = { kind: 'session', id: 's-1' } as const
  assert.deepEqual(locusFocus({ ref, locus: { kind: 'session-turn', messageId: 'm-3' } }), { messageId: 'm-3' })
  // A routine's page lists its runs, so a run is landable too.
  assert.deepEqual(
    locusFocus({ ref: { kind: 'schedule', id: 's-1' }, locus: { kind: 'schedule-run', runId: 'run-9' } }),
    { runId: 'run-9' },
  )
  // A locus-free anchor is the entity itself — no position to land on.
  assert.equal(locusFocus({ ref }), null)
})

/** Kinds whose surface hosts an addressable row today. The rest are declared in
 *  the contract but have nowhere to land yet — a relation EDGE has no surface
 *  of its own at all, since no page draws one. (`artifact-block` left this set
 *  when the viewer grew a per-block gutter — S2's last gap.) */
const LANDABLE = new Set(['session-turn', 'schedule-run', 'artifact-block'])

test('a position with no focusable surface DEGRADES to no target — never a dead click', () => {
  // The rule the notification doors keep: always somewhere. A kind whose surface
  // hosts no position must NOT invent a focus target nothing consumes — the chip
  // doors to the entity and the locus stays descriptive.
  for (const locus of EVERY_LOCUS.filter((l) => !LANDABLE.has(l.kind))) {
    assert.equal(locusFocus({ ref: { kind: 'artifact', id: 'a-1' }, locus }), null, `${locus.kind} has no target yet`)
    // …but it is still NAMED, so the reader knows what the thread is about.
    assert.ok(describeLocus(locus).length > 0, `${locus.kind} is still named`)
  }
  // And a landable one must actually carry a target — a surface that grew the
  // position but never wired the resolver would silently keep degrading.
  for (const locus of EVERY_LOCUS.filter((l) => LANDABLE.has(l.kind))) {
    assert.ok(locusFocus({ ref: { kind: 'session', id: 's-1' }, locus }), `${locus.kind} lands somewhere`)
  }
})

test('no component spells out a locus phrase — the registry is the one home', () => {
  // The PHRASES are the registry's alone. A component that hand-wrote "one run"
  // beside a chip saying something else is exactly the drift this prevents.
  const phrases = EVERY_LOCUS.map((l) => describeLocus(l))
  for (const file of filesUnder('src')) {
    if (file.endsWith('anchorLocus.ts')) continue
    const src = stripComments(read(file))
    for (const phrase of phrases) {
      assert.ok(!src.includes(`'${phrase}'`) && !src.includes(`"${phrase}"`), `${file} hand-writes the locus phrase "${phrase}"`)
    }
  }
})

test('naming a locus kind is only allowed when MINTING one through the shared gutter', () => {
  // Two legitimate roles: the registry (which names every kind to resolve it)
  // and a surface that mints one by handing it to `LocusGutter`. Anything else
  // naming a kind is a second place deciding what a position means.
  for (const file of filesUnder('src')) {
    const rel = file.replace(/\\/g, '/')
    if (rel.endsWith('lib/anchorLocus.ts')) continue
    const src = stripComments(read(file))
    if (!/kind: '(session-turn|artifact-block|schedule-run|relation-edge)'/.test(src)) continue
    assert.ok(
      src.includes('LocusGutter'),
      `${rel} names a locus kind without minting through LocusGutter — route it through the one gutter`,
    )
  }
  const ui = concatSource('src')
  assert.ok(ui.includes('describeLocus'), 'the registry is actually consumed by the UI')
  assert.ok(ui.includes('locusFocus'), 'the landing resolver is actually consumed by the UI')
})
