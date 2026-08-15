/** Social layer — sharing. Split out of the 1,611-line
 *  `social-layer.spec.ts`, which was 26% of the E2E suite in ONE file and so
 *  set a floor no sharding could beat (a lane is never shorter than its
 *  longest spec). The tests are unchanged and were already independent — no
 *  constant was shared between two of them. Shared setup lives in
 *  `./social-helpers.ts`; the walks themselves are documented there. */
import { test, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { ms } from './budget.ts'
import { API, ARTIFACT, CHANGE, COMMENT, GUEST_POST, LINK_PROJECT, NEW_CADENCE, NOTE, PROJECT, ROUTINE, ROUTINE_CHANGE, STAMP, TURN_SESSION, createProject, gotoSection, newUser, openProject, projectId, openSection, openShareForm } from './social-helpers.ts'
test('share → feed → discuss → improve: one thread, one ledger, across two tenants', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser) // seeded default: user-ada / tenant-acme (owner)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // ── Ada publishes: a grant with a note through the Sharing rail ────────────
  await ada.page.goto('/')
  await createProject(ada.page, PROJECT)
  // Configuration sections open FOLDED (owner decision 2026-08-12), so the share
  // controls are one click behind their header now — exactly as a reader finds them.
  await openShareForm(ada.page)
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Tier').selectOption({ label: 'Propose' })
  await ada.page.getByLabel('Share note (publishes when present)').fill(NOTE)
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ada.page.getByText('tenant-beta · published')).toBeVisible()

  // ── Grace's Commons feed carries the card; its title is the door ──────────
  await grace.page.goto('/')
  await gotoSection(grace.page, 'Commons')
  await expect(grace.page.getByText(NOTE)).toBeVisible()
  await grace.page.getByRole('main').getByText(PROJECT).first().click()
  await expect(grace.page.getByRole('heading', { name: PROJECT })).toBeVisible()
  // The visitor page: no owner rail (the Sharing config never renders for a guest).
  await expect(grace.page.getByLabel('Audience kind')).toHaveCount(0)

  // ── Grace comments on the entity page — the same root thread the card shows ──
  // The composer is disclosed by the section's header verb (UI-18), like the
  // "Offer a change" flow just below — no standing form on an entity page.
  await grace.page.getByRole('button', { name: /^(Start the discussion|Reply to this discussion)$/ }).click()
  await grace.page.getByRole('textbox', { name: 'Post to this project’s discussion' }).fill(COMMENT)
  await grace.page.getByRole('button', { name: 'Post to this project’s discussion' }).click()
  await expect(grace.page.getByText(COMMENT)).toBeVisible()

  // ── Grace offers a change (propose tier); the consent buttons are the OWNER's ──
  await grace.page.getByRole('button', { name: 'Offer a change — the owner lands it by consent' }).click()
  await grace.page.getByLabel('The change you propose').fill(CHANGE)
  await grace.page.getByLabel('Why this change').fill('Retention questions dominate the reviews.')
  await grace.page.getByRole('button', { name: 'Offer', exact: true }).click()
  await expect(grace.page.getByText(CHANGE)).toBeVisible()
  await expect(grace.page.getByRole('button', { name: 'Land', exact: true })).toHaveCount(0)

  // ── One conversation, two projections: the comment rides Grace's feed card too ──
  // The card rests with its thread folded (owner directive 2026-08-08), so the
  // claim is now sharper than "the text is somewhere on the page": THIS card's
  // Reply carries the count, and opening it in place shows the same words she
  // wrote on the entity page.
  await gotoSection(grace.page, 'Commons')
  const shareCard = grace.page.getByRole('article').filter({ hasText: NOTE })
  await expect(shareCard.getByRole('button', { name: /^Reply 1$/ })).toBeVisible({ timeout: ms(20_000) })
  await shareCard.getByRole('button', { name: /^Reply 1$/ }).click()
  await expect(shareCard.getByText(COMMENT)).toBeVisible()

  // ── Ada sees both on the ONE canonical page, and lands the change as L1 ────
  await ada.page.reload()
  await openProject(ada.page, PROJECT)
  await expect(ada.page.getByText(COMMENT)).toBeVisible()
  await expect(ada.page.getByText(CHANGE)).toBeVisible()
  await ada.page.getByRole('button', { name: 'Land', exact: true }).click()
  // The merged Changes panel (the one-ledger consolidation): the row flips from
  // the offered pulse to the shared ledger's L1.
  await expect(ada.page.getByText('L1', { exact: true })).toBeVisible()

  await ada.context.close()
  await grace.context.close()
})

