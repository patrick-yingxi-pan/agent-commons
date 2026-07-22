import { test, expect, type Browser, type Page } from '@playwright/test'

/** The social layer's DOM-level wiring (docs/design/social-layer.md,
 *  spec pillar docs/spec/12-social-layer.md) — the walks the node suites can't
 *  lock because they live in the rendered UI:
 *
 *  1. share → feed → discuss → improve: the owner publishes a project through
 *     the Sharing rail (a grant with a note), the audience's Commons feed
 *     carries the card, the card's title doors into the ONE canonical entity
 *     page, a comment posted on the entity page rides the SAME root thread the
 *     feed card projects, and an offered change lands as L1 in the merged
 *     Changes panel (the one-ledger consolidation) — owner consent inline.
 *  2. the share link: the owner mints a Link grant (server-minted token), and
 *     a signed-in third tenant opening `/shared/:token` redeems it and lands
 *     on the subject's page.
 *  3. the turn gutter (SOCIAL-6b): a discussion anchored to ONE TURN of a
 *     conversation — minted from the turn's hover gutter, doored from the
 *     turn's marker, and RESOLVED back by the thread page's anchor chip, which
 *     must land the conversation scrolled to that exact turn. The round trip is
 *     the whole point of a locus, and only a browser can prove the landing.
 *  4. sharing a CONVERSATION: the owner shares from the title bar's share door
 *     (chrome, not a page — a conversation has no rail), the audience's read
 *     opens while the door itself does NOT (reads widen, ownership doesn't),
 *     and the visitor discusses one turn of a conversation she doesn't own —
 *     which RINGS the owner (social.discussed), whose bell doors onto the
 *     thread's own page.
 *
 *  Tenant impersonation mirrors co-author-article.spec.ts: BACKEND=remote,
 *  identity via headers — Ada (no headers, the seeded default owner), Grace
 *  (`tenant-beta`, the granted audience), Maya (`tenant-growthworks`, the
 *  link-holder who starts fully walled). */

const STAMP = Date.now().toString(36)
const PROJECT = `Social walk ${STAMP}`
const LINK_PROJECT = `Link walk ${STAMP}`
const NOTE = `Fresh off the press ${STAMP}`
const COMMENT = `One suggestion incoming ${STAMP}`
const CHANGE = `Lead with the retention metric ${STAMP}`
const TURN_POST = `About this step specifically ${STAMP}`
const TURN_REPLY = `Still this step ${STAMP}`
const GUEST_POST = `A question about this exact step ${STAMP}`
const RUN_POST = `This run failed on the label step ${STAMP}`
const ARTIFACT = 'insights-onepager.md'
const ROUTINE = '/scheduled/s-issue-triage'
const NEW_CADENCE = `Every 9 hours ${STAMP}`
const ROUTINE_CHANGE = `Move this to 09:00 — 08:00 lands before the data does ${STAMP}`
/** A seeded multi-turn conversation, opened by its canonical URL (every page
 *  has one — src/CLAUDE.md). The walk asserts the turn count, so a reseed that
 *  shortens this thread fails loudly rather than passing vacuously. */
const TURN_SESSION = '/s/auth-refactor'
const API = '/api/v1'

