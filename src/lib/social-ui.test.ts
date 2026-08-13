/** SOCIAL-5 funnel locks (docs/design/social-layer.md §3.1): the share-tier cue
 *  has ONE home (src/lib/tierBadge.ts + the shared <TierBadge>), and the grants
 *  UI reads through the one door (hooks/commands — no component knows the URL).
 *  The node harness has no DOM, so the panel's rendering is verified in-app;
 *  these locks keep the primitives from drifting (the copy-button pattern). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filesUnder, read, ROOT, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import { SHARE_TIERS } from '../../contract/social.ts'
import { TIER_LABELS, TIER_BADGE_CLASS } from './tierBadge.ts'

// The ONE source walker (tests/helpers/source.ts) — it THROWS when a scan
// matches nothing, so these enumerating locks can't quietly pass over zero
// files. A second local walker was exactly the drift that rule prevents.
const SRC = 'src'
const walk = (dir: string) => filesUnder(dir)

test('TIER_LABELS covers exactly the contract tiers (one label map, in tier order)', () => {
  assert.deepEqual(Object.keys(TIER_LABELS), [...SHARE_TIERS])
  for (const t of SHARE_TIERS) assert.ok(TIER_LABELS[t].trim().length > 0)
})

test('the tier pill has ONE home: no component re-hardcodes the badge class or a tier-label map', () => {
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    if (f.endsWith(`lib${join('/', 'tierBadge.ts')}`) || f.replace(/\\/g, '/').endsWith('lib/tierBadge.ts')) continue
    const src = readFileSync(f, 'utf8')
    if (src.includes(TIER_BADGE_CLASS)) offenders.push(`${f}: badge class re-hardcoded`)
    // A second label map would map 'co-own' to display text outside the funnel.
    if (/['"]co-own['"]\s*:/.test(src)) offenders.push(`${f}: tier label map re-declared`)
  }
  assert.deepEqual(offenders, [])
})

test('the grants UI goes through the one door: no component/controller carries the /grants URL', () => {
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    const norm = f.replace(/\\/g, '/')
    if (norm.endsWith('api/keys.ts')) continue // the ONE home for paths
    if (readFileSync(f, 'utf8').includes('/grants')) offenders.push(f)
  }
  assert.deepEqual(offenders, [])
})

/** Preference may key on a NAME; authority never may. A display name is the
 *  wire's public identity — attacker-controlled (`createWorkspace` has no
 *  uniqueness guard) and renameable — so a control gated on `x.postedBy ===
 *  myName` is wrong in both directions: a renamed workspace loses an act it
 *  holds, and a colliding name is offered one that 403s. Every standing decision
 *  ships as a viewer-relative flag the server computed from raw tenant ids
 *  (`canRetract` / `canResolve` / `canDelete` / `own`).
 *
 *  Earned 2026-07-22: the work-item Retract control compared display names, on
 *  BOTH its surfaces, against a wire face that deliberately strips the ids a
 *  client would need to do it correctly. Muting stays name-keyed on purpose —
 *  it is a per-viewer preference, not an authorization (docs/evaluation.md). */
test('no UI control is gated by comparing a display name — authority rides a server flag', () => {
  // The REDACTED display-name fields the social / work payloads carry.
  // `author` and `counterpart` joined the list in the S7 review: the DM inbox
  // decided its "You: " prefix with `last.author === d.counterpart`, which is
  // the very defect this lock names — and it slipped through because the list
  // enumerated only the fields the WORK payloads carry. Every REDACTED
  // display-name field belongs here, not just the ones that had bugs.
  const NAME_FIELDS = ['postedBy', 'openedBy', 'offeredBy', 'grantedBy', 'retractedBy', 'author', 'counterpart']
  const norm = (p: string) => p.split('\\').join('/')
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    // Whitespace-collapsed so the check is plain substring matching — a hand-
    // escaped RegExp built from a JS string is exactly how the first version of
    // this lock shipped VACUOUS ('\.' in a string literal is just '.').
    const src = readFileSync(f, 'utf8').replace(/\s+/g, ' ')
    for (const field of NAME_FIELDS) {
      // `.field ===` / `.field !==` — comparing the NAME itself. Rendering a
      // name is fine; deciding with it is not.
      if (src.includes(`.${field} ===`) || src.includes(`.${field} !==`)) {
        offenders.push(norm(f).split('/src/')[1] + ': ' + field)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'gate on the server-computed flag (canRetract / canResolve / canDelete / own), never on a display name',
  )
})

test('a thread title has ONE home: no surface re-slices a post body to make one', () => {
  // `discussionTitle` (contract/social.ts) was earned by the 2026-07-22 judgment
  // pass — a bare slice cuts mid-word and reads as broken rather than
  // abbreviated — and its comment already named the RAIL LIST as a subject. The
  // Discussions section row had been missed and still cut at 100 chars with no
  // ellipsis; the seeded thread (2026-07-23) made it visible. Enumerate the
  // class rather than fix the instance: any surface deriving a title from a post
  // body must call the funnel.
  let renders = 0
  for (const f of walk(SRC)) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // The class is deriving a title from the opening post's BODY. Match that
      // access precisely (`posts[0].body` / `posts[0]?.body`) rather than the
      // word "body" anywhere on the line: S8 added surfaces that read another
      // field off the opening post while passing an unrelated `body` PROP
      // (`<MentionText body={item.note} mentions={root?.posts[0]?.mentions} />`),
      // which the loose form flagged as a title it never derived.
      if (!/posts\[0\]\??\.body/.test(line)) return // reactions, mentions, ids, timestamps — not a title
      renders += 1
      // The call may wrap onto its own line, so read a small window around it.
      const window = lines.slice(Math.max(0, i - 2), i + 2).join(' ')
      assert.ok(
        window.includes('discussionTitle('),
        `${f}:${i + 1} derives a thread title from a post body without the funnel: ${line.trim()}`,
      )
    })
  }
  assert.ok(renders >= 1, 'at least one surface renders a thread title (the scan is not vacuous)')
})

