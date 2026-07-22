import { test, expect, type Browser, type Page } from '@playwright/test'
import { agentBindings } from './agent-bindings.ts'

/** D24 — the bell, end to end through the rendered UI: a visitor watches a shared
 *  project; the owner posts a work item; the visitor's bell badges live (the
 *  tenant-targeted SSE), the inbox row names the act, and clicking it deep-links
 *  to the work item's own page (COMMONS-24) and clears the badge. */

const STAMP = Date.now().toString(36)
const PROJECT = `Belled project ${STAMP}`
const ITEM = `ring the bell ${STAMP}`

async function openApp(page: Page) {
  await page.goto('/')
}

/** Navigate to a section from the rail tree (ADAPT-13: an inline disclosure tree —
 *  every section row is always present; there is no drill-in to pop back from). */
async function gotoSection(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('watch a shared project → the owner acts → the watcher’s bell rings, the row is a door', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser)
  const watcher = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // Owner: create + share.
  await openApp(owner.page)
  await gotoSection(owner.page, 'Projects')
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')

  // Watcher: open the shared project page and hit Watch.
  await openApp(watcher.page)
  await gotoSection(watcher.page, 'Projects')
  await watcher.page.getByText(PROJECT).first().click()
  const watch = watcher.page.getByRole('button', { name: 'Watch', exact: true })
  await watch.click()
  await expect(watcher.page.getByRole('button', { name: 'Watching', exact: true })).toBeVisible()

  // Owner posts a work item — the public act. (The post form is on demand —
  // the Open-work header's verb discloses it.)
  await owner.page.getByRole('button', { name: 'Post a work item' }).click()
  await owner.page.getByPlaceholder('Post a work item (sub-goal)…').fill(ITEM)
  await owner.page.getByLabel('Effect target').fill('budget:demo')
  await owner.page.getByRole('button', { name: 'Post work item' }).click()
  await expect(owner.page.getByText(ITEM)).toBeVisible()

  // The watcher's bell badges LIVE (tenant-targeted SSE — no reload).
  await expect(watcher.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await watcher.page.getByRole('complementary').getByLabel(/Notifications/).click()
  const panel = watcher.page.getByRole('dialog', { name: 'Notifications' })
  const row = panel.getByRole('button', { name: new RegExp(ITEM) })
  await expect(row).toBeVisible()

  // The row is a door: it opens the work item's OWN page (COMMONS-24 — the
  // issue-page analog: the item title is the heading, the project name a door,
  // the timeline + composer the body) and marks ITSELF read (other specs' rows
  // may keep the global badge — assert the row's own dot, not the badge).
  await row.click()
  await expect(watcher.page.getByRole('heading', { name: ITEM })).toBeVisible()
  // Two project doors exist by design (the back button + the meta line) — any one proves the page.
  await expect(watcher.page.getByRole('button', { name: PROJECT }).first()).toBeVisible()
  await expect(watcher.page.getByLabel(`Comment on ${ITEM}`)).toBeVisible()
  await watcher.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await expect(
    watcher.page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(ITEM) }).getByLabel('Unread'),
  ).toHaveCount(0)

  await owner.context.close()
  await watcher.context.close()
})

