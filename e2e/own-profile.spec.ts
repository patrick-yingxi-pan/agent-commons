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

const sectionsNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const sectionRow = (page: Page, name: string) =>
  sectionsNav(page).getByRole('button', { name, exact: true })

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