/** ── S7 funnel locks — the person layer ─────────────────────────────────────
 *  Follow is `WatchToggle`'s sibling (a standing relationship, one with a
 *  person and one with a resource), so it gets the same treatment the tier pill
 *  and the copy button got: ONE home, enumerated rather than asserted. */
test('the follow toggle has ONE home: no surface hand-rolls a second one', () => {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const offenders: string[] = []
  let hosts = 0
  for (const f of walk(SRC)) {
    const rel = norm(f)
    const src = readFileSync(f, 'utf8')
    if (rel.endsWith('components/FollowButton.tsx')) continue
    if (rel.endsWith('api/commands.ts') || rel.endsWith('api/index.ts')) continue // the door itself
    // Calling the follow COMMAND outside the funnel is the drift: it means a
    // second control exists, with its own label, glyph and busy handling.
    if (src.includes('setFollow(')) offenders.push(`${rel.split('/src/')[1]}: calls setFollow outside <FollowButton>`)
    if (src.includes('<FollowButton')) hosts += 1
  }
  assert.deepEqual(offenders, [])
  assert.ok(hosts >= 1, 'at least one surface hosts the toggle (the scan is not vacuous)')
})

test('the person layer reads through the one door — no component carries its URLs', () => {
  const offenders: string[] = []
  for (const f of walk(SRC)) {
    const norm = f.replace(/\\/g, '/')
    if (norm.endsWith('api/keys.ts')) continue // the ONE home for paths
    const src = readFileSync(f, 'utf8')
    for (const url of ['/social/follow', '/me/follows', 'direct=1']) {
      if (src.includes(url)) offenders.push(`${norm.split('/src/')[1]}: ${url}`)
    }
  }
  assert.deepEqual(offenders, [])
})

/** A DM's "who is this with" is the SERVER's answer (`counterpart`), because the
 *  anchor names only ONE end: for the recipient, the anchored name is their own.
 *  A surface that read `anchor.ref.id` to label a message would therefore show
 *  half its readers their own name — a viewer-relative fact derived client-side,
 *  which is exactly what UI-12 forbids. */
test('no surface labels a message from its anchor — the counterpart is server-stamped', () => {
  // Scoped to the DM surfaces themselves. A whole-file conjunction ("mentions
  // `direct` somewhere AND `anchor.ref.id` somewhere") is not this rule: both
  // strings live legitimately in the same big module, and the first draft of
  // this lock flagged two innocent files for exactly that reason.
  const messagesSection = sectionViewComponent('MessagesSection')
  const messageButton = readFileSync(join('src', 'components', 'MessageButton.tsx'), 'utf8')
  for (const [where, body] of [['MessagesSection', messagesSection], ['MessageButton', messageButton]] as const) {
    assert.ok(body.includes('counterpart'), `${where} names the other party from the server's answer`)
    assert.ok(
      !body.includes('anchor.ref.id'),
      `${where} must not derive "who is this with" from the anchor — it names ONE end, so half its readers would see their own name`,
    )
  }
})

/** ── SOCIAL-7 `artifact-patch`: the delta's FACE has one home ────────────────
 *  A delta is rendered per kind, and that rendering had already been written
 *  TWICE by hand (the Improvements panel and the project's merged Changes
 *  panel) — divergently: one labelled every row "routine change", graph edits
 *  and prose suggestions included. Adding a third kind without unifying them
 *  would have made a third place to forget. So `components/DeltaView.tsx` is
 *  the one home, and a surface that renders a delta must go through it. */