test('a work.commented bell opens the project ON the item’s thread, auto-expanded to the comment (R4 focus)', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // seeded default tenant
  const visitor = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const P = `Focus arena ${STAMP}`
  const IT = `focus-me item ${STAMP}`
  const CMT = `the anchored reply ${STAMP}`

  // Owner: shared project + one open item (owner is poster ⇒ in the item's audience).
  await openApp(owner.page)
  await gotoSection(owner.page, 'Projects')
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(P)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')
  await owner.page.getByRole('button', { name: 'Post a work item' }).click()
  await owner.page.getByPlaceholder('Post a work item (sub-goal)…').fill(IT)
  await owner.page.getByLabel('Effect target').fill('budget:demo')
  await owner.page.getByRole('button', { name: 'Post work item' }).click()
  await expect(owner.page.getByText(IT)).toBeVisible()

  // Visitor: opens the shared project and comments on the item → the OWNER's bell rings.
  await openApp(visitor.page)
  await gotoSection(visitor.page, 'Projects')
  await visitor.page.getByText(P).first().click()
  await expect(visitor.page.getByRole('heading', { name: P })).toBeVisible()
  await visitor.page.getByRole('button', { name: 'Comment', exact: true }).click()
  await visitor.page.getByLabel(`Comment on ${IT}`).fill(CMT)
  await visitor.page.getByLabel(`Comment on ${IT}`).press('Enter')
  await expect(visitor.page.getByText(CMT)).toBeVisible()

  // Owner navigates AWAY (to Agents) so the door's navigation + focus is unambiguous —
  // the comment is nowhere on screen until the bell takes us there.
  await gotoSection(owner.page, 'Agents')
  await expect(owner.page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  await expect(owner.page.getByText(CMT)).toHaveCount(0)

  // The owner's bell rings the comment; clicking it is the door.
  await expect(owner.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await owner.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await owner.page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: new RegExp(`commented on .*${IT}`) })
    .click()

  // The door lands ON the item's page (COMMONS-24) with the comment in its
  // timeline — the `…/issues/42#issuecomment-99` shape: the item is the heading
  // and the anchored comment is on screen with no manual expand.
  await expect(owner.page.getByRole('heading', { name: IT })).toBeVisible()
  await expect(owner.page.getByText(CMT)).toBeVisible()

  await owner.context.close()
  await visitor.context.close()
})

