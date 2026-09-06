/** Social layer — square. Split out of the 1,611-line
 *  `social-layer.spec.ts`, which was 26% of the E2E suite in ONE file and so
 *  set a floor no sharding could beat (a lane is never shorter than its
 *  longest spec). The tests are unchanged and were already independent — no
 *  constant was shared between two of them. Shared setup lives in
 *  `./social-helpers.ts`; the walks themselves are documented there. */
import { test, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { ms } from './budget.ts'
import { STAMP, createProject, gotoSection, newUser, openAdaProfile, openSection, openShareForm } from './social-helpers.ts'
test('the Commons lenses: an act fills the collection the rail lists it under', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  // The lenses are the viewer's OWN relationships (UI-19), so the proof has to
  // be a round trip through the UI: do the act on a card, then find the item
  // under the lens — and confirm it is NOT under a lens whose act you skipped.
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  const LENS_PROJECT = `Lens walk ${STAMP}`
  const LENS_NOTE = `Lens note ${STAMP}`
  await ada.page.goto('/')
  await createProject(ada.page, LENS_PROJECT)
  // Configuration sections open FOLDED (owner decision 2026-08-12), so the share
  // controls are one click behind their header now — exactly as a reader finds them.
  await openShareForm(ada.page)
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Tier').selectOption({ label: 'Propose' })
  await ada.page.getByLabel('Share note (publishes when present)').fill(LENS_NOTE)
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ada.page.getByText('tenant-beta · published')).toBeVisible()

  // ── POSTED is the actor's own act — Ada's, never Grace's ──────────────────
  await ada.page.goto('/commons/posted')
  await expect(ada.page.getByText(LENS_NOTE)).toBeVisible({ timeout: ms(20_000) })
  await grace.page.goto('/commons/posted')
  // Prove the lens rendered, then assert only on THIS act. Grace may already
  // have published unrelated work earlier in the same persistent suite run.
  await expect(grace.page.getByRole('heading', { name: 'Commons · Posted' })).toBeVisible({ timeout: ms(20_000) })
  await expect(grace.page.getByText(LENS_NOTE)).toHaveCount(0)

  // ── LIKED and WATCHED are filled by the card's two acts ───────────────────
  await grace.page.goto('/commons')
  // The card by its own ROLE. This used to hunt for the innermost `div`
  // containing the note and hope `.last()` was the card — which held only
  // because the card happened to be a bare div; a feed of near-identical cards
  // deserves a boundary, so the card is an <article> and this asks for one.
  const card = grace.page.getByRole('article').filter({ hasText: LENS_NOTE })
  await expect(grace.page.getByText(LENS_NOTE)).toBeVisible({ timeout: ms(20_000) })
  await card.getByRole('button', { name: 'Like this post' }).click()
  await expect(card.getByRole('button', { name: 'Unlike this post' })).toBeVisible()
  await grace.page.goto('/commons/liked')
  await expect(grace.page.getByText(LENS_NOTE)).toBeVisible()
  // Not yet watched — a lens must not hold what THIS act never touched.
  await grace.page.goto('/commons/watched')
  await expect(grace.page.getByRole('heading', { name: 'Commons · Watched' })).toBeVisible({ timeout: ms(20_000) })
  await expect(grace.page.getByText(LENS_NOTE)).toHaveCount(0)

  await grace.page.goto('/commons')
  await expect(grace.page.getByText(LENS_NOTE)).toBeVisible({ timeout: ms(20_000) })
  await card.getByRole('button', { name: 'Watch' }).click()
  await expect(card.getByRole('button', { name: 'Watching' })).toBeVisible()
  await grace.page.goto('/commons/watched')
  await expect(grace.page.getByText(LENS_NOTE)).toBeVisible()

  // ── RECENTLY VIEWED fills by OPENING the subject, not by any button ───────
  await grace.page.goto('/commons/viewed')
  await expect(grace.page.getByRole('heading', { name: 'Commons · Recently viewed' })).toBeVisible()
  await expect(grace.page.getByText(LENS_NOTE)).toHaveCount(0)
  await grace.page.goto('/commons')
  await grace.page.getByRole('main').getByText(LENS_PROJECT).first().click()
  await expect(grace.page.getByRole('heading', { name: LENS_PROJECT })).toBeVisible()
  await grace.page.goto('/commons/viewed')
  await expect(grace.page.getByText(LENS_NOTE)).toBeVisible()

  await ada.context.close()
  await grace.context.close()
})