test('the proposal delta has ONE renderer: no surface re-branches on delta.kind', () => {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const offenders: string[] = []
  let hosts = 0
  for (const f of walk(SRC)) {
    const rel = norm(f)
    const src = readFileSync(f, 'utf8').replace(/\s+/g, ' ')
    if (rel.endsWith('components/DeltaView.tsx')) continue // the funnel itself
    // Branching on a delta's kind, or re-calling a delta's human describer, is
    // the drift — it means a second rendering exists with its own labels.
    // Probes that are specific to a proposal DELTA. `describeOp` is deliberately
    // not one: it is the shared human face for a relation op, which the consent
    // card (RelationActionCard) renders for reasons that have nothing to do with
    // proposals — probing it would forbid a legitimate second caller.
    for (const probe of ['delta.kind ===', 'describeSchedulePatch(']) {
      if (src.includes(probe)) offenders.push(`${rel.split('/src/')[1]}: ${probe}`)
    }
    if (src.includes('<ProposalDeltaView') || src.includes('<DeltaView')) hosts += 1
  }
  assert.deepEqual(offenders, [])
  assert.ok(hosts >= 2, 'both proposal surfaces render through the funnel (the scan is not vacuous)')
})

/** The offer FORM is per-kind, and each kind's is driven by the predicate the
 *  SERVER validates with — so a form can never offer what the wall refuses.
 *  Earned: the panel rendered the ROUTINE field picker for every subject kind
 *  while its own doc comment claimed a prose fallback, which was invisible only
 *  because a routine was its sole host. Mounting it on an artifact would have
 *  offered "cadence" and "notifyOnFailure" on a document. */
test('the artifact offer form and the server validator share ONE patchability predicate', async () => {
  const { patchableBlocks, artifactPatchDelta } = await import('./proposalForm.ts')
  const body = {
    type: 'doc',
    title: 'T',
    blocks: [{ h: 'Heading' }, { p: 'Prose.' }, { ul: ['a', 'b'] }, { code: ['x'] }, { email: { to: 'a@b', subject: 's' } }],
  }
  // Exactly the single-string blocks — `ul`/`code` hold a LIST and `email` a
  // structured header, so a one-line before→after cannot address them.
  assert.deepEqual(patchableBlocks(body), [
    { index: 0, text: 'Heading' },
    { index: 1, text: 'Prose.' },
  ])
  // A body with no addressable prose offers nothing rather than a broken picker.
  assert.deepEqual(patchableBlocks({ type: 'figure', shape: 'bars', caption: 'c' }), [])
  assert.deepEqual(patchableBlocks(undefined), [])

  // The form's delta mirrors every refusal the offer route makes, so the button
  // stays disabled instead of posting something the server would reject.
  assert.equal(artifactPatchDelta(null, 'text', undefined), null, 'no block chosen')
  assert.equal(artifactPatchDelta(1, '   ', 'Prose.'), null, 'blank text')
  assert.equal(artifactPatchDelta(1, 'Prose.', 'Prose.'), null, 'identical — a no-op that would burn an L#')
  assert.deepEqual(artifactPatchDelta(1, ' New. ', 'Prose.'), { kind: 'artifact-patch', block: 1, text: 'New.' })
})

/** An offer form that can never submit is the dead affordance this layer's
 *  audits keep removing. A `figure`/`sheet`/`slides` artifact — or a served file
 *  — has no addressable prose, so it must reach the reviewable-suggestion FLOOR
 *  the server accepts for every subject, not a block picker with nothing in it. */
test('an artifact with no addressable prose falls to the suggestion floor, not a dead picker', async () => {
  const { offerFormFor, patchableBlocks, suggestionDelta } = await import('./proposalForm.ts')
  assert.equal(offerFormFor('schedule', 0), 'schedule-fields')
  assert.equal(offerFormFor('artifact', 3), 'artifact-blocks', 'a doc body gets the block picker')
  assert.equal(
    offerFormFor('artifact', patchableBlocks({ type: 'figure', shape: 'bars', caption: 'c' }).length),
    'suggestion',
    'a figure has no addressable block — the floor, never an unsubmittable picker',
  )
  assert.equal(offerFormFor('artifact', patchableBlocks(undefined).length), 'suggestion', 'a served/unknown body too')
  assert.equal(offerFormFor('project', 0), 'suggestion', 'every other kind is the floor by definition')
  // …and the floor actually produces a delta, so the form it selects can submit.
  assert.deepEqual(suggestionDelta(' tighten the caption '), { kind: 'suggestion', text: 'tighten the caption' })
})

/** The blocks the form lists come from the CONTRACT's predicate, not a copy —
 *  the `PROPOSABLE_SCHEDULE_FIELDS` discipline applied to the second kind. */
