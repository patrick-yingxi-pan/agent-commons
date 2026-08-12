/** Social layer — anchors. Split out of the 1,611-line
 *  `social-layer.spec.ts`, which was 26% of the E2E suite in ONE file and so
 *  set a floor no sharding could beat (a lane is never shorter than its
 *  longest spec). The tests are unchanged and were already independent — no
 *  constant was shared between two of them. Shared setup lives in
 *  `./social-helpers.ts`; the walks themselves are documented there. */
import { test, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { ms } from './budget.ts'
import { RUN_POST, STAMP, TURN_POST, TURN_REPLY, TURN_SESSION, gotoSection, newUser } from './social-helpers.ts'
test('the turn gutter: a thread anchored to ONE turn, and the chip that lands back on it', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page

  // A SHORT viewport, deliberately: a conversation opens at the bottom, so the
  // earliest turn falls off-screen — which is what makes the final "landed on
  // the turn" assertion mean something instead of passing vacuously on a thread
  // that fits.
  // Short enough that the earliest turn is off-screen with MARGIN, not by a
  // pixel: a knife-edge height turns a real assertion into a flake the first
  // time any per-turn chrome changes size (it did — a 4px gutter trim).
  await page.setViewportSize({ width: 1100, height: 300 })
  await page.goto(TURN_SESSION)
  const turns = page.getByTitle('Discuss this turn')
  await expect(turns.first()).toBeAttached({ timeout: ms(20_000) })
  const count = await turns.count()
  expect(count, 'a multi-turn conversation to anchor into').toBeGreaterThan(1)

  // ── Mint: the gutter opens an inline composer on THAT turn ────────────────
  // The FIRST turn — the one the bottom landing scrolls past.
  const target = turns.first()
  await expect(target).not.toBeInViewport()
  await target.scrollIntoViewIfNeeded()
  await target.hover()
  await target.click()
  await page.getByRole('textbox', { name: 'Post to this turn’s discussion' }).fill(TURN_POST)
  await page.getByRole('button', { name: 'Post to this turn’s discussion' }).click()

  // The composer closes itself and the turn grows its marker — one thread.
  await expect(page.getByRole('textbox', { name: 'Post to this turn’s discussion' })).toHaveCount(0)
  const marker = page.getByTitle('Open this turn’s thread')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveText('1')

  // Clicking the gutter again must NOT fork a second thread (one public stream
  // per position — the server's get-or-create, proven through the UI).
  await target.hover()
  await page.getByTitle('Discuss this turn').first().click()
  await page.getByRole('textbox', { name: 'Post to this turn’s discussion' }).fill(TURN_REPLY)
  await page.getByRole('button', { name: 'Post to this turn’s discussion' }).click()
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveText('2')

  // ── Door: the marker opens the thread's own page, named by its POSITION ───
  await marker.click()
  // The thread titles itself from its first post, so the text is on the page
  // twice (heading + body) — assert the heading, the page's identity.
  await expect(page.getByRole('heading', { name: TURN_POST })).toBeVisible()
  // Selected on the chip's LABEL, not its tooltip prose: the label carrying the
  // locus phrase IS the contract (the phrase comes from the one registry), while
  // the tooltip is copy that may be reworded.
  const chip = page.getByRole('button', { name: /^session · .+ · one turn$/ })
  await expect(chip).toBeVisible()

  // ── Resolve: the chip lands the conversation ON that turn ─────────────────
  // The transient flash is unassertable (it fades), so this asserts the durable
  // half — the turn is scrolled into the viewport, which is what the locus is
  // for. Without the resolver the thread opens at the bottom and this fails.
  await chip.click()
  // Asserted on the TURN, not the marker inside it: a seeded message can be
  // taller than this deliberately-short viewport, so the marker at its foot may
  // sit below the fold even when the turn is squarely on screen. What the locus
  // promises is that the TURN is where you land.
  await expect(page.locator('[data-turn]').filter({ has: page.getByTitle('Open this turn’s thread') })).toBeInViewport({
    timeout: ms(10_000),
  })

  await ada.context.close()
})

test('the run gutter: the SAME gutter on a routine’s runs, landing back on one of them', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page

  // A routine's page lists its runs — a second surface with addressable
  // positions, served by the ONE gutter and the ONE resolver.
  await page.setViewportSize({ width: 1100, height: 400 })
  await page.goto('/scheduled/s-issue-triage')
  const gutters = page.getByTitle('Discuss this run')
  await expect(gutters.first()).toBeAttached({ timeout: ms(20_000) })
  expect(await gutters.count(), 'more than one run to choose between').toBeGreaterThan(1)

  // Not the first run — the landing must travel somewhere, and the run card
  // sits below the routine's other panels so a later row starts off-screen.
  const target = gutters.nth(1)
  await expect(target).not.toBeInViewport()
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await page.getByRole('textbox', { name: 'Post to this run’s discussion' }).fill(RUN_POST)
  await page.getByRole('button', { name: 'Post to this run’s discussion' }).click()

  const marker = page.getByTitle('Open this run’s thread')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveText('1')

  // The thread names its POSITION with the registry's phrase for this kind —
  // "one run", not the conversation's "one turn".
  await marker.click()
  const chip = page.getByRole('button', { name: /^schedule · .+ · one run$/ })
  await expect(chip).toBeVisible()

  // …and doors back onto that run, scrolled into view out of fifty rows.
  await chip.click()
  await expect(page.getByTitle('Open this run’s thread')).toBeInViewport({ timeout: ms(10_000) })

  await ada.context.close()
})