test('a world with NO social activity: the Commons teaches instead of going blank', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  // Rei Tanaka's is the sparsest seeded world — no grants, no threads. Three of the
  // six demo accounts land here, so this empty state is a first impression, not
  // an edge case.
  const rei = await newUser(browser, { 'x-tenant-id': 'tenant-reislab' })

  await rei.page.goto('/commons')
  // The FEED is empty, and says why + what to do about it. Since S8 the first
  // answer is the composer itself — an empty square whose primary act is right
  // there beats one that only explains how publishing works.
  await expect(rei.page.getByRole('textbox', { name: 'Say something' })).toBeVisible({ timeout: ms(20_000) })
  await expect(rei.page.getByText(/Nothing here yet/)).toBeVisible()
  // …but the page is not dead: the Browse band is a directory of what OTHER
  // workspaces opened, so a brand-new account has somewhere to go. That pairing
  // is the Discover consolidation's whole point (SOCIAL-8).
  await expect(rei.page.getByRole('main').getByRole('heading', { name: 'Browse the Commons' })).toBeVisible()
  // A directory card rendered — its contributor meta line ("Open to
  // contributors" at zero), since the card no longer carries an "Open project"
  // button (the card itself is the door, UI-17).
  await expect(rei.page.getByText(/\d+ contributors?|Open to contributors/).first()).toBeVisible()

  await rei.page.goto('/discussions')
  await expect(rei.page.getByText(/No discussions yet/)).toBeVisible({ timeout: ms(20_000) })

  await rei.context.close()
})

