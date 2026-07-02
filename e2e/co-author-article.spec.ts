import { test, expect, type Browser, type Page } from '@playwright/test'

/** P8 — the cross-tenant cooperation lifecycle, END TO END through the rendered UI,
 *  as the contrived-but-complete scenario: **two users, from two different tenants,
 *  each contribute one of their own worker agents to the co-authoring of an article**
 *  on one shared Project. This is the multi-tenancy REGRESSION test: every workflow is
 *  the real system (real routes, real store, real guardian/clamp/roles/credit) — the
 *  only mocked piece is the model server's canned prose, as everywhere in the repo.
 *
 *  Tenant impersonation: the stack runs `BACKEND=remote` (playwright.config.ts), where
 *  identity is the F2 header seam. Each user is a separate BROWSER CONTEXT:
 *    • Ada  — no headers → the seeded default (user-ada / tenant-acme), the owner.
 *    • Bo   — `x-user-id: user-grace` + `x-tenant-id: tenant-beta`, the guest tenant.
 *  Both drive the actual rendered UI; `page.request` inherits the same headers, so the
 *  two "agent runtime" calls (project effects — deliberately not a human-clickable
 *  surface; in production the agent fires them, not a person) go through the same
 *  authenticated HTTP boundary the UI uses.
 *
 *  The arc (mirrors docs/design/test-plan-coop-lifecycle.md stages A→D):
 *    A. Ada creates + shares the article Project, scopes the draft doc's connector
 *       (the D12 admitted set), creates her agent, commissions it.
 *    B. Bo SEES the shared Project from his tenant (redacted), sees Ada's Contributor
 *       by its server-resolved public label, and commissions his own agent onto it.
 *       His tenant does NOT see Ada's private Project (isolation control).
 *    C. Cooperation: each agent claims its section sub-goal via the Coordination
 *       panel's claim-as picker (D11); the SAME sub-goal claimed cross-tenant surfaces
 *       the 409 as the panel's conflict prompt; each agent's connector.write effect
 *       runs (clamped, guarded, credited — D12/D11/D13); a cross-tenant effect forged
 *       under the OTHER tenant's commission is refused (403). The mock model supplies
 *       the article prose in each user's own chat (tenant-scoped sessions).
 *    D. Completion — the transient wind-down: both release, the coordination surface
 *       empties on BOTH screens; the D13 credit persists on each owner's agent. */

const STAMP = Date.now().toString(36)
const PROJECT = `Co-authored article ${STAMP}`
const PRIVATE_PROJECT = `Ada private notes ${STAMP}`
const ADA_AGENT = `Ada Drafter ${STAMP}`
const BO_AGENT = `Bo Editor ${STAMP}`
const INTRO = 'draft: introduction'
const CONCLUSION = 'draft: conclusion'
const API = '/api/v1'

/** Dismiss the intro overlay when it's up. It mounts on EVERY page load (showIntro
 *  starts true — deliberate for the proposal demo), and it can mount a beat after
 *  `load`, so a one-shot check races: wait briefly for it, click if it appears. */
async function dismissIntro(page: Page, timeout = 2_500) {
  await page
    .getByRole('button', { name: 'Explore on my own' })
    .click({ timeout })
    .catch(() => {})
}

/** Open the app fresh and clear the intro. */
async function openApp(page: Page) {
  await page.goto('/')
  await dismissIntro(page, 5_000)
}

/** Reload — the intro overlay re-mounts on every load, so clear it again. */
async function reloadApp(page: Page) {
  await page.reload()
  await dismissIntro(page)
}

/** Create a worker agent through the Agents hub dialog. */
async function createAgent(page: Page, label: string) {
  await dismissIntro(page, 250)
  await page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  await page.getByRole('button', { name: 'New agent' }).click()
  await page.getByPlaceholder('e.g. Code reviewer').fill(label)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText(label).first()).toBeVisible()
}