test('the patchable-block predicate is the contract’s, not a re-implementation', () => {
  const form = readFileSync(join('src', 'lib', 'proposalForm.ts'), 'utf8')
  assert.match(form, /docBlockText/, 'the form filters with the contract’s own total function')
  const preview = readFileSync(join('src', 'components', 'artifactPreview.tsx'), 'utf8')
  assert.match(preview, /docBlockText/, 'and so does the owner’s in-place editor — one predicate, one pencil placement')
})

/** ── A composer asks the THREAD, not the subject ─────────────────────────────
 *  `GET /social/capability` answers about a SUBJECT, and on a PRINCIPAL that
 *  means reachability — "could you cold-open to this person" — which is FALSE
 *  for yourself, by design. A wall post's subject is its author's own principal,
 *  so every surface that gated its composer on the subject-level answer refused
 *  the author a reply box on their own post, while `discussionWritableBy` would
 *  have accepted the reply. Two decisions about one act, which is the exact
 *  defect `Discussion.canPost` was added to end — its comment in
 *  contract/social.ts named the trap for the mirror-image DM case, and the
 *  surfaces went on asking the subject anyway. A named field with no lock is a
 *  suggestion (the same shape as UI-18's fourth surface, and UI-22's unsized
 *  button): so `.canComment` now has exactly one reader. */
test('no surface gates a composer on the subject when a thread can answer', () => {
  const readers: string[] = []
  for (const file of filesUnder('src')) {
    const rel = file.replace(/\\/g, '/').split('/src/')[1]
    if (rel === 'api/hooks.ts') continue // the funnel — useCanComment lives here
    if (/\.canComment\b/.test(stripComments(read(file)))) readers.push(rel)
  }
  assert.deepEqual(
    readers,
    [],
    'read the thread’s own canPost through useCanComment (src/api/hooks.ts) — the subject-level answer is a different question on a principal anchor',
  )
})

test('the one reader really does prefer the thread (the scan is not vacuous)', () => {
  const hooks = stripComments(read(join(ROOT, 'src', 'api', 'hooks.ts'))).replace(/\s+/g, ' ')
  const fn = hooks.match(/export function useCanComment[^}]*\}/)?.[0] ?? ''
  assert.ok(fn, 'the funnel exists')
  assert.ok(fn.includes('thread ? thread.canPost === true'), 'a thread answers for itself')
  assert.ok(fn.includes('bySubject'), '…and only a thread-less subject falls back to the capability')
  // The hosts that must consume it — each one holds a thread while deciding.
  for (const [rel, hosts] of [
    ['components/SectionView.tsx', 3],
    ['components/LocusGutter.tsx', 1],
  ] as const) {
    const src = stripComments(read(join(ROOT, 'src', ...rel.split('/'))))
    const used = (src.match(/useCanComment\(/g) ?? []).length
    assert.ok(used >= hosts, `${rel} routes its ${hosts} composer gate(s) through the hook (found ${used})`)
  }
})

/** ── The feed card's conversation is DISCLOSED, never a trip ─────────────────
 *  Owner directive 2026-08-08: "the reply button should be a toggle of the
 *  comments below instead of jump to a new page. The new page and the comments
 *  are duplicate." Both halves matter and they pull against each other, so both
 *  are held here:
 *
 *  · Reply must not NAVIGATE. `/discussions/:id` renders the very thread the
 *    card already carries — one conversation, two projections — so the door
 *    spent the reader's place in the feed to show them what they were looking
 *    at. "View all N comments" was the same trip under another name.
 *  · …and the card must therefore be able to show ALL of it. The cheap way to
 *    kill the navigation is to keep the two-post tail and quietly drop the
 *    door, which leaves the rest of a thread reachable from nowhere. */