test('the share link: a signed-in third tenant opens /shared/:token and lands on the subject', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })

  // ── Ada mints the link grant (the server mints the token) ─────────────────
  await ada.page.goto('/')
  await createProject(ada.page, LINK_PROJECT)
  // Configuration sections open FOLDED (owner decision 2026-08-12), so the share
  // controls are one click behind their header now — exactly as a reader finds them.
  await openShareForm(ada.page)
  await ada.page.getByLabel('Audience kind').selectOption({ label: 'Link' })
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ada.page.getByText('anyone with the link')).toBeVisible()
  await expect(ada.page.getByRole('button', { name: 'Copy the share link' })).toBeVisible()

  // The token, through the owner's own grants read (the roster face carries it
  // for the owner; the redemption roster never crosses the wire).
  const pid = await projectId(ada.page, LINK_PROJECT)
  const roster = (await (await ada.page.request.get(`${API}/grants?kind=project&id=${pid}`)).json()) as {
    audience: { kind: string; token?: string }
  }[]
  const link = roster.find((g) => g.audience.kind === 'link')
  expect(link?.audience.token, 'the owner sees the minted token').toBeTruthy()

  // ── Maya starts walled… ───────────────────────────────────────────────────
  await maya.page.goto('/')
  await gotoSection(maya.page, 'Projects')
  await expect(maya.page.getByText(LINK_PROJECT)).toHaveCount(0)

  // ── …and the link is the door: /shared/:token redeems and lands on the page ──
  await maya.page.goto(`/shared/${link!.audience.token}`)
  await expect(maya.page.getByRole('heading', { name: LINK_PROJECT })).toBeVisible({ timeout: ms(20_000) })

  await ada.context.close()
  await maya.context.close()
})

test('sharing a CONVERSATION: the owner shares from its title bar, the audience discusses a turn', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // ── The share door is CHROME on the conversation, gated on ownership ──────
  await ada.page.goto(TURN_SESSION)
  await ada.page.getByRole('button', { name: 'Share this conversation' }).click()
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Tier').selectOption({ label: 'Comment' })
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ada.page.getByText('tenant-beta')).toBeVisible()

  // ── Grace was walled; the grant opens the READ ────────────────────────────
  await grace.page.goto(TURN_SESSION)
  const graceTurns = grace.page.getByTitle('Discuss this turn')
  await expect(graceTurns.first()).toBeAttached({ timeout: ms(20_000) })

  // …but NOT ownership: a shared conversation carries no share door, at any
  // tier. Reads widen, the audience configuration stays the owner's.
  await expect(grace.page.getByRole('button', { name: 'Share this conversation' })).toHaveCount(0)

  // ── And the point of the whole slice: she can discuss ONE turn of it ──────
  const target = graceTurns.first()
  await target.scrollIntoViewIfNeeded()
  await target.click()
  await grace.page.getByRole('textbox', { name: 'Post to this turn’s discussion' }).fill(GUEST_POST)
  await grace.page.getByRole('button', { name: 'Post to this turn’s discussion' }).click()
  const guestMarker = grace.page.getByTitle('Open this turn’s thread').first()
  await expect(guestMarker).toBeVisible()

  // ── The owner is TOLD (social.discussed) ───────────────────────────────
  // Without the bell the share → discuss loop is one-way: a comment is the one
  // social act whose subject nobody would otherwise be told about. The row is a
  // DOOR onto the THREAD's own page — the deepest door of any social kind,
  // because that is where the post actually is.
  await ada.page.reload()
  // Park her on a NAMED page first: the bell's back-push is only observable
  // against a known origin, and "wherever the walk happened to leave her" would
  // make the assertion below a coin flip.
  await gotoSection(ada.page, 'Commons')
  await ada.page.getByTestId('notification-bell').click()
  const bell = ada.page.getByRole('button', { name: /posted in the discussion on/ }).first()
  await expect(bell).toBeVisible({ timeout: ms(20_000) })
  await bell.click()
  // Asserted on the POST, not the thread's heading: the heading is whatever
  // opened the thread, and by the get-or-create rule Grace may have appended to
  // one the turn already carried (walk 3 leaves one there when both run).
  // `.first()`: whether Grace's words are the thread's HEADING (she opened it)
  // or just a post in it (walk 3 opened it first) depends on which walks ran —
  // the assertion must not care.
  await expect(ada.page.getByText(GUEST_POST).first()).toBeVisible()
  // It landed on the THREAD's page, not the subject's — the anchor chip is
  // there, pointing back at the exact turn the thread hangs on.
  await expect(ada.page.getByRole('button', { name: /^session · .+ · one turn$/ })).toBeVisible()

  // …and the bell left her a way HOME (owner directive 2026-08-08). The inbox
  // is a PAGE now, so its rows are in-page doors: what one opens carries the
  // INBOX on its back stack, and Back is how she gets to the next bell. (It
  // once said "Back to Discussions" — the section root, which is not anywhere
  // she had been.)
  const home = ada.page.getByRole('button', { name: /^Back to / })
  await expect(home).toHaveAttribute('aria-label', /^Back to Notifications$/)
  await home.click()
  await expect(ada.page).toHaveURL(/\/notifications/, { timeout: ms(20_000) })
  // Back through the same door, so the rest of the walk still has the thread —
  // and so the row is proved to work a second time, having been marked read.
  await ada.page.getByRole('button', { name: /posted in the discussion on/ }).first().click()
  await expect(ada.page.getByText(GUEST_POST).first()).toBeVisible({ timeout: ms(20_000) })

  // ── S5 guardrails, the two-party case ────────────────────────────────────
  // Ada did NOT write this post, but she owns the surface it sits on, so she is
  // offered the moderator's delete — labelled as such, not as a retraction. A
  // gate on "is this mine" would have hidden it.
  // Scoped to GRACE's post specifically: the thread may also hold Ada's own
  // words (walk 3), which she'd correctly see a *retract* on — the claim here is
  // about the post she did NOT write.
  const gracePost = ada.page.getByRole('listitem').filter({ hasText: GUEST_POST })
  await expect(gracePost.getByRole('button', { name: 'Delete this post' })).toBeVisible()
  await expect(gracePost.getByRole('button', { name: 'Retract this post' })).toHaveCount(0)

  // ── Capability shapes affordances: narrow Grace to `view` ────────────────
  // She keeps READING every thread and loses the ability to start one, so the
  // opener disappears while the marker stays. Without this the gutter offers an
  // act the server refuses — once per turn, on every turn.
  await ada.page.goto(TURN_SESSION)
  await ada.page.getByRole('button', { name: 'Share this conversation' }).click()
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Tier').selectOption({ label: 'View' })
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()

  await grace.page.reload()
  await expect(grace.page.getByTitle('Open this turn’s thread').first()).toBeVisible({ timeout: ms(20_000) })
  await expect(grace.page.getByTitle('Discuss this turn')).toHaveCount(0)
  await expect(grace.page.getByTitle('Reply')).toHaveCount(0)

  await ada.context.close()
  await grace.context.close()
})