test('a proposal.opened bell opens the review dialog directly ON the proposal (R5 owner focus)', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // seeded default tenant — owns the agent
  const proposer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const AGENT = `Reviewed guide ${STAMP}`
  const NEW_PROMPT = `a sharper prompt ${STAMP}`
  const NOTE = `please consider this ${STAMP}`

  // Owner: create + publish via the API seam (as the definition-evolution spec does).
  const created = await owner.page.request.post('/api/v1/agents', {
    data: { label: AGENT, ...(await agentBindings(owner.page)), tools: [], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await owner.page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  // Proposer: Discover → View definition → Propose a change (rings the owner's bell).
  await openApp(proposer.page)
  await gotoSection(proposer.page, 'Agents')
  await proposer.page.getByRole('button', { name: 'Discover' }).click()
  await expect(proposer.page.getByText(AGENT).first()).toBeVisible()
  await proposer.page.locator('div').filter({ hasText: AGENT }).getByRole('button', { name: 'View definition' }).last().click()
  await proposer.page.getByRole('button', { name: 'Propose a change' }).click()
  await proposer.page.getByLabel('Proposed system prompt').fill(NEW_PROMPT)
  await proposer.page.getByLabel('Proposal note').fill(NOTE)
  await proposer.page.getByRole('button', { name: 'Open proposal' }).click()

  // Owner opens the app; the bell rings proposal.opened. Clicking the NOTIFICATION —
  // not the Review button — is the door: the review dialog opens directly, focused on
  // the proposal (border-accent), showing its diff. That the dialog is open here
  // WITHOUT a Review-button click is the R5 owner-side proof.
  await openApp(owner.page)
  await expect(owner.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await owner.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await owner.page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: new RegExp(`proposed a change to .*${AGENT}`) })
    .click()

  const review = owner.page.getByRole('dialog', { name: `Proposals — ${AGENT}` })
  await expect(review).toBeVisible()
  await expect(review.getByText(NEW_PROMPT)).toBeVisible()
  await expect(review.getByText(NOTE)).toBeVisible()

  await owner.context.close()
  await proposer.context.close()
})

test('a proposal.merged bell opens the owner’s profile ON Your-proposals, focused (R5b proposer focus)', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // seeded default tenant — owns + merges
  const proposer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const AGENT = `Accepted guide ${STAMP}`
  const NEW_PROMPT = `a tighter prompt ${STAMP}`
  const NOTE = `please accept this ${STAMP}`

  // Owner: create + publish.
  const created = await owner.page.request.post('/api/v1/agents', {
    data: { label: AGENT, ...(await agentBindings(owner.page)), tools: [], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await owner.page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  // Proposer: propose a change against the published definition.
  await openApp(proposer.page)
  await gotoSection(proposer.page, 'Agents')
  await proposer.page.getByRole('button', { name: 'Discover' }).click()
  await expect(proposer.page.getByText(AGENT).first()).toBeVisible()
  await proposer.page.locator('div').filter({ hasText: AGENT }).getByRole('button', { name: 'View definition' }).last().click()
  await proposer.page.getByRole('button', { name: 'Propose a change' }).click()
  await proposer.page.getByLabel('Proposed system prompt').fill(NEW_PROMPT)
  await proposer.page.getByLabel('Proposal note').fill(NOTE)
  await proposer.page.getByRole('button', { name: 'Open proposal' }).click()

  // Owner: open the app, review, merge → the proposer's bell rings proposal.merged.
  await openApp(owner.page)
  await gotoSection(owner.page, 'Agents')
  await owner.page
    .locator('div')
    .filter({ hasText: AGENT })
    .getByRole('button', { name: 'Review 1 proposal', exact: true })
    .last()
    .click()
  const review = owner.page.getByRole('dialog', { name: `Proposals — ${AGENT}` })
  await review.getByRole('button', { name: 'Merge' }).click()
  await expect(review.getByText('merged', { exact: true })).toBeVisible() // the status pill

  // Proposer's inbox note text is unique; give the SSE a beat to deliver the bell.

  // Proposer: the proposal.merged bell is the door — clicking it opens the
  // definition's OWN page (COMMONS-26), "Your proposals" focused on the proposal
  // (its note + the merged status are visible on the page — no manual drill-in).
  await expect(proposer.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await proposer.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await proposer.page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: new RegExp(`merged your proposal into .*${AGENT}`) })
    .click()

  await expect(proposer.page.getByRole('heading', { name: AGENT })).toBeVisible()
  await expect(proposer.page.getByText(/Your proposals/)).toBeVisible()
  // The proposal row's own note (exact — the merge also echoes it into the changelog).
  await expect(proposer.page.getByText(NOTE, { exact: true })).toBeVisible()
  // The VERDICT is visible too — the row's merged status pill. This is the review
  // fix's regression lock: the queue was prefetched before the owner merged, and
  // without the `proposal.changed` push the door opened the stale 'open' copy.
  await expect(proposer.page.getByText('merged', { exact: true }).first()).toBeVisible()
  // Surface-audit S1: the proposer can now review THEIR OWN change (the diff's
  // proposed column), not just its note — the shared ProposalFieldDiff renders here.
  await expect(proposer.page.getByText(NEW_PROMPT).first()).toBeVisible()

  await owner.context.close()
  await proposer.context.close()
})

test('an agent.forked bell lands on the source agent’s own card in the hub (R6 fork door)', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // seeded default tenant — owns the source agent
  const forker = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const AGENT = `Forkable guide ${STAMP}`

  // Owner: create + publish via the API seam.
  const created = await owner.page.request.post('/api/v1/agents', {
    data: { label: AGENT, ...(await agentBindings(owner.page)), tools: [], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await owner.page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  // Forker: fork the definition → rings the SOURCE owner's bell (public credit, D18×D24).
  const forked = await forker.page.request.post(`/api/v1/agents/${agentId}/fork`)
  expect(forked.ok()).toBeTruthy()

  // Owner: the agent.forked bell is the door — clicking it lands on the Agents hub
  // with the SOURCE agent's OWN card (its owner-only Unpublish action proves it's the
  // hub card, not a Discover entry, and never the fork — which the owner may not see).
  await openApp(owner.page)
  await expect(owner.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await owner.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await owner.page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: new RegExp(`forked your agent .*${AGENT}`) })
    .click()

  await expect(
    owner.page.locator('div').filter({ hasText: AGENT }).getByRole('button', { name: 'Unpublish' }).last(),
  ).toBeVisible()

  await owner.context.close()
  await forker.context.close()
})