/** Open a project's detail page from the Projects list. */
async function openProject(page: Page, name: string) {
  await dismissIntro(page, 250)
  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByText(name).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/** Commission an agent onto the currently open project via the Contributors picker. */
async function commission(page: Page, agentLabel: string) {
  await page.getByRole('button', { name: 'Commission an agent' }).click()
  // The picker rows append the agent's tool count to the accessible name — match on prefix.
  await page
    .getByRole('dialog', { name: 'Commission an agent' })
    .getByRole('button', { name: new RegExp(`^${agentLabel}`) })
    .click()
}

/** Claim a sub-goal from the Coordination panel AS one of your commissioned agents. */
async function claimAs(page: Page, agentLabel: string, subGoal: string) {
  await page.getByTestId('claim-as').selectOption({ label: `Claim as: ${agentLabel}` })
  await page.getByPlaceholder('Claim a sub-goal…').fill(subGoal)
  await page.getByRole('button', { name: 'Claim', exact: true }).click()
}

/** Resolve (agentId, commissionId) for one of the caller's OWN agents on a project,
 *  through the same tenant-scoped API the UI reads (page.request carries the tenant). */
async function ownCommission(page: Page, projectId: string, agentLabel: string) {
  const agents = (await (await page.request.get(`${API}/agents`)).json()) as { id: string; label: string }[]
  const agent = agents.find((a) => a.label === agentLabel)
  expect(agent, `agent '${agentLabel}' in own registry`).toBeTruthy()
  const commissions = (await (await page.request.get(`${API}/commissions?project=${projectId}`)).json()) as {
    id: string
    agentId: string
  }[]
  const own = commissions.find((c) => c.agentId === agent!.id)
  expect(own, `commission for '${agentLabel}'`).toBeTruthy()
  return { agentId: agent!.id, commissionId: own!.id }
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('two tenants each contribute an agent to co-author an article on one shared project', async ({ browser }) => {
  test.setTimeout(180_000)
  const ada = await newUser(browser) // seeded default: user-ada / tenant-acme (owner)
  const bo = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // ── Stage A — Ada founds the shared article project ─────────────────────────────
  await openApp(ada.page)
  await ada.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await ada.page.getByRole('button', { name: 'New project' }).click()
  await ada.page.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await ada.page.getByRole('button', { name: 'Create project' }).click()

  // Share it across workspaces (the P8 bridge: shared ⇒ guarded, cooperable).
  const toggle = ada.page.getByTestId('share-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Scope the shared draft doc's connector onto the project — the D12 admitted set.
  await ada.page.getByRole('button', { name: 'Add context' }).click()
  const picker = ada.page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Connector/ }).click()
  await picker.getByRole('button', { name: /Google Drive/ }).click()
  await ada.page.keyboard.press('Escape')
  await expect(ada.page.getByText('Google Drive').first()).toBeVisible()

  // A PRIVATE control project too — Bo's tenant must never see this one.
  await ada.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await ada.page.getByRole('button', { name: 'New project' }).click()
  await ada.page.getByPlaceholder('e.g. Insights dashboard').fill(PRIVATE_PROJECT)
  await ada.page.getByRole('button', { name: 'Create project' }).click()

  // Ada's own worker agent, commissioned onto the article.
  await createAgent(ada.page, ADA_AGENT)
  await openProject(ada.page, PROJECT)
  await commission(ada.page, ADA_AGENT)
  await expect(ada.page.getByText(ADA_AGENT).first()).toBeVisible()

  // The backend id of the shared project (for the agent-runtime effect calls below).
  const graph = (await (await ada.page.request.get(`${API}/relations`)).json()) as {
    extraProjects: { id: string; name: string; shared?: boolean; guardianId?: string }[]
  }
  const project = graph.extraProjects.find((p) => p.name === PROJECT)!
  expect(project.shared).toBe(true)
  expect(typeof project.guardianId).toBe('string')

  // ── Stage B — Bo (a DIFFERENT tenant) joins with his own agent ──────────────────
  await openApp(bo.page)
  await bo.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  // The shared project is visible across the tenant boundary; the private one is not.
  await expect(bo.page.getByText(PROJECT).first()).toBeVisible()
  await expect(bo.page.getByText(PRIVATE_PROJECT)).toHaveCount(0)

  await bo.page.getByText(PROJECT).first().click()
  // Ada's Contributor shows by its SERVER-resolved public label — Bo's registry can't
  // resolve a foreign agentId; identity crosses the boundary, authority never does.
  await expect(bo.page.getByText(ADA_AGENT).first()).toBeVisible()

  await createAgent(bo.page, BO_AGENT)
  await openProject(bo.page, PROJECT)
  await commission(bo.page, BO_AGENT)
  await expect(bo.page.getByText(BO_AGENT).first()).toBeVisible()

  // Ada now sees BOTH contributors — Bo's by its public label (the P8 enrichment).
  await reloadApp(ada.page)
  await openProject(ada.page, PROJECT)
  await expect(ada.page.getByText(BO_AGENT).first()).toBeVisible()

  // ── Stage C — the agents work: claim sections, conflict, write, get credited ────
  // Ada's agent claims the introduction (held AS the commission, so its write below
  // serializes correctly at the Guardian).
  await claimAs(ada.page, ADA_AGENT, INTRO)
  await expect(ada.page.getByText(`held by ${ADA_AGENT}`)).toBeVisible()

  // Bo's agent tries the SAME section — the cross-tenant 409 surfaces as the panel's
  // conflict prompt ("conflict is a question, not an abort")…
  await reloadApp(bo.page)
  await openProject(bo.page, PROJECT)
  await expect(bo.page.getByText(`held by ${ADA_AGENT}`)).toBeVisible()
  await claimAs(bo.page, BO_AGENT, INTRO)
  await expect(bo.page.getByText(/held by another Contributor — pick a different sub-goal/)).toBeVisible()
  // …so it takes the conclusion instead.
  await claimAs(bo.page, BO_AGENT, CONCLUSION)
  await expect(bo.page.getByText(`held by ${BO_AGENT}`)).toBeVisible()

  // Both sections are in flight on ONE shared project, across two tenants.
  await reloadApp(ada.page)
  await openProject(ada.page, PROJECT)
  await expect(ada.page.getByText(INTRO)).toBeVisible()
  await expect(ada.page.getByText(CONCLUSION)).toBeVisible()

  // Each agent writes its section to the shared draft doc — the real effect route:
  // D12-clamped to the admitted connector, D11-serialized on the held sub-goal,
  // D13-credited to the agent. Fired via page.request (the agent's runtime action,
  // not a human click), under each tenant's own identity headers.
  const adaIds = await ownCommission(ada.page, project.id, ADA_AGENT)
  const boIds = await ownCommission(bo.page, project.id, BO_AGENT)

  const adaWrite = await ada.page.request.post(`${API}/projects/${project.id}/effects`, {
    data: { commissionId: adaIds.commissionId, subGoal: INTRO, type: 'connector.write', target: 'Google Drive' },
  })
  expect(adaWrite.status()).toBe(200)

  // The caller-identity wall: Bo's tenant CANNOT fire an effect under Ada's commission.
  const forged = await bo.page.request.post(`${API}/projects/${project.id}/effects`, {
    data: { commissionId: adaIds.commissionId, subGoal: CONCLUSION, type: 'connector.write', target: 'Google Drive' },
  })
  expect(forged.status()).toBe(403)

  const boWrite = await bo.page.request.post(`${API}/projects/${project.id}/effects`, {
    data: { commissionId: boIds.commissionId, subGoal: CONCLUSION, type: 'connector.write', target: 'Google Drive' },
  })
  expect(boWrite.status()).toBe(200)

  // The D13 credit is visible on each owner's OWN screen (reputation stays with the
  // agent's owner — the other tenant's registry never shows it).
  await reloadApp(ada.page)
  await openProject(ada.page, PROJECT)
  await expect(ada.page.getByTitle(/1 commissioned contribution/)).toBeVisible()
  await reloadApp(bo.page)
  await openProject(bo.page, PROJECT)
  await expect(bo.page.getByTitle(/1 commissioned contribution/)).toBeVisible()

  // The article prose itself — each user asks their agent in their OWN chat; the mock
  // model returns the canned draft (the one mocked seam). Sessions are tenant-scoped.
  await ada.page.getByRole('main').getByRole('button', { name: 'New session' }).click()
  await ada.page.getByPlaceholder('Reply to Claude…').fill('Draft the introduction of our co-authored article.')
  await ada.page.keyboard.press('Enter')
  await expect(ada.page.getByText(/One conversation that grows into a workspace/)).toBeVisible({ timeout: 20_000 })

  await bo.page.getByRole('main').getByRole('button', { name: 'New session' }).click()
  await bo.page.getByPlaceholder('Reply to Claude…').fill('Draft the conclusion of our co-authored article.')
  await bo.page.keyboard.press('Enter')
  await expect(bo.page.getByText(/One conversation that grows into a workspace/)).toBeVisible({ timeout: 20_000 })

  // Session tenancy through the UI: Ada's sidebar never lists Bo's drafting session.
  await reloadApp(ada.page)
  await expect(ada.page.getByText(/Draft the introduction of our co-authored/).first()).toBeVisible()
  await expect(ada.page.getByText(/Draft the conclusion of our co-authored/)).toHaveCount(0)

  // ── Stage D — completion: the cooperation winds down ────────────────────────────
  // Each contributor releases its finished section from its own screen…
  await openProject(ada.page, PROJECT)
  await ada.page.getByRole('button', { name: `Release ${INTRO}` }).click()
  await reloadApp(bo.page)
  await openProject(bo.page, PROJECT)
  await bo.page.getByRole('button', { name: `Release ${CONCLUSION}` }).click()

  // …and the coordination surface empties on BOTH screens: the temporary end-state of
  // the cooperation. The credit persists; nothing is left in flight.
  await expect(bo.page.getByText('No sub-goals in flight.')).toBeVisible()
  await reloadApp(ada.page)
  await openProject(ada.page, PROJECT)
  await expect(ada.page.getByText('No sub-goals in flight.')).toBeVisible()
  await expect(ada.page.getByTitle(/1 commissioned contribution/)).toBeVisible()

  await ada.context.close()
  await bo.context.close()
})
