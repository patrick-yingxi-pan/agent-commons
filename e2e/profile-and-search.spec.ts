import { test, expect, type Browser, type Page } from '@playwright/test'

/** D21/D22 — the findability layer, end to end through the rendered UI: the
 *  workspace PROFILE page (a display name's one public face, reached from any owner
 *  byline) and GLOBAL SEARCH (the ⌘K palette answering with server-side typed groups
 *  across private + commons, every hit a deep link). Two tenants again (the F2
 *  header seam, like co-author-article.spec.ts): the owner builds a public face;
 *  a FOREIGN tenant finds it — by byline, and by search. */

const STAMP = Date.now().toString(36)
const PROJECT = `Findable atlas ${STAMP}`
const AGENT = `Atlas Guide ${STAMP}`
const API = '/api/v1'

async function dismissIntro(page: Page, timeout = 2_500) {
  await page
    .getByRole('button', { name: 'Explore on my own' })
    .click({ timeout })
    .catch(() => {})
}

async function openApp(page: Page) {
  await page.goto('/')
  await dismissIntro(page, 5_000)
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

test('a workspace profile is reachable from any byline, and global search finds the commons', async ({ browser }) => {
  test.setTimeout(120_000)
  const owner = await newUser(browser) // the seeded default tenant
  const visitor = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })

  // ── The owner builds a public face: a shared project + a published agent ──────
  await openApp(owner.page)
  await owner.page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await owner.page.getByRole('button', { name: 'New project' }).click()
  await owner.page.getByPlaceholder('e.g. Insights dashboard').fill(PROJECT)
  await owner.page.getByRole('button', { name: 'Create project' }).click()
  const share = owner.page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')

  // The agent: created in the hub, published via the same authenticated boundary the
  // UI uses (publishing itself is locked by the D18 suites; this spec is findability).
  const created = await owner.page.request.post(`${API}/agents`, {
    data: { label: AGENT, systemPrompt: 'guide well', tools: [], instructions: 'be findable' },
  })
  expect(created.status()).toBe(200)
  const agentId = ((await created.json()) as { id: string }).id
  const published = await owner.page.request.patch(`${API}/agents/${agentId}`, { data: { published: true } })
  expect(published.status()).toBe(200)

  // The owner's public display name, exactly as the directory redaction serves it.
  const dir = (await (await visitor.page.request.get(`${API}/directory/projects`)).json()) as {
    name: string
    owner: string
  }[]
  const ownerName = dir.find((p) => p.name === PROJECT)?.owner
  expect(ownerName, 'the shared project is in the directory with a public owner').toBeTruthy()

  // ── The byline door: Discover card → the owner's profile page (D21) ───────────
  await openApp(visitor.page)
  await visitor.page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  await visitor.page.getByRole('button', { name: 'Discover' }).click()
  await expect(visitor.page.getByText(PROJECT).first()).toBeVisible()
  await visitor.page
    .getByRole('button', { name: `by ${ownerName}`, exact: true })
    .first()
    .click()

  // One page, the whole public face: title, tagline, both directories, the acts.
  await expect(visitor.page.getByRole('heading', { name: ownerName })).toBeVisible()
  await expect(visitor.page.getByText('Public workspace profile — everything this workspace shares.')).toBeVisible()
  await expect(visitor.page.getByText(PROJECT).first()).toBeVisible()
  await expect(visitor.page.getByText(AGENT).first()).toBeVisible()
  // Viewer-relative own-marker: the visitor sees the bare name, no "(you)".
  await expect(visitor.page.getByRole('heading', { name: `${ownerName} (you)` })).toHaveCount(0)

  // The profile's project card is a door to the ONE shared project page.
  await visitor.page.getByRole('button', { name: 'Open project' }).first().click()
  await expect(visitor.page.getByRole('heading', { name: PROJECT })).toBeVisible()

  // ── Global search (D22): the palette answers across the commons, hits deep-link ──
  await visitor.page.getByRole('button', { name: 'Search', exact: true }).click()
  const palette = visitor.page.getByRole('dialog', { name: 'Search' })
  await palette.getByRole('textbox').fill(PROJECT)
  // A FOREIGN shared project surfaces in the commons group (never "Your projects").
  await expect(palette.getByText('Shared projects', { exact: false })).toBeVisible()
  await expect(palette.getByText('Your projects')).toHaveCount(0)
  await palette.getByRole('button', { name: new RegExp(PROJECT) }).click()
  await expect(visitor.page.getByRole('heading', { name: PROJECT })).toBeVisible()

  // Workspaces are entities too: searching the owner's NAME finds the profile (D21).
  await visitor.page.getByRole('button', { name: 'Search', exact: true }).click()
  await palette.getByRole('textbox').fill(ownerName!)
  await expect(palette.getByText('Workspaces')).toBeVisible()
  await palette.getByRole('button', { name: new RegExp(`^${ownerName}`) }).first().click()
  await expect(visitor.page.getByRole('heading', { name: ownerName })).toBeVisible()
  await expect(visitor.page.getByText('Public workspace profile — everything this workspace shares.')).toBeVisible()

  await owner.context.close()
  await visitor.context.close()
})
