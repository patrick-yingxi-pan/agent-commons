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
import { ROOT, read, filesUnder, stripComments, sectionViewComponent } from './helpers/source.ts'

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

/** One named component's body — the SHARED extractor (tests/helpers/source.ts),
 *  so this suite and social-ui parse SectionView the same way. */
const componentBody = sectionViewComponent

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

test('the ONE standing composer is the surface that IS the conversation', () => {
  // Not everything hides. A composer is chrome on a HOST surface (an entity's
  // Discussion section) and payload on a surface whose whole subject is the
  // thread — which, since 2026-08-08, is the discussion's own PAGE and nothing
  // else. The Commons feed card held the same exception (owner ruling
  // 2026-07-24: the inline box is the feed idiom) and lost it the day Reply
  // became a disclosure: a card's subject is the POST, and the talk underneath
  // is secondary — exactly what folding it says. A standing box inviting
  // replies to a conversation the card wasn't showing was the tell.
  const page = componentBody('DiscussionPage')
  assert.ok(page.includes('<AnchorThreadComposer'), 'the discussion page composes through the funnel')
  assert.ok(!page.includes('<textarea'), 'and no longer hand-rolls a second one')
  assert.ok(!/const \[draft/.test(page), 'nor keeps a second draft state beside the funnel’s')
})

test('the shared composer can be a disclosed one — it closes and cancels', () => {
  const src = read(join(ROOT, FUNNEL))
  // It is told WHICH thread the post landed in, not merely that it landed:
  // get-or-create is the server's rule, so a caller that passed `thread: null`
  // (the DM door, every first post) cannot otherwise know what it just created.
  assert.match(src, /onPosted\?\.\(landed\)/, 'a disclosed composer is told when — and where — the post landed, so it can close and open it')
  assert.ok(src.includes('onCancel &&'), 'a composer opened by an affordance can be closed without posting')
  assert.ok(src.includes('autoFocus'), 'the caret lands where the verb promised')
  // ONE focus mechanism, because there is now one kind of disclosed composer.
  // The feed card's briefly needed a ref — it stood open, so it never remounted
  // and autoFocus could never fire for it; folding it into the disclosure took
  // that requirement away, and the prop went with it rather than lingering as a
  // second way to do the same thing.
  assert.ok(!src.includes('inputRef'), 'no second focus route survives the composer that needed it')
})

/** The submit is a VERB and the cancel is a dismissal, so they must not read as
 *  one control typed twice. Both were `INLINE_ACTION_CLASS` — the same grey
 *  ghost text — until the owner's 2026-08-08 report ("the two post buttons …
 *  are ugly"); the pair is now ranked, and the affirmative wears the shared
 *  soft-verb face at a stated size (tests/button.test.ts holds the sizing rule
 *  for every call site). */
test('the composer’s pair is ranked — the submit is the soft verb, the cancel stays ghost', () => {
  const src = stripComments(read(join(ROOT, FUNNEL))).replace(/\s+/g, ' ')
  assert.ok(src.includes("from '../lib/button'"), 'the submit sources the shared face rather than restyling one')
  const post = src.match(/<button[^>]*?onClick=\{\(\) => void send\(\)\}.*?<\/button>/)?.[0] ?? ''
  assert.ok(post.includes('SOFT_BUTTON_CLASS'), `the submit wears the affirmative face (found: ${post.slice(0, 120)})`)
  const cancel = src.match(/\{onCancel && \(.*?\)\}/)?.[0] ?? ''
  assert.ok(cancel.includes('INLINE_ACTION_CLASS'), 'the cancel stays quiet ghost text')
  assert.ok(!cancel.includes('SOFT_BUTTON_CLASS'), 'two affirmative-looking buttons would rank the pair equally')
})

/** The verbs sit INSIDE the field (owner directive 2026-08-08: "make the post
 *  button into the text box"). That is a containment claim, so it is checked as
 *  one: the shell element must hold BOTH the control and the submit. A button
 *  merely styled to look adjacent, or a shell that closes before the button, is
 *  the arrangement this replaced. The baseline rule itself belongs to the shared
 *  cue — `tests/form-input.test.ts` holds it there, so it can't be satisfied
 *  here by one composer while the other drifts. */
test('the composer’s verbs live inside the field’s shell, not beside it', () => {
  const src = stripComments(read(join(ROOT, FUNNEL))).replace(/\s+/g, ' ')
  assert.ok(
    !src.includes('FORM_INPUT_CLASS'),
    'a field that hosts its own buttons wears the SHELL — the plain cue would draw a box inside the box',
  )
  const shell = src.match(/<div className=\{FIELD_SHELL_CLASS\}>.*?<\/div>/)?.[0] ?? ''
  assert.ok(shell, 'the composer opens a field shell')
  assert.ok(shell.includes('<textarea'), 'the control is inside it')
  assert.ok(/void send\(\)/.test(shell), 'and so is the submit — the whole point of the shell')
  assert.ok(/onCancel &&/.test(shell), 'the cancel too, or the pair straddles the field’s edge')
})