test('continue from a turn: the fork lands in the forker’s namespace, with provenance', async ({ browser }) => {
  test.setTimeout(ms(180_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  // Ada shares the conversation at `propose` — the tier the design names for
  // "continue from turn 12 in your namespace".
  await ada.page.goto(TURN_SESSION)
  await ada.page.getByRole('button', { name: 'Share this conversation' }).click()
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Tier').selectOption({ label: 'Propose' })
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()

  // Ada does NOT get the affordance on her own conversation — forking your own
  // thread is just scrolling up.
  await expect(ada.page.getByTitle('Continue from here')).toHaveCount(0)

  // Grace does, on every turn she can see.
  await grace.page.goto(TURN_SESSION)
  const continueHere = grace.page.getByTitle('Continue from here')
  await expect(continueHere.first()).toBeVisible({ timeout: ms(20_000) })

  // Taking the SECOND turn: the cut has to be at the named position, so a
  // first-turn fork would prove nothing about the locus.
  const turnsBefore = await grace.page.locator('[data-turn]').count()
  expect(turnsBefore).toBeGreaterThan(1)
  await continueHere.nth(1).click()

  // She lands in a NEW conversation that is hers, carrying only the turns up to
  // that point, and it says where it came from.
  await expect(grace.page).toHaveURL(/\/s\/sess-/, { timeout: ms(20_000) })
  await expect(grace.page.locator('[data-turn]')).toHaveCount(2)
  const forked = await grace.page.evaluate(async () => {
    const id = location.pathname.split('/s/')[1]
    return (await (await fetch(`/api/v1/sessions/${id}`)).json()) as { own?: boolean; forkedFrom?: { title: string } }
  })
  expect(forked.own).toBe(true)
  expect(forked.forkedFrom?.title).toBeTruthy()

  await ada.context.close()
  await grace.context.close()
})

/** ── S7: follow + direct messages ────────────────────────────────────────────
 *  The person layer's two acts, end to end and across tenants. What only a
 *  browser can prove here: that the DM's viewer-relative face is rendered from
 *  the SERVER's `counterpart` and not from the anchor — the two ends of one
 *  conversation must show each other's names, and a surface that read the
 *  anchor would show one of them their own. The node suite asserts the field;
 *  this asserts what a reader actually sees. */
/** Ada's profile, reached the way the product offers it — a byline door on a
 *  Commons card, not `page.goto('/u/Ada Lovelace')`. An in-page door is the
 *  truer walk: it proves the byline IS a door, which a deep link never does.
 *  (It was also once the only walk that worked — the seed namespace was named
 *  "Acme, Inc." then, and Vite's dev history fallback treats a dotted path as a
 *  FILE request, so that deep link never reached the SPA at all.) */
async function openAdaProfile(page: Page) {
  await gotoSection(page, 'Commons')
  await page.getByRole('button', { name: 'by Ada Lovelace', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible({ timeout: ms(20_000) })
}

test('a discussion hangs on ONE block of an artifact, and its chip lands back there', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const BLOCK_POST = `This bullet should name the flag ${STAMP}`

  // The flagship one-pager: a doc body, so its blocks are addressable.
  await ada.page.goto('/artifacts/a1')
  const openers = ada.page.getByTitle('Discuss this block')
  await expect(openers.first()).toBeAttached({ timeout: ms(20_000) })
  // Every block carries one — including the ones no `artifact-patch` may
  // rewrite. Patchability asks whether a one-line diff can express a change;
  // discussability only asks whether there is something to point at.
  expect(await openers.count()).toBeGreaterThan(1)

  await openers.first().click()
  await ada.page.getByRole('textbox', { name: 'Post to this block’s discussion' }).fill(BLOCK_POST)
  await ada.page.getByRole('button', { name: 'Post to this block’s discussion' }).click()

  // The marker exists only once a thread does — the surface pays nothing until
  // it is used.
  const marker = ada.page.getByTitle('Open this block’s thread')
  await expect(marker).toHaveCount(1, { timeout: ms(20_000) })

  // ── Door: the marker opens the thread's own page, named by its POSITION ────
  await marker.click()
  await expect(ada.page.getByRole('heading', { name: BLOCK_POST })).toBeVisible({ timeout: ms(20_000) })
  // On the chip's LABEL, not its tooltip: the label carrying the locus phrase IS
  // the contract (the phrase comes from the one registry). Before this slice the
  // chip fell through the kind→section map's missing `artifact` arm and rendered
  // as dead TEXT, so asserting a button is also asserting the door exists.
  const chip = ada.page.getByRole('button', { name: /^artifact · .+ · one block$/ })
  await expect(chip).toBeVisible()

  // ── Resolve: the chip lands the viewer ON that block ──────────────────────
  // The transient flash fades, so this asserts the durable half — the block is
  // in the viewport, which is what the locus is for.
  await chip.click()
  await expect(ada.page.getByTitle('Open this block’s thread')).toBeInViewport({ timeout: ms(10_000) })

  await ada.context.close()
})
// ── S9: replies — the chain renders UNDER what it answers, at any depth ──────
//  This walk used to assert the opposite of its middle section: the server
//  re-parented an answer-to-an-answer onto the root, and the DOM was checked
//  for a maximum nesting of one. The cap came out (owner directive 2026-08-11)
//  because it was recording a falsehood — a post answering Ada was stored as
//  answering Grace — and the two ends had to move together, which is why this
//  file changes alongside `server/routes/discussions.test.ts`.
//
//  `src/lib/reply-tree.test.ts` holds the arithmetic (orphans, rings, the indent
//  clamp) and `server/routes/discussions.test.ts` the write path. What only a browser
//  can prove is the structure: the composer opens in place, the answer lands
//  INSIDE its parent's row, a second answer goes DEEPER still, Ctrl+Enter posts
//  without touching the button, and the three folds behave — one post collapses
//  to a stub, "Fold all" turns the thread into an index, and "only this" keeps
//  the whole reading line (ancestor included) while everything else goes.

test('a reply chain nests, collapses to stubs, folds all, and posts on Ctrl+Enter', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const ANSWER = `Answering that directly ${STAMP}`
  const SECOND = `And answering the answer ${STAMP}`

  await ada.page.goto('/discussions/disc-seed-1')
  const parent = ada.page.locator('li', { hasText: 'Read through the Q3 baseline' }).first()
  await expect(parent).toBeVisible({ timeout: ms(20_000) })

  // The affordance names WHO is being answered, so a thread of several voices
  // does not offer half a dozen controls all called "Reply". It lives in the
  // post's act cluster, beside the endorsement and the retract — the same
  // hover-revealed cluster, because it is the same kind of thing (owner
  // directive 2026-08-11); the hover BUBBLE is what distinguishes it from the
  // word "Reply" the DM composer and the feed card also use.
  //
  // That used to be a `title` attribute and this used to assert the attribute
  // existed, which is a weaker claim than it reads as: an attribute is not an
  // explanation until something shows it. The cluster went to real Tooltips
  // when "only this" became a glyph nobody could guess (same directive), so the
  // whole row explains itself the same way, and this asserts the bubble ARRIVES.
  const replyBtn = parent.getByRole('button', { name: /^Reply to Grace Hopper.s post$/ }).first()
  await replyBtn.hover()
  await expect(ada.page.getByRole('tooltip')).toHaveText('Reply to this post')
  await replyBtn.click()
  const field = ada.page.getByRole('textbox', { name: 'Reply to this post' })
  await expect(field).toBeVisible({ timeout: ms(10_000) })
  // The field names its target in its shadow text, so "did I click the right
  // Reply" is answerable before a word is typed.
  await expect(field).toHaveAttribute('placeholder', '@Grace Hopper')
  await field.fill(ANSWER)
  await ada.page.getByRole('button', { name: 'Reply to this post', exact: true }).click()

  // THE structural assertion: the answer is inside its parent's row, not merely
  // somewhere on the page. A flat render would satisfy "is visible" and prove
  // nothing.
  //
  // Matched on the BODY paragraph rather than with `getByText`, which is the
  // trap this walk fell into: React mirrors a controlled `<textarea>`'s value
  // into its `defaultValue`, and a textarea's `defaultValue` IS its text
  // content — so `getByText(POST)` matches the still-open composer holding the
  // draft, and "the reply is visible" goes green before the reply exists. The
  // next assertion then races the write it never waited for.
  await expect(parent.locator('p', { hasText: ANSWER })).toHaveCount(1, { timeout: ms(20_000) })

  // Answering the ANSWER goes DEEPER — it is Ada's reply being answered, not
  // Grace's question, and the tree now says so. Posted with the KEYBOARD, which
  // is the only place that shortcut can be proven: the picker owns Enter while
  // it is open, so "Ctrl+Enter posts" is a claim about a delegation, not about a
  // key handler.
  const nested = ada.page.locator('li', { hasText: ANSWER }).last()
  await nested.getByRole('button', { name: /^Reply to .+.s post$/ }).first().click()
  const field2 = ada.page.getByRole('textbox', { name: 'Reply to this post' })
  await field2.fill(SECOND)
  await field2.press('Control+Enter')
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(1, { timeout: ms(20_000) })

  // …and the second answer sits inside the FIRST one's row, not beside it. This
  // is the claim the old cap inverted — it asserted a maximum nesting of one —
  // and it is stated as CONTAINMENT rather than by counting nodes, because the
  // count was both off by one (it measured ancestors) and silent about which
  // post had gone where. On a flat render the two answers are siblings and this
  // resolves to nothing.
  const answerRow = parent.locator('li').filter({ has: ada.page.locator('p', { hasText: ANSWER }) }).first()
  await expect(answerRow.locator('p', { hasText: SECOND })).toHaveCount(1)

  // The reader's escape hatch, which is what makes an unbounded depth safe to
  // store: fold Grace's question and BOTH answers go with it — the count
  // reports the whole branch, not its first row. Addressed as the FIRST fold in
  // her row rather than by its count, because the e2e store persists between
  // runs and a hardcoded "2 replies" would hold exactly once.
  const fold = parent.getByRole('button', { name: /repl(y|ies)$/ }).first()
  await expect(fold).toHaveAttribute('aria-expanded', 'true')
  await fold.click()
  await expect(parent.locator('p', { hasText: ANSWER })).toHaveCount(0)
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(0)
  // The post's OWN words go too (owner directive 2026-08-11) — this is the
  // claim that fails against the previous fold, which hid the replies and left
  // every body on screen. A thread of twenty top-level posts got no shorter,
  // which is not much of an answer to a long history.
  await expect(parent.locator('p')).toHaveCount(0)
  // What it leaves is an INDEX ENTRY, not a gap: the author, and how much is
  // underneath. A fold that left only a chevron would compress the thread into
  // a column of nothing.
  await expect(parent.getByText('Grace Hopper', { exact: true })).toBeVisible()
  await expect(parent.getByText(/^\d+ repl(y|ies)$/)).toBeVisible()
  // Folded, the control is still the way back, and still one element: React
  // keeps the node across the state change, so a keyboard reader who pressed it
  // is still standing on it.
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  await fold.click()
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(1)

  // A second, UNRELATED root, so the two thread-wide controls below have an
  // "everything else" to act on. The e2e store persists and this thread may
  // already carry several — this guarantees at least one post that is not on
  // Grace's line, whatever a previous run left behind.
  const ASIDE = `An unrelated remark ${STAMP}`
  const UNDER_A = `First answer to the aside ${STAMP}`
  const UNDER_B = `Second answer to the aside ${STAMP}`
  await ada.page.getByRole('textbox', { name: 'Reply to this discussion' }).fill(ASIDE)
  await ada.page.getByRole('button', { name: 'Reply to this discussion', exact: true }).click()
  await expect(ada.page.locator('p', { hasText: ASIDE })).toHaveCount(1, { timeout: ms(20_000) })

  // ── Fold all · Unfold all ─────────────────────────────────────────────────
  //  Two INDEPENDENT acts, not a toggle (owner directive 2026-08-11). The walk
  //  below is shaped entirely around the defect that forced the split: as one
  //  `allFolded` toggle, "Unfold all" existed only while the thread was
  //  completely folded, so opening a single stub to read it took the way out
  //  away. Every route into a partly-folded thread hit the same dead end.
  await fold.click()
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  // `exact` on both, and it is not decoration: Playwright matches an accessible
  // name by SUBSTRING, and "Unfold all" contains "Fold all" — so the loose
  // locator resolves to two elements the instant the pair is both on screen,
  // which is the state this whole section exists to reach. It cost a debugging
  // pass; the same trap waits for anyone naming a control X and its companion
  // "un-X".
  const foldAll = ada.page.getByRole('button', { name: 'Fold all', exact: true })
  const unfoldAll = ada.page.getByRole('button', { name: 'Unfold all', exact: true })
  await foldAll.click()
  for (const body of [ANSWER, SECOND, ASIDE]) {
    await expect(ada.page.locator('p', { hasText: body })).toHaveCount(0)
  }
  // A folded LEAF pins its caret visible, where an open one hover-reveals it:
  // an invisible way back is a post the reader cannot recover. Asserted on the
  // CLASS the reveal is spelled in, because Playwright clicks an `opacity-0`
  // control perfectly happily — a walk that merely presses it goes green on a
  // control nobody can see (this assertion was written after that exact
  // mutation survived).
  const asideRow = ada.page.locator('li').filter({ hasText: ASIDE }).first()
  await expect(asideRow.getByRole('button', { name: /’s post$/ }).first()).not.toHaveClass(/opacity-0/)

  // ── Fold all folds the ROOTS, and does not reach inside them ──────────────
  //  So the caret is invertible: open Grace's root and her whole branch is
  //  there, exactly as it was. Under the old model "Fold all" folded every post
  //  at every depth, and this same click gave you a stub whose answers were
  //  stubs too.
  await fold.click()
  await expect(parent.locator('p', { hasText: ANSWER })).toHaveCount(1)
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(1)
  await expect(ada.page.locator('p', { hasText: ASIDE })).toHaveCount(0, { timeout: ms(20_000) })

  // ── …and Unfold all survives the partly-folded state ──────────────────────
  //  The exact dead end the redesign fixes: one stub is open, the rest are not,
  //  and the way out is still on screen. It also still says "Fold all" — they
  //  are two acts, both live, because neither is the other's inverse.
  await expect(unfoldAll).toBeVisible()
  await expect(foldAll).toBeVisible()

  // ── The per-post UNFOLD ALL ───────────────────────────────────────────────
  //  Invertibility has a cost: the caret can restore an arrangement but never
  //  flatten one, so a branch folded by hand takes a click per stub to open.
  //  This is the discard, and it appears ONLY where it differs from the caret —
  //  on a folded post that really does have a folded descendant.
  const graceCaret = parent.getByRole('button', { name: /^Grace Hopper’s post, / }).first()
  const graceUnfoldAll = parent.getByRole('button', {
    name: 'Unfold Grace Hopper’s post and everything folded inside it',
  })
  // It STANDS on every folded post with replies, whether or not anything is
  // folded inside it (owner directive 2026-08-11). It used to render only where
  // it differed from the caret, which was principled and unfindable: the
  // obvious thing to try is Fold all, Fold all leaves interiors alone, so the
  // control was absent exactly there. Asserted with a clean interior, which is
  // the case the old gate refused.
  await graceCaret.click()
  await expect(graceUnfoldAll).toBeVisible()
  await graceCaret.click()
  // …and NOT on an OPEN post whose branch holds no fold: nothing to discard, so
  // the control would only repeat the caret. This is the complement of the rule
  // below — the gate is "is there a fold in this branch", and both halves of it
  // need an assertion or the widening turns into "always render".
  await expect(graceUnfoldAll).toHaveCount(0)
  // …and never on a post with no replies at all: there is no branch to discard,
  // and the caret already says everything there is to say.
  //  Located by TEXT rather than by `has: p`: folding replaces the body <p>
  //  with a stub, so a locator keyed on the paragraph stops resolving the
  //  instant the thing it is testing happens. The stub still carries the words
  //  as its snippet, so `hasText` survives both states.
  const leafRow = parent.locator('li').filter({ hasText: SECOND }).last()
  await leafRow.getByRole('button', { name: /’s post$/ }).first().click()
  await expect(leafRow.getByRole('button', { name: /^Unfold .* everything folded inside it$/ })).toHaveCount(0)
  await leafRow.getByRole('button', { name: /’s post$/ }).first().click()
  // `answerRow` is the containment locator already built above — by CONTAINMENT
  // rather than author name, since every post this walk writes is Ada's. Its
  // FIRST caret is ANSWER's own, not a descendant's.
  await answerRow.getByRole('button', { name: /’s post, / }).first().click() // fold ANSWER, which holds SECOND
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(0)
  // ── It appears HERE, while Grace is still open ────────────────────────────
  //  (owner directive 2026-08-12: *"the unfold all button should also be usable
  //  when the corresponding fold/unfold button is in unfolded state, since the
  //  user may want to unfold all sub-levels beneath it"*.) This is the state the
  //  old `hidden` gate refused, and it is the one where the caret is no help at
  //  all: pressing Grace's caret folds her, and unfolding restores the same
  //  buried stub. The only way to flatten this branch was the thread-wide
  //  Unfold all, which discards every OTHER branch's arrangement to do it.
  await expect(graceUnfoldAll).toBeVisible()
  await expect(graceCaret).toHaveAttribute('aria-expanded', 'true')
  await graceCaret.click() // and it survives folding her root over the top of it
  await expect(graceUnfoldAll).toBeVisible()

  // ── …and it costs the row NOTHING ─────────────────────────────────────────
  //  The control appears on some folded posts and not others, so an in-flow
  //  spelling of it moves the words beside it. Two cuts got this wrong in
  //  opposite directions, and the assertion below is written to fail against
  //  BOTH — which the first version was not:
  //
  //    no slot        → stubs at two x's depending on what is folded inside
  //                     them (341 and 373, one above the other)
  //    reserved slot  → every stub aligned with the others but 32px right of
  //                     the OPEN rows (357 → 389), i.e. "folding indents"
  //
  //  The first lock compared stubs only to stubs, so it went green on the
  //  second bug — the one an owner then reported. Comparing folded to OPEN is
  //  the claim that actually matters: a root's author lands in one column
  //  whatever state the row is in. Pixels, not classes: the class is precisely
  //  what I got wrong, twice.
  //  Scoped to the ROOT list and its DIRECT children. A nested `ul` carries
  //  `space-y-3` too, so the unscoped selector swept up depth-1 and depth-2
  //  rows and reported their indent as disagreement — three x's for what is
  //  actually one correct column plus two correct indents.
  const rootList = ada.page.locator('ul.space-y-3').first()
  const rootAuthorX = (sel: string) =>
    rootList.locator(sel).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  const stubX = await rootAuthorX('> li > div > div.cursor-pointer > span.font-medium')
  expect(stubX.length, 'more than one root is folded, so the stubs can disagree').toBeGreaterThan(1)
  await unfoldAll.click()
  const openX = await rootAuthorX('> li > div > div.min-w-0 > div > span.font-medium')
  expect(
    new Set([...stubX, ...openX]).size,
    `a root's author sits in ONE column, folded or open — stubs ${stubX.join(', ')} vs open ${openX.join(', ')}`,
  ).toBe(1)
  // Rebuild the state the discard needs, from the fully-open thread the
  // measurement above left behind. Order matters: fold the NESTED post first,
  // while it is still on screen — folding the root first would hide the row
  // whose caret this needs.
  await answerRow.getByRole('button', { name: /’s post, / }).first().click()
  await graceCaret.click()
  await graceUnfoldAll.click()
  // One click, the whole branch — including the post folded two levels down.
  await expect(parent.locator('p', { hasText: ANSWER })).toHaveCount(1)
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(1)
  // …and it is GONE now, because there is nothing left in this branch to
  // discard: a control that would repeat the caret does not render.
  await expect(graceUnfoldAll).toHaveCount(0)

  // ── …and each discard is its own caret's SHADOW ───────────────────────────
  //  (owner directive 2026-08-11, moved onto the other axis 2026-08-12: *"…
  //  immediately below the corresponding fold/unfold button and vertically
  //  aligned with it, instead of being left to it and horizontally aligned"*.)
  //  A sibling a fixed distance BELOW the caret, in the caret's own column,
  //  with that distance IDENTICAL at every depth. The control follows the
  //  toggle it modifies; it has no position of its own.
  //
  //  Measured as a RELATION — gap to its own caret, and shared centre column —
  //  never as an absolute x. An absolute-x assertion is what encoded the third
  //  wrong reading of this rule (one column down the page), and it passed
  //  happily while the gap grew by a level of indent every step down the tree.
  //
  //  Two depths are needed, and they must be in DIFFERENT branches: a folded
  //  post hides its own descendants, so a folded root and a folded reply
  //  underneath it are never on screen together. Grace's branch is the only one
  //  with replies at this point, so the other seeded root is given one.
  const COLUMN = `A reply so this root has a branch ${STAMP}`
  const otherRoot = ada.page.locator('li').filter({ hasText: 'Fixed at 28 days' }).last()
  await otherRoot.getByRole('button', { name: /^Reply to .+’s post$/ }).first().click()
  const cf = ada.page.getByRole('textbox', { name: 'Reply to this post' })
  await cf.fill(COLUMN)
  await cf.press('Control+Enter')
  await expect(otherRoot.locator('p', { hasText: COLUMN })).toHaveCount(1, { timeout: ms(20_000) })
  // Grace stays OPEN so her folded reply's control is on screen, while the
  // other root folds and contributes the depth-0 one.
  await otherRoot.getByRole('button', { name: /’s post, / }).first().click()
  await answerRow.getByRole('button', { name: /’s post, / }).first().click()
  const pairs = await ada.page
    .locator('button[aria-label^="Unfold "][aria-label$="everything folded inside it"]')
    .evaluateAll((els) =>
      els.map((e) => {
        const d = e.getBoundingClientRect()
        // Its caret is the other button in the gutter it is absolutely
        // positioned against — the element it is a shadow OF. Reached by
        // `closest('div')`, not `parentElement`: the Tooltip wraps each control
        // in a span of its own, so the parent is that span and not the gutter.
        const caret = (e.closest('div') as HTMLElement).querySelector('button:not([aria-label^="Unfold "])')
        const c = (caret as HTMLElement).getBoundingClientRect()
        return {
          gap: Math.round(d.top - c.bottom),
          dx: Math.round(d.left + d.width / 2 - (c.left + c.width / 2)),
          x: Math.round(d.left),
        }
      }),
    )
  expect(pairs.length, 'controls at more than one depth are on screen').toBeGreaterThan(1)
  // Each control sits in its OWN caret's column — it follows that caret's
  // indent rather than lining up down the page. Half of "shadow", and the half
  // a one-column implementation fails.
  //
  //  Stated per-pair (`dx`) rather than as "every x is distinct", which is what
  //  it used to say and could no longer be true: the control now also stands on
  //  an OPEN post holding a folded one, so this very measurement has two
  //  controls at depth 0 on screen — Grace's and the other root's — and a
  //  distinct-x assertion would fail on correct layout. `dx` is the claim that
  //  was actually meant, and it is the stronger one: it names each control's own
  //  caret instead of inferring the relation from a set of numbers.
  for (const p of pairs) {
    expect(Math.abs(p.dx), `each shadow is in its own caret's column (off by ${p.dx}px)`).toBeLessThanOrEqual(1)
  }
  // …and the column is not vacuously shared because everything is at one depth.
  expect(
    new Set(pairs.map((p) => p.x)).size,
    `more than one depth is represented — x ${pairs.map((p) => p.x).join(', ')}`,
  ).toBeGreaterThan(1)
  expect(
    new Set(pairs.map((p) => p.gap)).size,
    `every discard sits the same distance below its own caret — gaps ${pairs.map((p) => p.gap).join(', ')}`,
  ).toBe(1)
  // Within a pixel, not exactly zero. `devices['Desktop Chrome']` pins
  // deviceScaleFactor to 1, where this is 0 — but the same code measured 0.67px
  // off at DPR 1.5 (centres 467.67 vs 467.00) on the horizontal axis this
  // assertion used to run on, because an abspos box's static position lands on a
  // fractional device pixel. That is sub-pixel snapping, not a layout error; the
  // defect this guards was 4px. An exact-zero assertion here would fail the day
  // anyone adds a fractional-DPR project and would blame the wrong thing.
  //
  //  The gap is expected to be 0 (`top-full` abuts the gutter's box exactly),
  //  and it is asserted as CONSTANT rather than as zero: zero is this cut's
  //  choice of spacing, while "the same at every depth" is the rule.
  await unfoldAll.click()

  // Nothing is folded anywhere now, so "Unfold all" has no work and correctly
  // does not render — the other half of the pair's appearance rule, asserted
  // here because this is the one place the walk reaches an empty fold set
  // without having pressed it.
  await expect(unfoldAll).toHaveCount(0)
  await expect(ada.page.locator('p', { hasText: ASIDE })).toHaveCount(1)

  // ── The acts sit ON the byline, not at the pane's right edge ──────────────
  //  (owner directive 2026-08-11: "make the reply, like and delete buttons
  //  immediately follow the line content instead of right aligned. This makes
  //  user clicks convenient.") Stated as a MEASUREMENT, because the structural
  //  version — "the buttons are inside the byline element" — would also pass on
  //  a byline stretched the full width of the pane with the buttons still
  //  pinned to its far end, which is the arrangement being replaced.
  const byline = parent.locator('div.min-w-0 > div').first()
  const bylineBox = await byline.boundingBox()
  const replyBox = await parent.getByRole('button', { name: /^Reply to Grace Hopper’s post$/ }).first().boundingBox()
  const rowBox = await parent.boundingBox()
  if (!bylineBox || !replyBox || !rowBox) throw new Error('byline / reply / row not laid out')
  // Reply begins within a short distance of where the byline text ends, rather
  // than out at the row's edge. The row is ~900px wide here; the old layout put
  // this button past 1000.
  expect(replyBox.x - bylineBox.x).toBeLessThan(400)
  expect(rowBox.x + rowBox.width - replyBox.x).toBeGreaterThan(300)
  // ── The ENDORSEMENT leads the cluster ────────────────────────────────────
  //  (owner report 2026-08-12: *"a clicked like button is displayed immediately
  //  after the line's text without long whitespaces"*.) It is the one act that
  //  survives the mouse leaving — with a count on it, it drops HOVER_REVEAL —
  //  and `HOVER_REVEAL` is `opacity-0`, not `hidden`, so the invisible acts in
  //  front of it kept their boxes. Ordered third it therefore sat ~52px clear
  //  of the byline it belongs to, and the size of that gap depended on how many
  //  hidden controls the post happened to have.
  //
  //  Measured against the TIMESTAMP, not asserted as DOM order: "the endorse
  //  button is the first child" would also pass with a 52px margin on it, which
  //  is the defect. The 8px is the byline's own `gap-x-2`.
  const acts = await byline
    .locator('> div')
    .first()
    .getByRole('button')
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { name: e.getAttribute('aria-label') ?? '', left: r.left, right: r.right }
      }),
    )
  expect(acts.length, 'the byline carries a cluster of acts').toBeGreaterThan(2)
  expect(acts[0].name, `the endorsement leads — got ${acts.map((a) => a.name).join(' | ')}`).toMatch(/endorse/i)
  const timeBox = await byline.locator('> span').last().boundingBox()
  if (!timeBox) throw new Error('timestamp not laid out')
  expect(
    Math.round(acts[0].left - (timeBox.x + timeBox.width)),
    'the endorsement starts one byline gap after the timestamp, not behind a run of invisible boxes',
  ).toBeLessThan(12)

  // …and the trash stands apart from the acts it sits beside, so the click that
  // meant "endorse" cannot land on "delete" (same directive). Stated over the
  // ADJACENT gaps rather than endorse→trash: the endorsement moved to the front
  // of the cluster, and the old spelling measured across the two controls now
  // between them — which made the assertion pass for the wrong reason (a
  // negative "reply gap") instead of failing.
  const gaps = acts.slice(1).map((a, i) => Math.round(a.left - acts[i].right))
  const trashAt = acts.findIndex((a) => /^(Delete|Retract) this post$/.test(a.name))
  expect(trashAt, 'the retract is in this cluster and is not the first thing in it').toBeGreaterThan(0)
  const others = gaps.filter((_, i) => i !== trashAt - 1)
  expect(others.length, 'there are ordinary gaps to compare the retract’s against').toBeGreaterThan(0)
  expect(gaps[trashAt - 1], `retract gap ${gaps[trashAt - 1]} vs ordinary ${others.join(', ')}`).toBeGreaterThan(
    Math.max(...others) + 8,
  )

  // ── "only this" is a glyph that explains itself ───────────────────────────
  //  (owner directive 2026-08-11: "invent an icon for the only this button,
  //  possibly with hover message to explain".) An icon-only control whose
  //  meaning nobody would guess owes the reader the words on hover — and the
  //  bubble is a real Tooltip, not the browser's `title`, so this can assert it
  //  arrived rather than that an attribute exists.
  const onlyThis = parent.getByRole('button', { name: /^Fold every post but/ }).first()
  await expect(onlyThis).toHaveText('')
  await onlyThis.hover()
  await expect(ada.page.getByRole('tooltip')).toHaveText('Fold everything else')

  // ── The trash ASKS ────────────────────────────────────────────────────────
  //  (owner directive 2026-08-11: "confirm deletion in a pop-up window".) The
  //  walk that earned it: a mis-aimed click retracted a seeded post and the
  //  thread lost its opening question, recoverable only by hand-editing the
  //  store. Cancel is asserted FIRST — a confirm dialog whose Cancel does not
  //  cancel is worse than no dialog, and only the destroy path gets exercised
  //  if you test them the other way round.
  await parent.getByRole('button', { name: /^(Delete|Retract) this post$/ }).first().click()
  const dialog = ada.page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // It names whose words go and what happens to the answers underneath — the
  // fact most likely to change the reader's mind, and true of the server's
  // actual retract rule.
  await expect(dialog).toContainText('Grace Hopper')
  await expect(dialog).toContainText('move up one level')
  // Focus is on Cancel, never pre-armed on the destructive verb: the dialog
  // exists because a pointer went where it did not mean to, and a stray Enter
  // would reproduce that one layer up.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  // A widening is never INHERITED. Tick the cascade, cancel, reopen — and it is
  // off again. The choice lives above the dialog (it has to survive the
  // dialog's own re-render), so "unchecked on arrival" is a reset somebody has
  // to have written, not a property of mounting; setting the initial state
  // `false` proves nothing, because the reset is what actually clears it.
  await dialog.getByRole('checkbox').click()
  await expect(dialog.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await parent.getByRole('button', { name: /^(Delete|Retract) this post$/ }).first().click()
  await expect(dialog.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(parent.locator('p', { hasText: 'Read through the Q3 baseline' })).toHaveCount(1)
  // Escape cancels too — dismissal must be the cheap direction.
  await parent.getByRole('button', { name: /^(Delete|Retract) this post$/ }).first().click()
  await expect(dialog).toBeVisible()
  await ada.page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(parent.locator('p', { hasText: 'Read through the Q3 baseline' })).toHaveCount(1)
  // ── The draft neither thread-wide control may eat ── open a composer on a
  // NESTED post and fold everything. The composing post is spared, and so is
  // every post ABOVE it, which is the half that fails silently: sparing only
  // the post leaves its parent free to fold, a folded parent renders none of
  // its children, and the half-written reply is gone with the guard still
  // reading as though it worked (found in review of this change).
  await answerRow.getByRole('button', { name: /^Reply to .+’s post$/ }).first().click()
  const guarded = ada.page.getByRole('textbox', { name: 'Reply to this post' })
  await guarded.fill(`Half-written ${STAMP}`)
  await ada.page.getByRole('button', { name: 'Fold all', exact: true }).click()
  await expect(guarded).toBeVisible()
  await expect(guarded).toHaveValue(`Half-written ${STAMP}`)
  // The rest of the thread did fold around it — the guard is narrow, not a
  // blanket veto on the act.
  await expect(ada.page.locator('p', { hasText: ASIDE })).toHaveCount(0)
  await ada.page.getByRole('button', { name: 'Unfold all', exact: true }).click()
  // Folding it YOURSELF is a different act and CLOSES the composer rather than
  // hiding it — including from an ancestor, which conceals it just as
  // completely (Grace's caret is that ancestor). The claim is about the state,
  // not the render, so it has to be asserted after UNFOLDING: while the
  // ancestor is folded nothing below it renders either way, so "the composer is
  // gone" goes green on a composer that is merely out of sight and will spring
  // back — which is exactly what the first version of this assertion did.
  await fold.click()
  await fold.click()
  await expect(ada.page.getByRole('textbox', { name: 'Reply to this post' })).toHaveCount(0)

  // ── Fold the others ── a thread-wide act reached from ONE post. Fired from
  // Ada's answer, which is deliberately not a root: the reading line has to
  // include the ANCESTOR, and an implementation that folds "everything but this
  // post" passes every other assertion here while hiding the post it was asked
  // to show — Grace's row would collapse and take the answer down inside it.
  await answerRow.getByRole('button', { name: /^Fold every post but/ }).first().click()
  await expect(ada.page.locator('p', { hasText: ASIDE })).toHaveCount(0)
  await expect(parent.locator('p', { hasText: 'Read through the Q3 baseline' })).toHaveCount(1)
  await expect(parent.locator('p', { hasText: ANSWER })).toHaveCount(1)
  // …and the branch UNDER it, entire — soloing a post shows the sub-argument,
  // not its opening line.
  await expect(parent.locator('p', { hasText: SECOND })).toHaveCount(1)

  // ── …and confirming really does destroy ───────────────────────────────────
  //  LAST in the walk, and on the ASIDE post this walk created rather than on
  //  anything seeded. Both placements are deliberate: two assertions above read
  //  "ASIDE is folded away", and a post that has been DELETED satisfies those
  //  vacuously — destroying it earlier would quietly hollow them out (it did,
  //  for one revision). Its own caret unfolds it first, because a stub carries
  //  no acts — and NOT "Unfold all", which does not exist here: "only this"
  //  leaves the reading line open, so the thread is partly folded and the
  //  toggle still reads "Fold all" (the `allFolded` rule, working).
  //  Matched WITHOUT a reply count: this post is still a leaf here, so its
  //  caret is named "‹author›'s post" flat. (The branch control, which does
  //  carry a count-free name of its own, reads "…and everything under it" and
  //  cannot collide.)
  await asideRow.getByRole('button', { name: /’s post$/ }).first().click()

  // ── …and the CASCADE option ───────────────────────────────────────────────
  //  (owner directive 2026-08-11: "add an option to delete all entries
  //  underneath the current comment in the confirmation".) Exercised on a
  //  branch this walk BUILDS — two answers under its own throwaway root — so
  //  nothing seeded is destroyed and no later spec inherits a hollowed thread.
  for (const body of [UNDER_A, UNDER_B]) {
    await asideRow.getByRole('button', { name: /^Reply to .+’s post$/ }).first().click()
    const f = ada.page.getByRole('textbox', { name: 'Reply to this post' })
    await f.fill(body)
    await f.press('Control+Enter')
    await expect(asideRow.locator('p', { hasText: body })).toHaveCount(1, { timeout: ms(20_000) })
  }
  await asideRow.getByRole('button', { name: /^(Delete|Retract) this post$/ }).first().click()
  const cascadeDlg = ada.page.getByRole('dialog')
  const cascadeBox = cascadeDlg.getByRole('checkbox')
  // Unchecked on arrival, and the button names the NARROW act: a widening this
  // destructive is never the default and never inherited from last time.
  await expect(cascadeBox).toHaveAttribute('aria-checked', 'false')
  await expect(cascadeDlg.getByRole('button', { name: /^(Delete|Retract)$/ })).toBeVisible()
  await expect(cascadeDlg).toContainText('2 replies underneath')
  // Checking it re-words the button to COUNT what it will take — the last thing
  // read before the last click should not say "Retract" for three posts.
  await cascadeBox.click()
  await expect(cascadeBox).toHaveAttribute('aria-checked', 'true')
  await cascadeDlg.getByRole('button', { name: /^(Delete|Retract) 3 posts$/ }).click()
  for (const gone of [ASIDE, UNDER_A, UNDER_B]) {
    await expect(ada.page.locator('p', { hasText: gone })).toHaveCount(0, { timeout: ms(20_000) })
  }
  // The branch went as a BRANCH: nothing was promoted to top level in its place,
  // which is what a narrow delete would have left behind.
  await expect(parent.locator('p', { hasText: 'Read through the Q3 baseline' })).toHaveCount(1)

  await ada.context.close()
})