async function gotoSection(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

async function createProject(page: Page, name: string) {
  await gotoSection(page, 'Projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByPlaceholder('e.g. Insights dashboard').fill(name)
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

async function openProject(page: Page, name: string) {
  await gotoSection(page, 'Projects')
  await page.getByText(name).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/** The created project's backend id, through the same tenant-scoped API the UI reads. */
async function projectId(page: Page, name: string) {
  const graph = (await (await page.request.get(`${API}/relations`)).json()) as {
    extraProjects: { id: string; name: string }[]
  }
  const row = graph.extraProjects.find((p) => p.name === name)
  expect(row, `project '${name}' in the relation graph`).toBeTruthy()
  return row!.id
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('share → feed → discuss → improve: one thread, one ledger, across two tenants', async ({ browser }) => {
  test.setTimeout(120_000)
  const ada = await newUser(browser) // seeded default: user-ada / tenant-acme (owner)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // ── Ada publishes: a grant with a note through the Sharing rail ────────────
  await ada.page.goto('/')
  await createProject(ada.page, PROJECT)
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
  await gotoSection(grace.page, 'Commons')
  await expect(grace.page.getByText(COMMENT)).toBeVisible()

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
  test.setTimeout(120_000)
  const ada = await newUser(browser)
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })

  // ── Ada mints the link grant (the server mints the token) ─────────────────
  await ada.page.goto('/')
  await createProject(ada.page, LINK_PROJECT)
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
  await expect(maya.page.getByRole('heading', { name: LINK_PROJECT })).toBeVisible({ timeout: 20_000 })

  await ada.context.close()
  await maya.context.close()
})

test('the turn gutter: a thread anchored to ONE turn, and the chip that lands back on it', async ({ browser }) => {
  test.setTimeout(120_000)
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
  await expect(turns.first()).toBeAttached({ timeout: 20_000 })
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
    timeout: 10_000,
  })

  await ada.context.close()
})

test('sharing a CONVERSATION: the owner shares from its title bar, the audience discusses a turn', async ({ browser }) => {
  test.setTimeout(120_000)
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
  await expect(graceTurns.first()).toBeAttached({ timeout: 20_000 })

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
  await ada.page.getByRole('button', { name: 'Notifications' }).click()
  const bell = ada.page.getByRole('button', { name: /posted in the discussion on/ }).first()
  await expect(bell).toBeVisible({ timeout: 20_000 })
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
  await expect(grace.page.getByTitle('Open this turn’s thread').first()).toBeVisible({ timeout: 20_000 })
  await expect(grace.page.getByTitle('Discuss this turn')).toHaveCount(0)
  await expect(grace.page.getByTitle('Reply')).toHaveCount(0)

  await ada.context.close()
  await grace.context.close()
})

test('the run gutter: the SAME gutter on a routine’s runs, landing back on one of them', async ({ browser }) => {
  test.setTimeout(120_000)
  const ada = await newUser(browser)
  const page = ada.page

  // A routine's page lists its runs — a second surface with addressable
  // positions, served by the ONE gutter and the ONE resolver.
  await page.setViewportSize({ width: 1100, height: 400 })
  await page.goto('/scheduled/s-issue-triage')
  const gutters = page.getByTitle('Discuss this run')
  await expect(gutters.first()).toBeAttached({ timeout: 20_000 })
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
  await expect(page.getByTitle('Open this run’s thread')).toBeInViewport({ timeout: 10_000 })

  await ada.context.close()
})

test('a shared ROUTINE: the visitor page is read-only, and landing their change runs the real mutator', async ({ browser }) => {
  test.setTimeout(180_000)
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  // Ada shares the routine from its rail — the same generic GrantsPanel the
  // project page hosts, on a subject that had no share door until now.
  await ada.page.goto(ROUTINE)
  await expect(ada.page.getByRole('heading', { name: /Triage/i })).toBeVisible({ timeout: 20_000 })
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
    p.getByRole('button', { name: /^(Pause|Resume)$/ }),
    p.getByRole('button', { name: 'Delete' }),
    p.getByTitle('Rename routine'),
    p.getByLabel('Audience id'),
    p.getByLabel('Edit instruction'),
  ]
  for (const control of ownerControls(ada.page)) await expect(control).toHaveCount(1)

  // Grace can now open it — and the page is READ-ONLY. Widening the read must
  // not hand her the owner's controls; every one of these would 404.
  await grace.page.goto(ROUTINE)
  await expect(grace.page.getByRole('heading', { name: /Triage/i })).toBeVisible({ timeout: 20_000 })
  for (const control of ownerControls(grace.page)) await expect(control).toHaveCount(0)

  // What she CAN do is the point of sharing it: propose a FIELD of the routine.
  // The form is structured, not prose — the delta has to be appliable.
  await grace.page.getByRole('button', { name: 'Offer a change' }).click()
  await grace.page.getByLabel('Field to change').selectOption('cadence')
  await grace.page.getByLabel('New value').fill(NEW_CADENCE)
  await grace.page.getByLabel('Why this change').fill(ROUTINE_CHANGE)
  await grace.page.getByRole('button', { name: 'Offer', exact: true }).click()
  await expect(grace.page.getByText(`cadence → “${NEW_CADENCE}”`)).toBeVisible({ timeout: 20_000 })

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
  await expect(row).toHaveCount(1, { timeout: 20_000 })
  await row.getByRole('button', { name: 'Land' }).click()
  // A ledger POSITION, not a specific number: this routine's L# sequence is
  // shared, so an earlier walk landing on it would shift mine.
  await expect(row.getByText(/^L\d+$/)).toBeVisible({ timeout: 20_000 })
  // The real proof: landing RAN the mutator, so the routine's own cadence changed.
  await expect(ada.page.getByText(NEW_CADENCE).first()).toBeVisible({ timeout: 20_000 })

  await ada.context.close()
  await grace.context.close()
})

