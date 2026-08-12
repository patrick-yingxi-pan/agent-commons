import { expect, type Browser, type Page } from '@playwright/test'
import assert from 'node:assert/strict'
import { ms } from './budget.ts'

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

export const STAMP = Date.now().toString(36)
export const PROJECT = `Social walk ${STAMP}`
export const LINK_PROJECT = `Link walk ${STAMP}`
export const NOTE = `Fresh off the press ${STAMP}`
export const COMMENT = `One suggestion incoming ${STAMP}`
export const CHANGE = `Lead with the retention metric ${STAMP}`
export const TURN_POST = `About this step specifically ${STAMP}`
export const TURN_REPLY = `Still this step ${STAMP}`
export const GUEST_POST = `A question about this exact step ${STAMP}`
export const RUN_POST = `This run failed on the label step ${STAMP}`
export const ARTIFACT = 'insights-onepager.md'
export const ROUTINE = '/scheduled/s-issue-triage'
export const NEW_CADENCE = `Every 9 hours ${STAMP}`
export const ROUTINE_CHANGE = `Move this to 09:00 — 08:00 lands before the data does ${STAMP}`
/** A seeded multi-turn conversation, opened by its canonical URL (every page
 *  has one — src/CLAUDE.md). The walk asserts the turn count, so a reseed that
 *  shortens this thread fails loudly rather than passing vacuously. */
export const TURN_SESSION = '/s/auth-refactor'
export const API = '/api/v1'

export async function gotoSection(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

export async function createProject(page: Page, name: string) {
  await gotoSection(page, 'Projects')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByPlaceholder('e.g. Insights dashboard').fill(name)
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

export async function openProject(page: Page, name: string) {
  await gotoSection(page, 'Projects')
  await page.getByText(name).first().click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/** The created project's backend id, through the same tenant-scoped API the UI reads. */
export async function projectId(page: Page, name: string) {
  const graph = (await (await page.request.get(`${API}/relations`)).json()) as {
    extraProjects: { id: string; name: string }[]
  }
  const row = graph.extraProjects.find((p) => p.name === name)
  expect(row, `project '${name}' in the relation graph`).toBeTruthy()
  return row!.id
}

export async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  const page = await context.newPage()
  return { context, page }
}

/** Ada's profile, reached the way the product offers it — a byline door on a
 *  Commons card, not `page.goto('/u/Ada Lovelace')`. An in-page door is the
 *  truer walk: it proves the byline IS a door, which a deep link never does.
 *  (It was also once the only walk that worked — the seed namespace was named
 *  "Acme, Inc." then, and Vite's dev history fallback treats a dotted path as a
 *  FILE request, so that deep link never reached the SPA at all.) */
export async function openAdaProfile(page: Page) {
  await gotoSection(page, 'Commons')
  await page.getByRole('button', { name: 'by Ada Lovelace', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible({ timeout: ms(20_000) })
}