test('the feed card discloses its thread in place — Reply toggles, nothing navigates away', () => {
  // COMMENTS OUT first. This scan bans phrases the card's own comments discuss
  // by name ("the door it replaced", "no view all N comments left"), so reading
  // them would make the bans spuriously fail — and, worse, would let a positive
  // assertion pass on a comment describing code that is no longer there.
  const card = stripComments(sectionViewComponent('FeedCard')).replace(/\s+/g, ' ')

  // The act bar's own doors: the mention and the embed title legitimately leave
  // (`navigate('agents'…)`, `navigate(target…)`) — the CONVERSATION must not.
  //
  // This ban was once absolute ("no navigate('discussions' anywhere in the
  // card") and had to be narrowed on 2026-08-08, when the owner asked for the
  // opposite of what it was guarding: *"there should be a button like
  // fullscreen to [link] them"*. The two rules are not in tension once stated
  // precisely — Reply DISCLOSES, and a separate control that says out loud
  // where it goes may LEAVE. An absolute ban states the first rule by forbidding
  // the mechanism, which also forbids the honest use of it; so the claim is now
  // that the only trip out of the card is the one that describes itself.
  const trips = card.match(/navigate\('discussions'/g) ?? []
  assert.equal(trips.length, 1, 'exactly one door to /discussions/:id — the fullscreen one')
  assert.ok(
    card.includes('Open this post on its own page'),
    '…and it names itself, so it can never be Reply quietly navigating again',
  )
  assert.ok(!/View all \{?\w* ?comments/.test(card), 'the "View all N comments" trip is the same door under another name')

  // A disclosure, announced as one: a toggle with no aria-expanded is a button
  // whose state only sighted users can see.
  assert.ok(/aria-expanded=\{open\}/.test(card), 'Reply announces itself as a disclosure')
  assert.ok(/setOpen\(!open\)/.test(card), 'and actually toggles rather than only opening')

  // The whole thread, not a teaser — `shown`, never a slice of it.
  //
  // The subject moved on 2026-08-13 and the claim did not: the list used to take
  // a `posts` prop and now takes the fold HANDLE, which carries the posts (one
  // source, so a host cannot pair a tree of one array with an index of
  // another). So the thread the card renders is whatever `useThreadFold` was
  // built from, and that is where "the whole thread" now has to be asserted.
  assert.ok(/useThreadFold\(shown\)/.test(card), 'the card’s thread is the whole of `shown`')
  assert.ok(/<DiscussionPostList\s+fold=\{fold\}/.test(card), '…and the list renders that same thread')
  assert.ok(!/shown\.slice/.test(card), 'a tail would leave the rest of the thread reachable from nowhere')

  // The composer is INSIDE the disclosure (owner directive 2026-08-08): the
  // replies and the box for adding one are one thing, so a resting feed can't
  // offer a reply box for a conversation it isn't showing. Checked as
  // containment — a composer merely rendered after the block is the old
  // arrangement — and mounting with the disclosure is what lets the caret land
  // by plain autoFocus, so the two claims are asserted together.
  // The block is taken by BALANCED parens, not by "…up to </article>": tying
  // containment to the disclosure being the card's last child would fail the
  // day anything legitimate is appended after it, which is a lock that cries
  // about the wrong thing.
  const disclosed = (() => {
    const at = card.indexOf('{open && (')
    if (at < 0) return ''
    let i = card.indexOf('(', at)
    let depth = 0
    for (; i < card.length; i++) {
      if (card[i] === '(') depth++
      else if (card[i] === ')' && --depth === 0) return card.slice(at, i + 1)
    }
    return ''
  })()
  assert.ok(disclosed, 'the card opens a disclosure block gated on `open`')
  assert.ok(disclosed.includes('<DiscussionPostList'), 'the replies are inside it')
  assert.ok(disclosed.includes('<RootThreadComposer'), 'and so is the box for adding one')
  assert.ok(/autoFocus/.test(disclosed), 'which autoFocuses, since it now mounts with the disclosure')
  assert.ok(!card.includes('inputRef'), 'the ref the standing version needed is gone with it')
})

/** ── A post's page IS the post's card ────────────────────────────────────────
 *  Owner report, 2026-08-08: *"the page of the post … doesn't correspond to the
 *  post as viewed from the commons page."* It had drifted the way two hand-built
 *  renderings of one object always do — the page grew a title out of the post's
 *  own words (printing them twice), and lost the Like and Watch the card
 *  carries, because nothing tied the two together but intention.
 *
 *  So the fix is not "make them match" but "make them one": the page renders the
 *  very component the feed does. This lock is what keeps a well-meaning second
 *  rendering from growing back. */
test('a post’s page renders the card itself, not a second arrangement of the same facts', () => {
  const page = stripComments(sectionViewComponent('DiscussionPage')).replace(/\s+/g, ' ')

  assert.ok(/<FeedCard item=\{post\} standalone/.test(page), 'the page renders the feed card, opened')
  // …and the card must be told it is standing alone, or it would offer a fold
  // and a door to the page the reader is already on.
  assert.ok(page.includes('post ?'), 'the post branch is what selects it')

  // The post's own words are its CONTENT. Titling the page with them is the
  // duplication that was reported, so the title branches away from
  // `discussionTitle` for a post — asserted as an ordering, since the generic
  // thread legitimately still uses it.
  const title = page.match(/<h1[^>]*>\s*\{([^}]*discussionTitle[^}]*)\}/)?.[1] ?? ''
  assert.ok(title, 'the header still has one title expression')
  assert.ok(/^\s*post \?/.test(title), 'a post decides the title BEFORE discussionTitle can print its body')

  // What a post IS is the server's decision, made once when it mints the feed
  // item. A second client-side predicate over the anchor would be that decision
  // made twice — the drift this whole test exists about.
  assert.ok(
    /kind === 'post' && i\.discussionId === discussionId/.test(page),
    'the page asks the feed what a post is, rather than re-deriving it from the anchor',
  )
  assert.ok(
    !/anchor\.ref\.kind === 'principal'/.test(page),
    'a hand-rolled wall-post predicate is the server’s answer, guessed at',
  )

  // Unifying two renderings costs nothing only if the survivor keeps what BOTH
  // could do. The page's own list carried the S5 guardrails (retract your words,
  // moderate your surface, report to whoever holds the delete) and the feed
  // card's deliberately does not — "a destructive act belongs where the whole
  // thread is". Standing alone IS that place, so the card must offer them there.
  const card = stripComments(sectionViewComponent('FeedCard')).replace(/\s+/g, ' ')
  for (const act of ['onDelete', 'onReport']) {
    assert.match(
      card,
      new RegExp(`${act}=\\{standalone && root \\?`),
      `the post's own page lost ${act} when it started rendering the card`,
    )
  }
})