test('a shared ARTIFACT: the grant opens it, and the visitor gets no filing controls', async ({ browser }) => {
  test.setTimeout(180_000)
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-tenant-id': 'tenant-beta' })

  // The BEFORE/AFTER of the wall is locked precisely in tests/social.test.ts
  // (walled before the grant, visible after, `own` false for the audience) — it
  // needs a clean store, which a persistent e2e store can't promise. This walk
  // owns the DOM half: that the share door exists on the viewer at all, and that
  // the visitor's copy of the same modal carries no owner controls.
  await ada.page.goto('/artifacts')
  await ada.page.getByText(ARTIFACT).first().click()
  const viewer = ada.page.getByRole('dialog', { name: ARTIFACT })
  await expect(viewer).toBeVisible({ timeout: 20_000 })
  await expect(viewer.getByTitle('Assign to a project')).toBeVisible()
  await viewer.getByLabel('Audience kind').selectOption('org')
  await viewer.getByLabel('Audience id').fill('tenant-beta')
  await viewer.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(viewer.getByText('tenant-beta')).toBeVisible({ timeout: 20_000 })

  // THE POINT: before this, the grant was accepted and the artifact stayed
  // invisible — discussable but unviewable. Now the read widens.
  await grace.page.goto('/artifacts')
  await expect(grace.page.getByText(ARTIFACT).first()).toBeVisible({ timeout: 20_000 })

  // …and ownership did NOT widen: she reads it, and gets no filing control and
  // no share configuration of someone else's artifact.
  await grace.page.getByText(ARTIFACT).first().click()
  const hers = grace.page.getByRole('dialog', { name: ARTIFACT })
  await expect(hers).toBeVisible({ timeout: 20_000 })
  await expect(hers.getByTitle('Assign to a project')).toHaveCount(0)
  await expect(hers.getByText('Share this artifact')).toHaveCount(0)

  await ada.context.close()
  await grace.context.close()
})

test('a world with NO social activity: the Commons teaches instead of going blank', async ({ browser }) => {
  test.setTimeout(120_000)
  // Rei's Lab is the sparsest seeded world — no grants, no threads. Three of the
  // six demo accounts land here, so this empty state is a first impression, not
  // an edge case.
  const rei = await newUser(browser, { 'x-tenant-id': 'tenant-reislab' })

  await rei.page.goto('/commons')
  // The FEED is empty, and says why + what to do about it (the note is the post).
  await expect(rei.page.getByText(/Nothing published yet/)).toBeVisible({ timeout: 20_000 })
  // …but the page is not dead: the Browse band is a directory of what OTHER
  // workspaces opened, so a brand-new account has somewhere to go. That pairing
  // is the Discover consolidation's whole point (SOCIAL-8).
  await expect(rei.page.getByText(/Browse the Commons/i)).toBeVisible()
  await expect(rei.page.getByRole('button', { name: /Open project/i }).first()).toBeVisible()

  await rei.page.goto('/discussions')
  await expect(rei.page.getByText(/No discussions yet/)).toBeVisible({ timeout: 20_000 })

  await rei.context.close()
})

test('continue from a turn: the fork lands in the forker’s namespace, with provenance', async ({ browser }) => {
  test.setTimeout(180_000)
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
  await expect(continueHere.first()).toBeVisible({ timeout: 20_000 })

  // Taking the SECOND turn: the cut has to be at the named position, so a
  // first-turn fork would prove nothing about the locus.
  const turnsBefore = await grace.page.locator('[data-turn]').count()
  expect(turnsBefore).toBeGreaterThan(1)
  await continueHere.nth(1).click()

  // She lands in a NEW conversation that is hers, carrying only the turns up to
  // that point, and it says where it came from.
  await expect(grace.page).toHaveURL(/\/s\/sess-/, { timeout: 20_000 })
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
