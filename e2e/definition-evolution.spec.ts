import { test, expect, type Browser, type Page } from '@playwright/test'
import { agentBindings } from './agent-bindings.ts'

/** D25 — the definition evolution loop, end to end through the rendered UI: the
 *  owner publishes; a FOREIGN tenant opens the public detail, proposes a sharper
 *  prompt; the owner's bell rings, the review queue shows the side-by-side, the
 *  owner merges; the proposer's bell rings, and the public detail now serves v2
 *  with the changelog crediting the PROPOSER. */

const STAMP = Date.now().toString(36)
const AGENT = `Evolving guide ${STAMP}`
const NEW_PROMPT = `You are the sharper v2 guide ${STAMP}.`
const NOTE = `tightens everything ${STAMP}`

async function openApp(page: Page) {
  await page.goto('/')
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('propose → review side-by-side → merge: the definition evolves and credits the proposer', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser)
  const proposer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // Owner: create + publish through the API seam (publishing is locked elsewhere).
  // The route resolves the prompt BODY from systemPromptId — the created agent
  // carries the default toolkit body; the proposal will replace it.
  const created = await owner.page.request.post('/api/v1/agents', {
    data: { label: AGENT, ...(await agentBindings(owner.page)), tools: [], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await owner.page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  // Proposer: Discover → the card door → Propose a change.
  await openApp(proposer.page)
  await proposer.page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  await proposer.page.getByRole('button', { name: 'Discover' }).click()
  await expect(proposer.page.getByText(AGENT).first()).toBeVisible()
  // The card's TITLE door — its accessible name is the agent's, so this needs no
  // scoping (the old "View definition" button was shared by every card, hence the
  // filter-then-last dance). The card BODY opens the same page: UI-17.
  await proposer.page.getByRole('button', { name: AGENT, exact: true }).first().click()
  await expect(proposer.page.getByRole('heading', { name: AGENT })).toBeVisible() // the definition's own page
  await proposer.page.getByRole('button', { name: 'Propose a change' }).click()
  await proposer.page.getByLabel('Proposed system prompt').fill(NEW_PROMPT)
  await proposer.page.getByLabel('Proposal note').fill(NOTE)
  await proposer.page.getByRole('button', { name: 'Open proposal' }).click()

  // Owner: the bell rings; the agent card offers the review; the diff shows both sides.
  await openApp(owner.page)
  await expect(owner.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  // Scope to THIS agent's card — reused e2e stores carry earlier runs' agents,
  // whose own review buttons would otherwise collide in strict mode.
  await owner.page
    .locator('div')
    .filter({ hasText: AGENT })
    .getByRole('button', { name: 'Review 1 proposal', exact: true })
    .last()
    .click()
  const review = owner.page.getByRole('dialog', { name: `Proposals — ${AGENT}` })
  // The side-by-side: current (the default toolkit body) vs proposed.
  await expect(review.getByText(/You are Claude in the Agent Commons/).first()).toBeVisible()
  await expect(review.getByText(NEW_PROMPT)).toBeVisible()
  await expect(review.getByText(NOTE)).toBeVisible()
  await review.getByRole('button', { name: 'Merge' }).click()
  await expect(review.getByText('merged')).toBeVisible()
  await owner.page.keyboard.press('Escape')

  // The published card now says v2 (scoped: earlier runs' agents may also be v2).
  await expect(
    owner.page.locator('div').filter({ hasText: AGENT }).getByText('Published · v2').last(),
  ).toBeVisible()

  // Surface-audit S4: the owner reaches their own version-history timeline FROM THE
  // CARD — the merge authored a changelog entry, so a "History (N)" reveal appears and
  // opens the same list the visitor sees (not just the bare v2 badge).
  const ownerCard = owner.page.locator('div').filter({ hasText: AGENT })
  await ownerCard.getByRole('button', { name: /History \(\d+\)/ }).last().click()
  await expect(owner.page.getByText(NOTE).last()).toBeVisible() // the merged entry's note
  // Surface-audit S12: the changelog AUTHOR is a workspace door like every other byline
  // — clicking it opens that workspace's profile (the proposer authored v2).
  await ownerCard.getByRole('button', { name: /^by / }).last().click()
  await expect(owner.page.getByText('Recent public activity')).toBeVisible() // a profile-page section
  await expect(proposer.page.getByRole('complementary').getByLabel(/Notifications \(\d+ unread\)/)).toBeVisible({ timeout: 10_000 })
  await proposer.page.getByRole('complementary').getByLabel(/Notifications/).click()
  await expect(
    proposer.page
      .getByRole('dialog', { name: 'Notifications' })
      .getByText(new RegExp(`merged your proposal into “${AGENT}”`)),
  ).toBeVisible()

  await owner.context.close()
  await proposer.context.close()
})