/** S8 — the mention highlight must cover exactly what the server matched. The
 *  segmentation is invisible in a screenshot and easy to get subtly wrong, so
 *  it lives in a pure module and is held here. */
test('mention segmentation covers exactly the resolved names, longest first', async () => {
  const { mentionSegments } = await import('./mentions.ts')
  const plain = mentionSegments('nothing to see', undefined)
  assert.deepEqual(plain, [{ text: 'nothing to see' }], 'no resolved names ⇒ one plain run')

  // A name with a comma and a space — the case a client-side regex cannot do.
  assert.deepEqual(mentionSegments('ping @Acme, Inc. about it', ['Acme, Inc.']), [
    { text: 'ping ' },
    { text: '@Acme, Inc.', mention: 'Acme, Inc.' },
    { text: ' about it' },
  ])

  // A resolved name that is a PREFIX of another must lose to the longer one —
  // the same tie-break the server's resolver makes, or the highlight would
  // stop short of what got rung.
  assert.deepEqual(mentionSegments('@Acme, Inc. shipped', ['Acme', 'Acme, Inc.']), [
    { text: '@Acme, Inc.', mention: 'Acme, Inc.' },
    { text: ' shipped' },
  ])

  // An `@` that resolved to nothing stays plain text — the server decides what
  // is a mention, and an unmatched one is not.
  assert.deepEqual(mentionSegments('email me @ home, @Beta Platform', ['Beta Platform']), [
    { text: 'email me @ home, ' },
    { text: '@Beta Platform', mention: 'Beta Platform' },
  ])

  // Repeats are each their own run (two doors, not one).
  const twice = mentionSegments('@Ada and @Ada', ['Ada'])
  assert.equal(twice.filter((s) => s.mention).length, 2)

  // Round trip: the runs always reassemble the original body, whatever the names.
  for (const [body, names] of [
    ['@Acme, Inc. said @Beta Platform should look', ['Acme, Inc.', 'Beta Platform']],
    ['no mentions at all', ['Acme, Inc.']],
    ['@@Beta Platform', ['Beta Platform']],
  ] as [string, string[]][]) {
    assert.equal(mentionSegments(body, names).map((s) => s.text).join(''), body, `round-trips: ${body}`)
  }
})

/** ── A name in a thread is a door to the person (owner directive 2026-08-08) ──
 *  "As basic social feature, commenter names should jump to their page upon
 *  click, much like the poster's name."
 *
 *  The escape's shape is what makes it worth a lock: the feed card's HEAD ran
 *  its actor through <OwnerLink> while the card's BODY — the shared post list,
 *  three surfaces at once — rendered the same kind of name as a bare span. One
 *  card, two spellings of one datum, and the reader learns from the first that a
 *  name is clickable and from the second that it isn't. So the assertion is not
 *  "this component was fixed" but "no surface renders an author's name inert":
 *  a scan over the whole tree, with the ONE deliberate exemption named and
 *  alive-checked (the UI-16 pattern — a stale exemption quietly widens the ban's
 *  hole, and a file-scoped one would have cleared the offender itself). */
