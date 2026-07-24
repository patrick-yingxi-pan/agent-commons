/** The thread composer — ONE component, and inside a SECTION it is disclosed by
 *  the header's verb, never left standing open (docs/ui-invariants.md UI-18).
 *
 *  Two halves of one owner report ("why doesn't new discussion follow the same
 *  style as the other categories?"). On the project page every section discloses
 *  its compose form from the header's verb — Contributors `+`, Coordination `+`,
 *  Open work `+`, Changes' pair — and OpenWorkList states the rule in a comment:
 *  the form is ON DEMAND, so the backlog reads as a backlog and not as a
 *  permanently-open form. Discussion alone kept a standing textarea + Post, and
 *  its only header verb (Resolve) rendered for almost nobody. Tracing that found
 *  the second half: DiscussionPage hand-rolled a SECOND composer — its own draft
 *  / busy / error state around its own `postToDiscussion` call — beside the ONE
 *  composer whose own header claims every projection of a thread. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from './helpers/source.ts'

const FUNNEL = join('src', 'components', 'AnchorThreadComposer.tsx')
const SECTION_VIEW = join(ROOT, 'src', 'components', 'SectionView.tsx')

test('posting to a thread has exactly ONE caller — the shared composer', () => {
  // The real one-home lock. A hand-rolled composer can vary its textarea, its
  // Post button and its error line freely, but it cannot avoid calling the API —
  // so this catches the class, not the styling symptom.
  const callers: string[] = []
  for (const file of filesUnder('src')) {
    if (file.startsWith(join(ROOT, 'src', 'api'))) continue // the api module DEFINES them
    const src = stripComments(read(file))
    if (/\b(postToDiscussion|openDiscussion)\s*\(/.test(src)) callers.push(file.slice(ROOT.length + 1))
  }
  assert.deepEqual(
    callers,
    [FUNNEL],
    'only AnchorThreadComposer may post to a thread — route the surface through it instead of re-implementing it',
  )
})

/** Every top-level component in SectionView that renders a `<MainSection>`, as
 *  its whole function body — derived, not a hand-listed set, so a new section is
 *  covered the day it lands (UI-1's lesson about allowlists). The BODY, not just
 *  the JSX block, because a section's verbs are legitimately built into consts
 *  above the return (Discussion's are, so the cluster can be `undefined` rather
 *  than an empty fragment for a reader who has no verbs at all). */
function topLevelBodies(): string[] {
  // Top-level declarations start at column 0; everything until the next one is
  // that component's body.
  return stripComments(read(SECTION_VIEW)).split(/\n(?=(?:export )?(?:function|const) [A-Za-z])/)
}

function sectionComponents(): string[] {
  return topLevelBodies().filter((body) => body.includes('<MainSection'))
}

/** One named component's body — and it must exist, or the assertions over it
 *  would pass having read nothing (the vacuity rule in tests/CLAUDE.md). */
function componentBody(name: string): string {
  const hit = topLevelBodies().find((b) => new RegExp(`^(export )?(function|const) ${name}\\b`).test(b))
  assert.ok(hit, `${name} still exists in SectionView — this scan has a subject`)
  return hit
}

test('the section components are really being found (the scan is not vacuous)', () => {
  const bodies = sectionComponents()
  // About · Contributors · Coordination · Open work · Discussion · Changes · …
  assert.ok(bodies.length >= 6, `section components parsed (found ${bodies.length})`)
  const titles = bodies.flatMap((b) => [...b.matchAll(/title="([^"]+)"/g)].map((m) => m[1]))
  for (const expected of ['Discussion', 'Open work', 'Contributors']) {
    assert.ok(titles.includes(expected), `the ${expected} section is among them — the parser tracks the real markup`)
  }
})

test('no section leaves a compose form standing open — it hangs off the header verb', () => {
  const offenders: string[] = []
  for (const body of sectionComponents()) {
    if (!/<(Root|Anchor)ThreadComposer/.test(body)) continue
    const title = body.match(/title="([^"]+)"/)?.[1] ?? '(untitled)'
    // Disclosed = the composer sits behind a state gate AND the header carries
    // the verb that flips it, announced as a disclosure (aria-expanded).
    if (!/\{composing && /.test(body)) offenders.push(`${title}: composer renders unconditionally`)
    else if (!/expanded=\{composing\}/.test(body)) offenders.push(`${title}: no header verb discloses it`)
    // …and the cluster must PIN while composing, or the verb you just pressed
    // fades out from under the pointer when it leaves the header (UI-7).
    else if (!/revealActions=\{[^}]*composing/.test(body)) offenders.push(`${title}: the verb unpins mid-compose`)
  }
  assert.deepEqual(
    offenders,
    [],
    'a section composer must be disclosed by its header verb, like Open work / Coordination / Changes (UI-18)',
  )
})

test('the standing composers are the surfaces that ARE the conversation', () => {
  // Not everything hides. A composer is chrome on a HOST surface (an entity's
  // Discussion section) and payload on a surface whose whole subject is the
  // thread: the discussion's own page, and the Commons feed card, where the
  // owner ruled the inline box is the feed idiom (2026-07-24). Both stay
  // standing on purpose; this asserts the exception is deliberate, not decay.
  const page = componentBody('DiscussionPage')
  assert.ok(page.includes('<AnchorThreadComposer'), 'the discussion page composes through the funnel')
  assert.ok(!page.includes('<textarea'), 'and no longer hand-rolls a second one')
  assert.ok(!/const \[draft/.test(page), 'nor keeps a second draft state beside the funnel’s')
  assert.ok(componentBody('FeedCard').includes('<RootThreadComposer'), 'the feed card keeps its standing composer')
})

test('the shared composer can be a disclosed one — it closes and cancels', () => {
  const src = read(join(ROOT, FUNNEL))
  assert.match(src, /onPosted\?\.\(\)/, 'a disclosed composer is told when the post landed, so it can close')
  assert.ok(src.includes('onCancel &&'), 'a composer opened by an affordance can be closed without posting')
  assert.ok(src.includes('autoFocus'), 'the caret lands where the verb promised')
})
