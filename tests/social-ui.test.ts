/** SOCIAL-5 funnel locks (docs/design/social-layer.md §3.1): the share-tier cue
 *  has ONE home (src/lib/tierBadge.ts + the shared <TierBadge>), and the grants
 *  UI reads through the one door (hooks/commands — no component knows the URL).
 *  The node harness has no DOM, so the panel's rendering is verified in-app;
 *  these locks keep the primitives from drifting (the copy-button pattern). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filesUnder, sectionViewComponent } from './helpers/source.ts'
import { SHARE_TIERS } from '../contract/social.ts'
import { TIER_LABELS, TIER_BADGE_CLASS } from '../src/lib/tierBadge.ts'

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
      if (!line.includes('posts[0]') || !/\bbody\b/.test(line)) return // reactions, ids, timestamps — not a title
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
  const { patchableBlocks, artifactPatchDelta } = await import('../src/lib/proposalForm.ts')
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
  const { offerFormFor, patchableBlocks, suggestionDelta } = await import('../src/lib/proposalForm.ts')
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