test('an author’s name is a door wherever a thread shows it — no surface renders it inert', () => {
  // A JSX CHILD render of an author name: `>{x.author}` after whitespace
  // collapse. Prop positions (`ownerName={p.author}`, `name={c.author}`) are the
  // funnel's own plumbing and must not match — the door is exactly what they do.
  // Declared WITHOUT /g and re-flagged per use: a global regex carries
  // `lastIndex` across `.test()` calls, so one shared object would make the
  // second exemption's aliveness check depend on the first's match position.
  const BARE_AUTHOR = />\s*\{\s*[A-Za-z_$][\w$]*\.author\b/
  const everyBareAuthor = (s: string) => s.match(new RegExp(BARE_AUTHOR, 'g')) ?? []
  /** Deliberately-inert author names: the surface, and WHY. Each must still be
   *  found, so a moved or renamed component fails here instead of silently
   *  granting itself an exemption. */
  const EXEMPT = [
    {
      component: 'ProposalThread',
      why: 'an agent proposal is a parties-only negotiation — its two participants are the dialog, not a public square with profiles to visit (FWD-5 Phase 3, stated in the component)',
    },
  ]
  const exemptBodies = EXEMPT.map((e) => stripComments(sectionViewComponent(e.component)).replace(/\s+/g, ' '))
  for (const [i, body] of exemptBodies.entries()) {
    assert.match(body, BARE_AUTHOR, `the ${EXEMPT[i].component} exemption is stale — nothing there renders a bare author`)
  }

  // The exempt SURFACES are cut out of the source before scanning — not matched
  // by the text of their hit. `>{c.author` is a spelling, not an address: an
  // exemption keyed on it would silently pardon any other component that
  // happened to name its post `c`, which is most of them.
  const offenders: string[] = []
  let cut = 0
  for (const file of filesUnder(SRC)) {
    let src = stripComments(read(file)).replace(/\s+/g, ' ')
    for (const body of exemptBodies) {
      if (!src.includes(body)) continue
      src = src.split(body).join(' ')
      cut += 1
    }
    for (const hit of everyBareAuthor(src)) {
      offenders.push(`${file.replace(/\\/g, '/').split('/src/')[1]}: ${hit}`)
    }
  }
  assert.equal(cut, EXEMPT.length, 'every exempt body was located and excised — an un-excised one would report itself as an offender')
  assert.deepEqual(
    offenders,
    [],
    'render the name through <OwnerLink>/<ActorByline> with a handler onto that namespace’s profile — a name a reader cannot follow is a dead end',
  )

  // …and the one post list really does open the profile — the SAME funnel its
  // @-mentions already used, so a card can't door one name two ways.
  const list = stripComments(sectionViewComponent('DiscussionPostList')).replace(/\s+/g, ' ')
  assert.ok(
    list.includes('<OwnerLink bare ownerName={p.author}') && list.includes('onClick={() => onOpenPerson(p.author)}'),
    'the author byline is the shared owner door, wired to the profile handler',
  )
  assert.ok(list.includes('onOpenPerson: (name: string) => void'), 'which is REQUIRED — a doorless post list is not a shape this app has')
})

test('the shared per-post act face carries no colour of its own', () => {
  // It carried `text-ink-faint` for one revision, and the ENDORSED state — which
  // appends `text-accent` — silently stopped showing: two base `text-*`
  // utilities in one class attribute have no defined winner, the cascade
  // decides by their order in the generated CSS, and the faint one won. Nothing
  // failed; the button simply stopped saying you had endorsed the post, in the
  // same faint grey as one you had not. (The same trap lib/textDoor records for
  // two `border-*` colours; caught here by reading a computed style in the
  // running app, which is the only place it was visible.)
  //
  // The general rule this instance stands for: a shared primitive must not own
  // a property that any of its callers vary.
  const src = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const def = /const POST_ACT_CLASS =\s*'([^']*)'/.exec(src)
  assert.ok(def, 'the shared per-post act face is defined')
  const colour = /\btext-(?:ink|accent|co|danger|removed|warn|ok|on-solid)[\w-]*/.exec(def[1])
  assert.equal(
    colour?.[0],
    undefined,
    `POST_ACT_CLASS must set no resting text colour — callers vary it, and a colour here beats theirs by cascade order, not by intent: "${def[1]}"`,
  )
  // …and the two states that must be distinguishable each still name a colour.
  assert.match(src, /p\.reacted\s*\?\s*'text-accent'/, 'an endorsed post says so in accent')
  assert.match(src, /\$\{POST_ACT_CLASS\} text-ink-faint/, 'a resting act supplies its own faint')
})

/** ── The per-post unfold-all has ONE render rule ───────────────────────────
 *
 *  `branch > 0`, and nothing else. Adjudicated three times, each wrong answer a
 *  different way of asking *does this control have work to do right now?*:
 *  first only on a folded post holding a folded descendant, then on every
 *  folded post with replies (owner directive 2026-08-11), then also on an open
 *  post holding a folded one (owner directive 2026-08-12) — which reached the
 *  right states but made the button obey TWO rules, unconditional when folded
 *  and conditional when open.
 *
 *  The owner's objection to that, and the reason this lock exists (report,
 *  2026-08-12): the asymmetry costs the design its orthogonality. The deciding
 *  state is also usually INVISIBLE — a fold five levels down, inside a branch
 *  you would have to expand to see — so a control gated on it appears and
 *  vanishes for reasons the reader cannot observe. That is the original
 *  unfindability defect wearing a new gate.
 *
 *  Scanned rather than unit-tested BECAUSE the rule is now one term: there is no
 *  predicate left to hand a truth table to, which is the point — a condition
 *  complicated enough to unit-test would already be the regression. `node --test`
 *  has no DOM (`src/components/CLAUDE.md`), so the gate is read as source here
 *  and the resulting rows are counted in `e2e/social-anchors.spec.ts`. */