test('follow → the Following lens; message → one thread with two ends', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const NOTE_S7 = `Published for the follow lens ${STAMP}`
  const DM = `A direct question about the readout ${STAMP}`
  const DM_REPLY = `Answering from the other end ${STAMP}`
  const FOLLOW_PROJECT = `Follow walk ${STAMP}`
  const GRACE_NAME = 'Grace Hopper'

  // ── Ada publishes something Grace can see, so the lens has a payload ───────
  await ada.page.goto('/')
  await createProject(ada.page, FOLLOW_PROJECT)
  // Configuration sections open FOLDED (owner decision 2026-08-12), so the share
  // controls are one click behind their header now — exactly as a reader finds them.
  await openShareForm(ada.page)
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Share note (publishes when present)').fill(NOTE_S7)
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ada.page.getByText('tenant-beta · published')).toBeVisible()

  // ── Grace follows Ada from her PROFILE — the only page a person has ────────
  await grace.page.goto('/')
  await openAdaProfile(grace.page)
  // Scoped to `main`: the rail now carries a "Following" LENS row of its own,
  // so a page-wide locator matches two very different controls.
  const follow = grace.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true })
  const following = grace.page.getByRole('main').getByRole('button', { name: 'Following', exact: true })
  // Seed-independent: the demo world already has Grace following Ada, and an
  // e2e store PERSISTS, so asserting a starting state would pass only on a
  // clean run (the vacuous-precondition trap in tests/CLAUDE.md). Drive the
  // toggle to a known state, then flip it both ways — each flip renders from
  // the server's `youFollow`, so each IS a round-trip, not local state.
  await expect(follow.or(following)).toBeVisible({ timeout: ms(20_000) })
  if (await following.isVisible()) {
    await following.click()
    await expect(follow).toBeVisible()
  }
  await follow.click()
  await expect(following).toBeVisible()

  // The lens now holds Ada's post. (The seed already has Grace following Ada,
  // so this asserts the LENS filters to a followed actor — not that the click
  // alone created the relationship.)
  await gotoSection(grace.page, 'Commons')
  await grace.page.getByRole('navigation').getByRole('button', { name: 'Following', exact: true }).click()
  await expect(grace.page.getByText(NOTE_S7)).toBeVisible({ timeout: ms(20_000) })

  // ── The roster bands: the follow graph is WALKABLE, not a tooltip ─────────
  // Grace follows Ada, so Grace has a row on Ada's Followers band — and that
  // row is a door into her own profile. Only a browser can prove the door,
  // which is the whole reason the bands replaced a hover title.
  await openAdaProfile(grace.page)
  const followers = grace.page.getByRole('main').getByText('Followers', { exact: true })
  await expect(followers).toBeVisible({ timeout: ms(20_000) })
  const graceRow = grace.page.getByRole('main').getByRole('button', { name: `${GRACE_NAME} (you)`, exact: true })
  await expect(graceRow.first()).toBeVisible()
  // Her OWN row carries no follow control — you cannot follow yourself.
  await expect(grace.page.getByRole('main').getByText('Following', { exact: true }).first()).toBeVisible()
  await graceRow.first().click()
  await expect(grace.page.getByRole('heading', { name: `${GRACE_NAME} (you)` })).toBeVisible({ timeout: ms(20_000) })

  // ── Grace messages Ada from the same profile ──────────────────────────────
  await openAdaProfile(grace.page)
  const message = grace.page.getByRole('main').getByRole('button', { name: 'Message', exact: true })
  await expect(message).toBeVisible()
  await message.click()
  // A thread with Ada already exists in the seed, so Message is a DOOR — it
  // lands on the conversation rather than opening a composer.
  await expect(grace.page).toHaveURL(/\/discussions\//, { timeout: ms(20_000) })
  await grace.page.getByRole('textbox', { name: 'Reply to Ada Lovelace' }).fill(DM)
  await grace.page.getByRole('button', { name: 'Reply to Ada Lovelace', exact: true }).click()
  await expect(grace.page.getByText(DM)).toBeVisible()

  // The page is titled with the OTHER party, and wears no resolve control —
  // a conversation with a person has no settled state to declare.
  await expect(grace.page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible()
  await expect(grace.page.getByRole('button', { name: /Resolve/ })).toHaveCount(0)

  // ── Ada's end: her inbox names GRACE, not herself ─────────────────────────
  await gotoSection(ada.page, 'Messages')
  const row = ada.page.getByRole('button', { name: 'Grace Hopper', exact: true })
  await expect(row).toBeVisible({ timeout: ms(20_000) })
  // The anchor of this thread is 'Ada Lovelace' — Ada's OWN name. A surface that
  // labelled the row from the anchor would show her herself, which is the whole
  // reason `counterpart` is computed per viewer.
  await expect(ada.page.getByRole('button', { name: 'Ada Lovelace', exact: true })).toHaveCount(0)
  await row.click()
  await expect(ada.page.getByText(DM)).toBeVisible({ timeout: ms(20_000) })

  // And she can reply — being written to is standing to write back, even though
  // Grace's workspace publishes nothing Ada could have cold-opened to.
  await ada.page.getByRole('textbox', { name: 'Reply to Grace Hopper' }).fill(DM_REPLY)
  await ada.page.getByRole('button', { name: 'Reply to Grace Hopper', exact: true }).click()
  await expect(ada.page.getByText(DM_REPLY)).toBeVisible()

  // One conversation, two ends: Grace sees Ada's reply in the same thread.
  await grace.page.reload()
  await expect(grace.page.getByText(DM_REPLY)).toBeVisible({ timeout: ms(20_000) })

  await ada.context.close()
  await grace.context.close()
})

/** 8. IMPROVE an artifact (SOCIAL-7, `artifact-patch`): the third social
 *  primitive finally reaches a document's CONTENT. The walk proves the two
 *  doors are one write path — the owner rewrites a block in place, and a
 *  granted visitor (who gets NO pencil, because a read widened and ownership
 *  did not) offers the same kind of change as a proposal that the owner lands.
 *  Only a browser can lock this: the pencil's placement is decided by the
 *  contract's `docBlockText`, and the picker's options are the live body. */