test('a shared ROUTINE: the visitor page is read-only, and landing their change runs the real mutator', async ({ browser }) => {
  test.setTimeout(ms(180_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  // Ada shares the routine from its rail — the same generic GrantsPanel the
  // project page hosts, on a subject that had no share door until now.
  await ada.page.goto(ROUTINE)
  await expect(ada.page.getByRole('heading', { name: /Triage/i })).toBeVisible({ timeout: ms(20_000) })
  // Configuration sections open FOLDED (owner decision 2026-08-12), so the share
  // controls are one click behind their header now — exactly as a reader finds them.
  await openShareForm(ada.page)
  await ada.page.getByLabel('Audience kind').selectOption('org')
  await ada.page.getByLabel('Audience id').fill('tenant-beta')
  await ada.page.getByLabel('Tier').selectOption({ label: 'Propose' })
  await ada.page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ada.page.getByText('tenant-beta')).toBeVisible()

  // The OWNER's controls, named once. Asserted present for Ada and absent for
  // Grace using the SAME locators: a `toHaveCount(0)` on a typo'd selector
  // passes forever, so each negative is only meaningful because the positive
  // beside it proves the locator can match.
  const ownerControls = (p: Page) => [
    p.getByRole('button', { name: 'Run now' }),
    p.getByRole('button', { name: /^(Pause|Resume) routine$/ }),
    p.getByRole('button', { name: 'Delete routine' }),
    p.getByTitle('Rename routine'),
    p.getByLabel('Audience id'),
    p.getByLabel('Edit instruction'),
  ]
  for (const control of ownerControls(ada.page)) await expect(control).toHaveCount(1)

  // Grace can now open it — and the page is READ-ONLY. Widening the read must
  // not hand her the owner's controls; every one of these would 404.
  await grace.page.goto(ROUTINE)
  await expect(grace.page.getByRole('heading', { name: /Triage/i })).toBeVisible({ timeout: ms(20_000) })
  for (const control of ownerControls(grace.page)) await expect(control).toHaveCount(0)

  // What she CAN do is the point of sharing it: propose a FIELD of the routine.
  // The form is structured, not prose — the delta has to be appliable.
  await grace.page.getByRole('button', { name: 'Offer a change' }).click()
  await grace.page.getByLabel('Field to change').selectOption('cadence')
  await grace.page.getByLabel('New value').fill(NEW_CADENCE)
  await grace.page.getByLabel('Why this change').fill(ROUTINE_CHANGE)
  await grace.page.getByRole('button', { name: 'Offer', exact: true }).click()
  await expect(grace.page.getByText(`cadence → “${NEW_CADENCE}”`)).toBeVisible({ timeout: ms(20_000) })

  // Ada lands it — and because the delta is a `schedule-patch`, landing runs the
  // REAL `updateSchedule`: the routine's own cadence changes on her page. That
  // is the difference between a proposal that records agreement and one that
  // performs it.
  // Navigate explicitly rather than reload(): a reload restores whatever address
  // the pane had drifted to, which in a full-suite run is not this routine.
  await ada.page.goto(ROUTINE)
  // Scoped to GRACE'S row, never `.first()`: this routine accumulates proposals
  // across runs, and landing whichever happened to be first proves nothing about
  // the one under test.
  const row = ada.page.locator('li', { hasText: `cadence → “${NEW_CADENCE}”` })
  await expect(row).toHaveCount(1, { timeout: ms(20_000) })
  await row.getByRole('button', { name: 'Land' }).click()
  // A ledger POSITION, not a specific number: this routine's L# sequence is
  // shared, so an earlier walk landing on it would shift mine.
  await expect(row.getByText(/^L\d+$/)).toBeVisible({ timeout: ms(20_000) })
  // The real proof: landing RAN the mutator, so the routine's own cadence changed.
  await expect(ada.page.getByText(NEW_CADENCE).first()).toBeVisible({ timeout: ms(20_000) })

  await ada.context.close()
  await grace.context.close()
})

test('a shared ARTIFACT: the grant opens it, and the visitor gets no filing controls', async ({ browser }) => {
  test.setTimeout(ms(180_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  // The BEFORE/AFTER of the wall is locked precisely in server/routes/social.test.ts
  // (walled before the grant, visible after, `own` false for the audience) — it
  // needs a clean store, which a persistent e2e store can't promise. This walk
  // owns the DOM half: that the share door exists on the artifact page at all,
  // and that the visitor's copy of the same page carries no owner controls.
  await ada.page.goto('/artifacts')
  await ada.page.getByText(ARTIFACT).first().click()
  const artifactPage = ada.page.locator('[data-artifact-page]')
  await expect(artifactPage).toBeVisible({ timeout: ms(20_000) })
  await expect(ada.page).toHaveURL(/\/artifacts\/a1$/)
  await expect(ada.page.getByRole('dialog', { name: ARTIFACT })).toHaveCount(0)
  await expect(artifactPage.getByRole('button', { name: 'Back to Artifacts' })).toBeVisible()
  await expect(artifactPage.getByTitle('Assign to a project')).toBeVisible()
  await artifactPage.getByLabel('Audience kind').selectOption('org')
  await artifactPage.getByLabel('Audience id').fill('tenant-beta')
  await artifactPage.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(artifactPage.getByText('tenant-beta')).toBeVisible({ timeout: ms(20_000) })

  // THE POINT: before this, the grant was accepted and the artifact stayed
  // invisible — discussable but unviewable. Now the read widens.
  await grace.page.goto('/artifacts')
  await expect(grace.page.getByText(ARTIFACT).first()).toBeVisible({ timeout: ms(20_000) })

  // …and ownership did NOT widen: she reads it, and gets no filing control and
  // no share configuration of someone else's artifact.
  await grace.page.getByText(ARTIFACT).first().click()
  const visitorPage = grace.page.locator('[data-artifact-page]')
  await expect(visitorPage).toBeVisible({ timeout: ms(20_000) })
  await expect(visitorPage.getByTitle('Assign to a project')).toHaveCount(0)
  await expect(visitorPage.getByText('Share this artifact')).toHaveCount(0)

  await ada.context.close()
  await grace.context.close()
})

test('improve an ARTIFACT: the owner edits in place, a visitor proposes, the owner lands', async ({ browser }) => {
  test.setTimeout(ms(180_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  const OWNER_EDIT = `A self-serve analytics surface — rewritten by its owner ${STAMP}.`
  const PROPOSED = `Who this is for ${STAMP}`

  // ── The owner's own door: edit one block, in place ────────────────────────
  await ada.page.goto('/artifacts/a1')
  const ownerPage = ada.page.locator('[data-artifact-page]')
  await expect(ownerPage).toBeVisible({ timeout: ms(20_000) })

  // The pencil appears on exactly the blocks that carry ONE editable string.
  // Blocks 4 and 6 of this document are LISTS — a one-line before→after cannot
  // address them, so they must have no pencil (the `docBlockText` cut, in DOM form).
  await expect(ownerPage.getByRole('button', { name: 'Edit block 2' })).toHaveCount(1)
  await expect(ownerPage.getByRole('button', { name: 'Edit block 4' })).toHaveCount(0)
  await expect(ownerPage.getByRole('button', { name: 'Edit block 6' })).toHaveCount(0)

  await ownerPage.getByRole('button', { name: 'Edit block 2' }).click()
  const box = ownerPage.getByRole('textbox', { name: 'Rewrite block 2' })
  await expect(box).toBeVisible()
  await box.fill(OWNER_EDIT)
  await ownerPage.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(ownerPage.getByText(OWNER_EDIT)).toBeVisible({ timeout: ms(20_000) })

  // Share at PROPOSE so the audience may offer a change.
  await ownerPage.getByLabel('Audience kind').selectOption('org')
  await ownerPage.getByLabel('Audience id').fill('tenant-beta')
  await ownerPage.getByLabel('Tier').selectOption({ label: 'Propose' })
  await ownerPage.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(ownerPage.getByText('tenant-beta')).toBeVisible({ timeout: ms(20_000) })

  // ── The visitor: reads the owner's edit, may NOT rewrite it, may PROPOSE ──
  await grace.page.goto('/artifacts/a1')
  const visitorPage = grace.page.locator('[data-artifact-page]')
  await expect(visitorPage).toBeVisible({ timeout: ms(20_000) })
  await expect(visitorPage.getByText(OWNER_EDIT)).toBeVisible({ timeout: ms(20_000) })
  // The read widened; the write did not — no pencil anywhere in her copy.
  await expect(visitorPage.getByRole('button', { name: /^Edit block / })).toHaveCount(0)

  await visitorPage.getByRole('button', { name: 'Offer a change' }).click()
  // The picker offers BLOCKS, not a routine's fields — the per-kind form. The
  // block is chosen by what it SAYS, never by its position in the list: an
  // option index would silently retarget (or vanish) the day the seed document
  // gains or reorders a block, and the walk would then read as a regression in
  // artifact-patch rather than a fixture change. Resolving the option's value
  // from its text binds the walk to the block it means.
  const picker = visitorPage.getByLabel('Block to rewrite')
  const blockValue = await picker.locator('option', { hasText: 'Who it’s for' }).first().getAttribute('value')
  assert(blockValue, 'the seed document still has a "Who it’s for" heading to rewrite')
  await picker.selectOption(blockValue)
  await visitorPage.getByLabel('Rewritten text').fill(PROPOSED)
  await visitorPage.getByLabel('Why this change').fill(`Plainer wording ${STAMP}`)
  await visitorPage.getByRole('button', { name: 'Offer', exact: true }).click()
  // The card is a DIFF — a change wears the form a change wants.
  await expect(visitorPage.getByText('body edit')).toBeVisible({ timeout: ms(20_000) })
  await expect(visitorPage.getByText(PROPOSED)).toBeVisible()
  // …and a visitor holds no consent: land/decline are the owner's alone.
  await expect(visitorPage.getByRole('button', { name: 'Land' })).toHaveCount(0)

  // ── The owner lands it, and the DOCUMENT changes ──────────────────────────
  await ada.page.reload()
  const again = ada.page.locator('[data-artifact-page]')
  await expect(again.getByText(PROPOSED).first()).toBeVisible({ timeout: ms(20_000) })
  await again.getByRole('button', { name: 'Land' }).first().click()
  // The body now carries the proposed text as a HEADING (the block it addressed),
  // and the row has taken a ledger number.
  await expect(again.getByText(/^L\d+$/).first()).toBeVisible({ timeout: ms(20_000) })
  await expect(again.getByText(PROPOSED).first()).toBeVisible()

  await ada.context.close()
  await grace.context.close()
})

/** 9. THE SQUARE (S8): a post is a Discussion anchored to its author's own
 *  principal, so "say something" needed no fourth primitive. Only a browser can
 *  lock the round trip that makes it a social feature rather than a data shape:
 *  the composer writes, the card renders WITHOUT a resource embed, the mention
 *  is a live door onto the named person's profile, a second tenant replies from
 *  their own square, and the reply comes back under the author's card. */