test('the per-post unfold-all is gated on the BRANCH alone — not on what is folded inside it', () => {
  const body = stripComments(sectionViewComponent('DiscussionPostList'))
  const gate = /const unfoldBranch = ([^\n]*?) && \(/.exec(body)
  assert.ok(gate, 'DiscussionPostList still declares `unfoldBranch` with a render gate')
  assert.equal(
    gate[1].trim(),
    'branch > 0',
    `the discard renders on every post with replies, in both fold states — a gate mentioning \`folded\` or \`hidden\` ` +
      `is the asymmetry this rule was collapsed to remove (found: "${gate[1].trim()}")`,
  )
  // Vacuity guard: the assertion above would also pass on a component that had
  // lost the fold model entirely, which is exactly the shape a bad refactor
  // leaves behind. Both terms must still be live — the claim is that the GATE
  // does not read them, not that they stopped existing.
  //
  //  Matched as the DECLARATIONS rather than by a word-boundary probe. The probe
  //  is what this was written as, and it failed on arrival for the reason
  //  `tests/helpers/source.ts` already records: a heredoc collapsed `\\W` to
  //  `\W`, and inside a template literal that is the letter W. The declarations
  //  need no escapes and say more — the fold set is state and `hidden` is
  //  derived from it, which is the model the gate is being kept out of.
  //
  //  The first term is the DESTRUCTURE, not a `useState` pair, since 2026-08-13:
  //  the fold set moved up to `useThreadFold` so the thread's two sweep verbs
  //  could render in the Discussion section's header cluster (a control cannot
  //  leave the component that holds the state it drives). The guard is about the
  //  model being reachable from this component, not about where it is declared —
  //  so it follows the model rather than failing at it, which is what a lock is
  //  for. `folded` and `hidden` still have to be live here either way.
  for (const decl of ['folded, replyingTo, setReplyingTo, toggle } = fold', 'const hidden = folded.has(p.id)']) {
    assert.ok(body.includes(decl), `the component still has the fold model to have excluded — missing \`${decl}\``)
  }
})

/** ── Every host of a thread offers the thread's two sweeps ───────────────────
 *  The pair moved out of `DiscussionPostList` on 2026-08-13 so it could render
 *  in the Discussion section's header cluster with that section's other verbs
 *  (owner directive: *"fold/unfold all buttons in discussion section can be
 *  per-section buttons, too"*). The list draws posts now; where the thread's
 *  own verbs live is a question about the surface around it.
 *
 *  Which creates a failure the old shape could not have: a host can render the
 *  list and simply never place the pair, and the thread becomes unfoldable in
 *  that projection alone. There are three hosts and two answers between them
 *  (`threadFoldVerbs` in a section header, `<ThreadFoldControls>` where there is
 *  no header), so "did each host pick one" is a real question with no other
 *  asker — the browser walks cover the section header and the discussion PAGE,
 *  and nothing covered the feed card.
 *
 *  DERIVED from the file rather than hand-listed, so a fourth projection is
 *  covered the day it lands — the same rule `thread-composer.test.ts` follows
 *  for the same file, and the reason UI-1's allowlist lesson keeps being cited. */
test('every surface that renders a thread also renders its Fold all · Unfold all', () => {
  const bodies = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
    .split(/\n(?=(?:export )?(?:function|const) [A-Za-z])/)
  const hosts = bodies.filter((b) => b.includes('<DiscussionPostList'))
  assert.ok(hosts.length >= 3, `the scan found the thread hosts (got ${hosts.length})`)
  const naked = hosts
    .filter((b) => !b.includes('<ThreadFoldControls') && !b.includes('threadFoldVerbs('))
    .map((b) => b.match(/^(?:export )?(?:function|const) ([A-Za-z]+)/)?.[1] ?? '(anonymous)')
  assert.deepEqual(naked, [], `these render a thread nobody can fold: ${naked.join(', ')}`)
  // …and each host hands the LIST the same handle it drove the controls with.
  // Cheap to get wrong now that the posts ride inside the handle: a host that
  // built one handle for the controls and passed a second to the list would
  // render one thread and fold another.
  for (const b of hosts) {
    const handles = new Set([...b.matchAll(/(?:fold=\{|<ThreadFoldControls fold=\{)([A-Za-z]+)\}/g)].map((m) => m[1]))
    assert.equal(handles.size, 1, `one host, one fold handle — found ${[...handles].join(', ')}`)
  }
})
