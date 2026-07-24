/** The back-history rule (ADAPT-18, src/lib/paneHistory.ts): every page opened
 *  by clicking WITHIN a page carries a back affordance to the page that opened
 *  it — across section boundaries and across the page↔conversation line — and
 *  the browser's Back/Forward walk the same per-page model (pop the focused
 *  pane's own history; refocus the pane a focus-hop entry names; never clobber
 *  a pane with a duplicate). The model is locked by tests/pane-history.test.ts;
 *  this locks the wiring end to end. */
import { test, expect, type Page } from '@playwright/test'

/** Close the auto-tiled context panel so scenarios start from one clean pane
 *  (same helper as main-split.spec.ts). */
async function clearAutoPanel(page: Page) {
  const ctx = page.locator('[data-context-pane]')
  if ((await ctx.count()) === 0) return
  await ctx.first().dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
}

test('a session opened from a project page carries a back CHAIN — to the page, and through it to the list', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  // List → detail (the pane's local stack) → a session ROW (an in-page door:
  // the pane becomes the conversation, the whole in-section history folded
  // onto its back stack).
  // Scoped to the page: the rail lists projects too (UI-19), and clicking the
  // RAIL row is a chrome door — it resets the back stack instead of building
  // the chain this test is about.
  const main = page.locator('[data-main-pane]')
  await main.getByText('Platform hardening').first().click()
  await expect(page.getByText('The platform team')).toBeVisible()
  await main.getByText('Refactor auth middleware').first().click()
  await expect(page.locator('[data-conversation-pane="auth-refactor"]')).toBeVisible()
  await expect(page).toHaveURL(/\/s\/auth-refactor$/)
  await clearAutoPanel(page)

  // The conversation's title bar leads with the ONE back control, NAMING the
  // origin page (the violation this rule fixed: sessions opened from pages
  // had no way back at all).
  const bar = page.locator('[data-session-title-bar]')
  await bar.getByRole('button', { name: 'Back to Platform hardening' }).click()
  await expect(page.getByText('The platform team')).toBeVisible()
  await expect(page).toHaveURL(/\/projects\/p-infra$/)

  // The chain continues: the project page's back returns to the LIST it was
  // opened from (the folded in-section history — a cross-boundary door used
  // to amputate it), where the walk ends (no arrow on a history-less hub).
  await page.getByRole('button', { name: 'Back to Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.getByRole('button', { name: /^Back to / })).toHaveCount(0)
})

test("a conversation's breadcrumb page carries back to the conversation (page ↔ session, both directions)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // The title bar's home-project breadcrumb is an in-page door: the project
  // page opens IN the pane with the conversation pushed as its origin.
  await page.locator('[data-session-title-bar]').getByRole('button', { name: 'In Platform hardening' }).click()
  await expect(page.getByText('The platform team')).toBeVisible()
  await expect(page).toHaveURL(/\/projects\/p-infra$/)

  // Its back control names the CONVERSATION (the carried session title —
  // resolved when you leave it) and returns there.
  await page.getByRole('button', { name: 'Back to Refactor auth middleware' }).click()
  await expect(page.locator('[data-conversation-pane="auth-refactor"]')).toBeVisible()
  await expect(page).toHaveURL(/\/s\/auth-refactor$/)
})

test('browser Back after a FOCUS HOP refocuses the pane that projected the address — never clobbers with a duplicate', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Two panes: the conversation (a) and Projects (b, focused). Hop a → b so
  // the history holds both panes' addresses as focus-hop entries.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const paneA = page.locator('[data-main-pane="a"]')
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  await paneA.dispatchEvent('pointerdown')
  await expect(page).toHaveURL(/\/s\/auth-refactor$/)
  await paneB.dispatchEvent('pointerdown')
  await expect(page).toHaveURL(/\/projects$/)

  // Browser Back: the previous address belongs to pane A — it is REFOCUSED
  // (the pre-fix behavior retargeted the focused pane, minting a duplicate
  // conversation over Projects and destroying the layout).
  await page.goBack()
  await expect(page).toHaveURL(/\/s\/auth-refactor$/)
  await expect(paneA).toHaveAttribute('data-focused', 'true')
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()

  // Browser Forward: pane B already shows /projects — refocused the same way.
  await page.goForward()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(paneB).toHaveAttribute('data-focused', 'true')
  await expect(paneA.getByText('token refresh logic').first()).toBeVisible()
})

test("browser Back walks the pane's OWN history per page (the pop arm keeps the deeper chain)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  // list → detail → session: three history entries in one pane.
  await page.getByText('Platform hardening').first().click()
  await expect(page).toHaveURL(/\/projects\/p-infra$/)
  await page.locator('[data-main-pane]').getByText('Refactor auth middleware').first().click()
  await expect(page.locator('[data-conversation-pane="auth-refactor"]')).toBeVisible()
  await clearAutoPanel(page)

  // Back: the address matches the conversation's back TOP → the pane POPS to
  // the project page (still one pane), with the deeper chain intact — its
  // in-page back still names the list (a plain retarget would have lost it).
  await page.goBack()
  await expect(page.getByText('The platform team')).toBeVisible()
  await expect(page).toHaveURL(/\/projects\/p-infra$/)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Back to Projects' })).toBeVisible()

  // Back again: pops the remaining entry — the list.
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)
})