test('the square: compose → the feed carries it → a mention doors → a stranger replies', async ({ browser }) => {
  test.setTimeout(ms(180_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  const SAID = `Shipped the body editor ${STAMP} — @Grace Hopper want to try it?`
  const REPLIED = `On it ${STAMP}`

  // ── Ada says something ────────────────────────────────────────────────────
  await ada.page.goto('/')
  await gotoSection(ada.page, 'Commons')
  await ada.page.getByRole('textbox', { name: 'Say something' }).fill(SAID)
  await ada.page.getByRole('button', { name: 'Post', exact: true }).click()
  const card = ada.page.getByRole('main').getByText(/Shipped the body editor/).first()
  await expect(card).toBeVisible({ timeout: ms(20_000) })
  // "posted", not "shared" — the verb says which act this was.
  await expect(ada.page.getByRole('main').getByText('posted').first()).toBeVisible()

  // The mention is a DOOR, resolved by the server against real names — and it
  // lands on that person's profile.
  const mention = ada.page.getByRole('button', { name: '@Grace Hopper', exact: true }).first()
  await expect(mention).toBeVisible()
  await mention.click()
  await expect(ada.page).toHaveURL(/\/u\/Grace(%20|\s)Hopper/, { timeout: ms(20_000) })

  // ── Grace: it is in HER square too (no grant, no follow — that is the wall) ─
  await grace.page.goto('/')
  await gotoSection(grace.page, 'Commons')
  await expect(grace.page.getByText(SAID)).toBeVisible({ timeout: ms(20_000) })
  // A post carries no resource embed: its words ARE the card. The seeded SHARE
  // card on the same feed does carry one, so this asserts a difference rather
  // than an absence that would hold vacuously.
  await expect(grace.page.getByRole('main').getByText('Insights dashboard').first()).toBeVisible()

  // She replies — anyone in the square may speak. Reply DISCLOSES the thread on
  // the card rather than navigating (owner directive 2026-08-08: the discussion
  // page renders the same thread, so the trip only cost her place in the feed),
  // and it works at zero replies, which is precisely when someone wants to
  // answer. The URL assertion is inverted on purpose: staying put IS the claim.
  const url = grace.page.url()
  const postCard = grace.page.getByRole('article').filter({ hasText: 'Shipped the body editor' })
  await postCard.getByRole('button', { name: /^Reply$/ }).click()
  await expect(grace.page).toHaveURL(url)
  // Opening the conversation lands the caret in that card's own composer, which
  // mounts WITH the disclosure — so plain autoFocus lands it, and a card at zero
  // replies is ready to be answered rather than merely willing.
  const box = grace.page.locator('textarea:focus')
  await expect(box).toBeVisible()
  await box.fill(REPLIED)
  // The ONE thread composer labels its box and its button identically (that is
  // how `AnchorThreadComposer` names itself), and a FEED needs those names to
  // differ per card — so the card names its own after the act it hangs under.
  await postCard.getByRole('button', { name: /^Comment on .+’s post$/ }).click()
  await expect(postCard.getByText(REPLIED)).toBeVisible({ timeout: ms(20_000) })

  // ── …and it comes back under Ada's card, one conversation, two projections ─
  // Her card rests closed too, and the count is what says the conversation
  // happened — the scent that lets a folded thread stay folded honestly.
  await gotoSection(ada.page, 'Commons')
  const ownCard = ada.page.getByRole('article').filter({ hasText: 'Shipped the body editor' })
  await expect(ownCard.getByRole('button', { name: /^Reply 1$/ })).toBeVisible({ timeout: ms(20_000) })
  await ownCard.getByRole('button', { name: /^Reply 1$/ }).click()
  await expect(ownCard.getByText(REPLIED)).toBeVisible()

  // A COMMENTER's name is a door too (owner directive 2026-08-08) — the same
  // profile the mention above reached, from the byline of a reply. Ada's own
  // byline on this card reads "Ada Lovelace (you)", so the exact name below can
  // only be the reply's author: the card's head and its body door alike.
  await ownCard.getByRole('button', { name: 'Grace Hopper', exact: true }).click()
  await expect(ada.page).toHaveURL(/\/u\/Grace(%20|\s)Hopper/, { timeout: ms(20_000) })

  // …and coming BACK finds the conversation as she left it (owner directive
  // 2026-08-08). The state has to outlive the page for this: the card unmounts
  // the moment the profile opens. Without it the byline door and the disclosure
  // undo each other — every trip out of a thread costs you the thread.
  await ada.page.goBack()
  await expect(ada.page).toHaveURL(/\/commons/, { timeout: ms(20_000) })
  await expect(ownCard.getByText(REPLIED)).toBeVisible({ timeout: ms(20_000) })
  // The caret does NOT follow, though: autofocus answers a click, and a restored
  // card would otherwise grab focus and scroll itself into view on arrival.
  await expect(ada.page.locator('textarea:focus')).toHaveCount(0)

  // ── The post's own page IS this card (owner report 2026-08-08) ─────────────
  // One component, so correspondence can't drift: the page carries the byline,
  // the words, Like and Watch, and the same replies. What it drops is the fold
  // (the page IS the conversation) and the door to itself.
  await ownCard.getByRole('button', { name: /^Open .+’s post on its own page$/ }).click()
  await expect(ada.page).toHaveURL(/\/discussions\//, { timeout: ms(20_000) })
  const pageCard = ada.page.getByRole('article').filter({ hasText: 'Shipped the body editor' })
  await expect(pageCard.getByText(REPLIED)).toBeVisible({ timeout: ms(20_000) })
  await expect(pageCard.getByRole('button', { name: /^(Like|Unlike) this post$/ })).toBeVisible()
  await expect(pageCard.getByRole('button', { name: /^Reply/ })).toHaveCount(0)
  // The words appear ONCE: titling the page with them was the duplication that
  // made the two views disagree.
  await expect(ada.page.getByRole('heading', { name: 'Post', exact: true })).toBeVisible()

  await ada.context.close()
  await grace.context.close()
})

/** ── S8: the mention picker — completing a name you could not type ───────────
 *  A mention rings only if the author reproduces a whole display name, and every
 *  name in this world has a space in it ("Beta Platform"), so the composer must
 *  offer them or the feature is reachable only by people who already know them.
 *
 *  What only a browser can prove, given `src/lib/mention-picker.test.ts` holds the
 *  pure logic: that the picker ARMS from a real caret in a real field, that
 *  Enter completes the name instead of dropping a newline into the middle of it,
 *  that it does not re-arm on the caret move the accept itself caused (a second
 *  Enter would insert the name twice), and that what it inserted is a name the
 *  SERVER then resolves — the round trip, not just the typing.
 *
 *  "Resolved" is asserted as an EXACT-text match: a resolved mention is its own
 *  element (`MentionText`), while an unresolved one is part of the surrounding
 *  text node — so exact-text matching is the DOM's own answer to "did the server
 *  agree", with no class-name coupling. */

test('the mention picker completes a multi-word name, and the server resolves what it inserted', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const MENTION_POST = `Roster question ${STAMP}`

  // The seeded thread on Ada's flagship project: Grace opened it, so her name is
  // a voice in this conversation and therefore offered. Ada's own is not — the
  // roster drops the caller from the server's `mine` stamps, since `@`-ing
  // yourself rings nobody.
  await ada.page.goto('/discussions/disc-seed-1')
  const field = ada.page.getByRole('textbox', { name: 'Reply to this discussion' })
  await expect(field).toBeVisible({ timeout: ms(20_000) })
  await field.click()
  await field.pressSequentially('thanks @Grace Ho')

  const picker = ada.page.getByRole('listbox', { name: 'Mention someone' })
  await expect(picker).toBeVisible({ timeout: ms(20_000) })
  // The option is NAMED by the name — its `@` is decorative, or the accessible
  // name would carry a spliced space ("@ Grace Hopper").
  await expect(picker.getByRole('option', { name: 'Grace Hopper', exact: true })).toBeVisible()
  await expect(picker.getByRole('option', { name: 'Ada Lovelace', exact: true })).toHaveCount(0)

  await field.press('Enter')
  await expect(field).toHaveValue(/thanks @Grace Hopper /)
  // The picker must CLOSE on accept. It did not, for two stacked reasons the
  // browser found and no node test could: the caret restore ran in a
  // `requestAnimationFrame` that could beat React's flush, so the `select` it
  // fires re-read the PRE-accept value and re-derived the query just completed.
  // An open picker owns Enter, so the writer's next Enter — a newline — would
  // have inserted the name a second time.
  await expect(picker).toHaveCount(0, { timeout: ms(10_000) })

  await field.pressSequentially(MENTION_POST)
  await ada.page.getByRole('button', { name: 'Reply to this discussion', exact: true }).click()

  // The round trip: the server resolved the inserted name, so it comes back as
  // its own element inside the post — the same answer that decided who was rung.
  const posted = ada.page.locator('p', { hasText: MENTION_POST })
  await expect(posted).toBeVisible({ timeout: ms(20_000) })
  await expect(posted.getByText('@Grace Hopper', { exact: true })).toBeVisible()

  // ── A CARET MOVE must never re-open the picker ────────────────────────────
  // On a fresh draft holding a FINISHED mention: clicking back inside the name
  // used to arm the picker, and an open picker owns Enter — so the writer's
  // next Enter, meant as a newline, spliced the name in a second time
  // ("@Grace Hopper for the review" → "@Grace Hopper Hopper for the review").
  // Arming belongs to typing; a caret move may only close.
  await field.fill('thanks @Grace Hopper for the review')
  await expect(picker).toHaveCount(0)
  await field.click({ position: { x: 62, y: 8 } }) // inside the completed name
  await expect(picker).toHaveCount(0)
  const beforeEnter = await field.inputValue()
  await field.press('Enter')
  const afterEnter = await field.inputValue()
  expect(afterEnter.length).toBe(beforeEnter.length + 1) // exactly one newline
  expect(afterEnter).toContain('\n')
  expect(afterEnter).not.toContain('Hopper Hopper')

  await ada.context.close()
})

/** ── S8: the picker on the SQUARE — where the copy teaches the feature ───────
 *  The reply composer got the picker first, and it is the one surface whose
 *  copy never mentioned `@`. The square's says "mention someone with @ to reach
 *  them" — and a post has no thread to draw voices from, so `threadVoices` is
 *  structurally empty at exactly the moment the placeholder gives the
 *  instruction. Its roster is the viewer's own two lists instead: who they
 *  FOLLOW, then the bylines in the feed in front of them.
 *
 *  A browser walk because all three halves are DOM: the roster comes from two
 *  live queries, the list PORTALS out of the composer (`document.body`), and
 *  what it inserted has to survive a POST and come back resolved by the server.
 *  Grace is the caller: the seeded follow graph is one-directional (Grace
 *  follows Ada, who publishes), which is the asymmetric shape a real one has. */

test('the square’s composer completes a name the viewer follows, and the post rings it', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const SQUARE_POST = `Saying this out loud ${STAMP}`

  await grace.page.goto('/commons')
  const field = grace.page.getByRole('textbox', { name: 'Say something' })
  await expect(field).toBeVisible({ timeout: ms(20_000) })
  await field.click()
  await field.pressSequentially('morning @Ada Lo')

  const picker = grace.page.getByRole('listbox', { name: 'Mention someone' })
  await expect(picker).toBeVisible({ timeout: ms(20_000) })
  await expect(picker.getByRole('option', { name: 'Ada Lovelace', exact: true })).toBeVisible()
  // The list escapes the composer entirely — it is portaled to the body, because
  // a composer is not always in an unclipped box (the work-item field sits
  // inside a `CardList`, whose ledger recipe carries `overflow-hidden`).
  expect(await picker.evaluate((el) => el.parentElement?.tagName)).toBe('BODY')
  // …and it is placed against the FIELD, not against wherever it was rendered.
  const listBox = await picker.boundingBox()
  const fieldBox = await field.boundingBox()
  assert.ok(listBox && fieldBox)
  expect(Math.abs(listBox.x - fieldBox.x)).toBeLessThan(2)
  expect(listBox.y).toBeGreaterThan(fieldBox.y)

  await field.press('Enter')
  await expect(field).toHaveValue(/morning @Ada Lovelace /)
  await expect(picker).toHaveCount(0, { timeout: ms(10_000) })

  await field.pressSequentially(SQUARE_POST)
  await grace.page.getByRole('button', { name: 'Post', exact: true }).first().click()

  // The round trip: the SERVER resolved the inserted name, so it comes back as
  // its own element — the same resolution that decided who was rung.
  const posted = grace.page.locator('p', { hasText: SQUARE_POST })
  await expect(posted).toBeVisible({ timeout: ms(20_000) })
  await expect(posted.getByText('@Ada Lovelace', { exact: true })).toBeVisible()

  await grace.context.close()
})
/** ── S2: the artifact BLOCK gutter — an artifact's interior, at last ─────────
 *  The last gap S2 left open. The locus was declared at S0 as a `{from,to}` LINE
 *  span and could never be minted: these bodies are structured, not linear, so
 *  the label would have described something the body does not have. S3 settled
 *  the address from the other side (`artifact-patch` edits by BLOCK), and this
 *  locus now speaks it — so a patch, a thread and the reader mean one thing by
 *  "block 3".
 *
 *  Locked here rather than in node because all three halves are DOM: the gutter
 *  is hover-revealed, the marker only exists once a thread does, and the chip's
 *  landing is a scroll. `src/lib/anchor-locus.test.ts` holds the pure resolver. */
