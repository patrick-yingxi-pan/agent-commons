/** ── The standing door to your own public face (owner directive, 2026-08-09) ──
 *  Every namespace in this product has a profile you reach by clicking its name
 *  — a byline, a follower row, an @-mention. Yours was the one with no door: you
 *  could see everyone's public face except your own.
 *
 *  The door is a rail child under the **Commons**, not under the account chip:
 *  a profile is a SOCIAL page, not an account setting (the chip switches WHO YOU
 *  ARE; this goes to WHAT YOU LOOK LIKE to everyone else). Which made the
 *  section that had been hosting profiles wrong — `agents`, an accident of the
 *  Discover directory — and the rail was where it showed: opening any profile
 *  lit and auto-expanded the Agents row. Both halves are walked here, because
 *  the highlight is the part a DOM-free test cannot see.
 *
 *  The node suites lock the funnel and the registries (src/lib/owner-door.test.ts,
 *  src/lib/url-routes.test.ts); this locks the wiring. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { organizePane } from './pane-actions.ts'

const sectionsNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const sectionRow = (page: Page, name: string) =>
  sectionsNav(page).getByRole('button', { name, exact: true })
const PROFILE_SECTION_LABELS = [
  'Network',
  'Shared projects',
  'Commons activity',
  'Published agents',
  'Recent public activity',
]

test('the Commons carries a door to your own profile, and holds the highlight', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')
  await expect(sectionRow(page, 'Projects')).toBeVisible()

  // The name the door must open is the NAMESPACE's, not the person's — a
  // profile is a namespace's face (the server's rule is `tenantName === name`).
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    user: { name: string }
    tenant: { name: string }
  }
  const namespace = me.tenant.name
  expect(namespace, 'the boot identity carries a namespace name').toBeTruthy()

  // Conversation history heads the account-resource forest; the shared social
  // root follows it. Neither is hidden in a utility container.
  const roots = sectionsNav(page).locator('[data-rail-entry-kind="root"] > button[data-rail-entry]')
  await expect(roots.nth(0)).toContainText('Sessions')
  await expect(roots.nth(1)).toContainText('Commons')

  // ── Expand Commons: the shared fixed-child projection owns this order ────
  const expand = sectionsNav(page).getByRole('button', { name: 'Expand Commons' })
  if (await expand.count()) await expand.click()
  const door = sectionsNav(page).getByRole('button', { name: 'Your profile', exact: true })
  await expect(door).toBeVisible()
  const children = sectionsNav(page).getByRole('button', {
    name: /^(Your profile|Following|Watched|Liked|Posted|Recently viewed)$/,
  })
  await expect(children.first()).toHaveText('Your profile')

  // ── The door opens the profile's OWN canonical address ──────────────────────
  await door.click()
  await expect(page).toHaveURL(new RegExp(`/u/${encodeURIComponent(namespace).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  // The page knows it is yours (publicFace's `profileTitle(name, own)`), which
  // is also the proof the server served YOUR profile rather than a stranger's
  // 404 face — an own profile serves however empty.
  await expect(page.getByRole('heading', { name: `${namespace} (you)` })).toBeVisible()

  // ── Projection symmetry: the profile is a composite branch whose ordered
  //    section rows are the main page's ordered structural sections ──────────
  const profileTree = sectionsNav(page).locator(`[data-owner-profile-tree="${namespace}"]`)
  const railSections = profileTree.locator('[data-owner-profile-section] > button[data-rail-entry]')
  const expectedSections = PROFILE_SECTION_LABELS
  await expect(railSections).toHaveText(expectedSections)
  const mainSections = page.getByRole('main').locator('[data-resource-page-section]')
  await expect(mainSections).toHaveCount(expectedSections.length)
  expect(await mainSections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-resource-section'))))
    .toEqual(expectedSections)

  // A section name is a real page door, not an inert table-of-contents label.
  const network = profileTree.getByRole('button', { name: 'Network', exact: true })
  await network.click()
  await expect(page).toHaveURL(new RegExp(`/u/${encodeURIComponent(namespace).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/network$`))
  await expect(network).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('main').locator('[data-resource-page-section]')).toHaveCount(1)
  await expect(page.getByRole('main').locator('[data-resource-page-section]')).toHaveAttribute('data-resource-section', 'Network')

  // Return to the profile overview before checking its standing highlight.
  await door.click()
  await expect(page).toHaveURL(new RegExp(`/u/${encodeURIComponent(namespace).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))

  // ── The highlight: the CHILD is current, its parent is not, and Agents —
  //    which used to claim every profile — is untouched ──────────────────────
  await expect(door).toHaveAttribute('aria-current', 'page')
  await expect(sectionRow(page, 'Commons')).not.toHaveAttribute('aria-current', 'page')
  await expect(sectionRow(page, 'Agents')).not.toHaveAttribute('aria-current', 'page')

  // ── A reload proves the address, not just the click: the same page comes
  //    back, still under the Commons, with the child still lit ───────────────
  await page.reload()
  await expect(page.getByRole('heading', { name: `${namespace} (you)` })).toBeVisible()
  const doorAfter = sectionsNav(page).getByRole('button', { name: 'Your profile', exact: true })
  await expect(doorAfter).toHaveAttribute('aria-current', 'page')
  await expect(sectionRow(page, 'Agents')).not.toHaveAttribute('aria-current', 'page')
})

test('rail organization folds the selected profile root and can fold or unfold the entire panel', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const me = (await (await page.request.get('/api/v1/me')).json()) as { tenant: { name: string } }
  const namespace = me.tenant.name
  await page.goto(`/u/${encodeURIComponent(namespace)}`)
  await expect(page.getByRole('heading', { name: `${namespace} (you)` })).toBeVisible()

  const rail = sectionsNav(page)
  const profile = rail.getByRole('button', { name: 'Your profile', exact: true })
  await profile.click()
  await expect(rail.getByRole('button', { name: 'Collapse Your profile', exact: true })).toBeVisible()

  await organizePane(page, 'Fold all')
  await expect(rail.getByRole('button', { name: 'Expand Your profile', exact: true })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Collapse Commons', exact: true })).toBeVisible()

  await organizePane(page, 'Fold entire panel')
  await expect(rail.getByRole('button', { name: /^Collapse / })).toHaveCount(0)
  await expect(rail.locator(`[data-owner-profile-tree="${namespace}"]`)).toHaveCount(0)

  await organizePane(page, 'Unfold entire panel')
  await expect(rail.getByRole('button', { name: 'Collapse Commons', exact: true })).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Collapse Your profile', exact: true })).toBeVisible()
  await expect(rail.locator(`[data-owner-profile-tree="${namespace}"]`)).toBeAttached()
})

async function switchTo(page: Page, name: string) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(name)
}

async function expectOwnProfileSymmetry(page: Page, name: string) {
  await page.goto(`/u/${encodeURIComponent(name)}`)
  await expect(page.getByRole('heading', { name: `${name} (you)` })).toBeVisible()
  const profileTree = sectionsNav(page).locator(`[data-owner-profile-tree="${name}"]`)
  await expect(profileTree.locator('[data-owner-profile-section] > button[data-rail-entry]')).toHaveText(PROFILE_SECTION_LABELS)
  const mainSections = page.getByRole('main').locator('[data-resource-page-section]')
  await expect(mainSections).toHaveCount(PROFILE_SECTION_LABELS.length)
  expect(await mainSections.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-resource-section'))))
    .toEqual(PROFILE_SECTION_LABELS)
}

test('stacked test accounts keep profile symmetry and a foreign profile never claims Your profile', async ({ page }) => {
  test.setTimeout(ms(120_000))
  for (const [email, password] of [
    ['ada@acme.example', 'ada-demo-password'],
    ['grace@acme.example', 'grace-demo-password'],
    ['maya@growthworks.example', 'maya-demo-password'],
  ] as const) {
    const login = await page.request.post('/api/v1/auth/login', { data: { email, password } })
    expect(login.ok()).toBeTruthy()
  }
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Maya Chen')

  await expectOwnProfileSymmetry(page, 'Maya Chen')
  await switchTo(page, 'Grace Hopper')
  await expectOwnProfileSymmetry(page, 'Grace Hopper')

  // Maya can open Ada's public face, but the standing door still belongs to
  // Maya's own namespace and therefore cannot claim the foreign profile page.
  await switchTo(page, 'Maya Chen')
  await page.goto('/u/Ada%20Lovelace')
  await expect(page.getByRole('heading', { name: 'Ada Lovelace', exact: true })).toBeVisible()
  await expect(sectionsNav(page).getByRole('button', { name: 'Your profile', exact: true })).not.toHaveAttribute('aria-current', 'page')

  // Hand the stacked test context back to the flagship account.
  await switchTo(page, 'Ada Lovelace')
  await expectOwnProfileSymmetry(page, 'Ada Lovelace')
})
