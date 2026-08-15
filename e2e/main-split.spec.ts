/** The MAIN workspace split, focused-pane model (universal split, ADAPT-17):
 *  the rail's split/close cluster (beside the bell) acts on the FOCUSED pane —
 *  the split buttons DUPLICATE it (no picker, no per-pane chrome), and close
 *  is HOMOGENEOUS: a secondary pane collapses, while closing the primary tile
 *  relocates the primary role into the surviving pane (its content promotes
 *  into the controller); rail navigation retargets the focused pane; and the
 *  ADDRESS BAR PROJECTS THE FOCUSED PANE (Phase 6): retargeting or focusing a
 *  page pane rewrites the URL to its canonical location; a focused NON-page
 *  pane (a context panel) defers to the page you're on. The tree math is
 *  locked by src/lib/main-split.test.ts; this locks the wiring. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

/** A repo / workspace session auto-tiles its context PANEL as a pane in the
 *  universal tree on the wide tier (ADAPT-16 folded into ADAPT-17). Close it so
 *  the split mechanics below start from a clean single conversation pane
 *  (Phase 6: ONE pane is a normal tree — the container remains). */
async function clearAutoPanel(page: Page) {
  const ctx = page.locator('[data-context-pane]')
  if ((await ctx.count()) === 0) return
  await ctx.first().dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
}

test('split duplicates the focused conversation; the rail retargets the focused pane; close dissolves', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // The rail offers BOTH directions on the wide tier, next to the bell.
  await expect(page.locator('[data-split-view="col"]')).toBeVisible()
  await page.locator('[data-split-view="row"]').click()

  // The frame is up: pane a is the primary; pane b is a DUPLICATE of the same
  // conversation (no picker step), and it took focus.
  await expect(page.locator('[data-main-split]')).toBeVisible()
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.locator('[data-conversation-pane="auth-refactor"]')).toBeVisible()
  await expect(paneB).toHaveAttribute('data-focused', 'true')

  // Rail navigation lands in the FOCUSED pane: clicking Projects retargets pane
  // b in place — the primary keeps its content, and the ADDRESS follows the
  // focused pane to its canonical location (URL-follows-focus, Phase 6).
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()

  // Focus hopping IS a navigation: clicking into pane a (the conversation)
  // rewrites the address to ITS location; back into pane b, to the section's.
  await page.locator('[data-main-pane="a"]').dispatchEvent('pointerdown')
  await expect(page).toHaveURL(/\/s\/auth-refactor$/)
  await paneB.dispatchEvent('pointerdown')
  await expect(page).toHaveURL(/\/projects$/)

  // Pane-local navigation: a project detail opens INSIDE the pane — and the
  // pane REPORTS its live location, so the address deepens to /projects/:id
  // (full URL fidelity from a focused pane, Phase 6 step 4).
  await paneB.getByText('Platform hardening').first().click()
  await expect(paneB.getByText('The platform team')).toBeVisible()
  await expect(page).toHaveURL(/\/projects\/[^/]+$/)
  // Hopping to pane a and back restores the DEEP address, not the section root.
  await page.locator('[data-main-pane="a"]').dispatchEvent('pointerdown')
  await expect(page).toHaveURL(/\/s\/auth-refactor$/)
  await paneB.dispatchEvent('pointerdown')
  await expect(page).toHaveURL(/\/projects\/[^/]+$/)

  // The main-pane divider is a named, keyboard-operable separator (UI-11).
  await expect(page.getByRole('separator', { name: 'Resize view panes (root)' })).toBeVisible()

  // No per-pane chrome at all: close lives in the rail cluster and acts on the
  // FOCUSED pane — homogeneously. Focus pane b (secondary) and close: it
  // collapses, the frame dissolves, the primary conversation survives.
  // (dispatchEvent: focus rides pointer-down capture, and actionability would
  // wait forever on the thread's continuous animations.)
  await paneB.dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
})

test('ONE close rule for every page; closing the LAST page leaves the BACKGROUND, and the rail repopulates it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split (duplicate takes focus), retarget the duplicate at Projects.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()

  // Close the CONVERSATION pane (every pane closes equally — no privileged
  // tile): Projects inherits the whole surface, focus falls to it, and the
  // ADDRESS follows the surviving focused pane.
  await page.locator('[data-main-pane="a"]').dispatchEvent('pointerdown')
  await expect(page.locator('[data-close-view]')).toBeVisible()
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  await expect(page.getByText('Platform hardening').first()).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)

  // Closing the LAST page leaves the BACKGROUND (the owner's model: the tree
  // may reach zero panes — not an implicit un-split surface)…
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-background]')).toBeVisible()
  await expect(page.locator('[data-main-pane]')).toHaveCount(0)

  // …and the rail repopulates it: New session mints the first pane (a fresh
  // draft, the address at the root).
  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.locator('[data-conversation-pane="draft"]')).toBeVisible()
  await expect(page.getByText('What should we work on?')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
})

test('focus moves on pointer-down, and the split buttons act on the focused pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split down: the duplicate below takes focus.
  await page.locator('[data-split-view="col"]').click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB).toHaveAttribute('data-focused', 'true')

  // Clicking back into the primary moves focus there…
  await page.locator('[data-main-pane="a"]').getByText('token refresh logic').first().click()
  await expect(page.locator('[data-main-pane="a"]')).toHaveAttribute('data-focused', 'true')

  // …so the next split acts on the PRIMARY pane: its slot subdivides (paths aa/ab)
  // while pane b stays put.
  await page.locator('[data-split-view="row"]').click()
  await expect(page.locator('[data-main-pane="aa"]')).toBeVisible()
  await expect(page.locator('[data-main-pane="ab"]')).toBeVisible()
  await expect(page.locator('[data-main-pane="b"]')).toBeVisible()
})

test('a duplicated conversation pane is fully independent: its own composer streams its own reply', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split, then retarget the focused duplicate at a DIFFERENT seeded session
  // via the rail's Recents list.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('aside').getByText('Dashboard query performance').first().click()
  const pane = page.locator('[data-conversation-pane="dashboard-perf"]')
  await expect(pane).toBeVisible()

  // Homogeneous title bars: the pane wears the SAME SessionTitleBar the primary
  // wears — with several conversations tiled, each names itself.
  await expect(pane.locator('[data-session-title-bar]').getByText('Dashboard query performance')).toBeVisible()
  await expect(page.locator('[data-main-pane="a"] [data-session-title-bar]').getByText('Refactor auth middleware')).toBeVisible()

  // Send FROM THE PANE — the reply streams into the pane's thread…
  // The pane carries the FULL composer now (the shared ConversationView) — its
  // textarea is the same primitive the primary's composer renders.
  const composer = pane.locator('textarea')
  await composer.fill('quick pane check')
  await composer.press('Enter')
  await expect(pane.getByText('quick pane check')).toBeVisible()
  await expect(pane.getByText(/local mock|workspace/).last()).toBeVisible({ timeout: ms(15_000) })

  // …while the PRIMARY (auth-refactor) is untouched; the address names the
  // FOCUSED pane's session (URL-follows-focus).
  await expect(page.locator('[data-main-pane="a"]').getByText('quick pane check')).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/s/dashboard-perf')
})

test('a section page + its detail render correctly in a HALF-WIDTH pane — no horizontal overflow (pages are pane-safe, UI-9)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split, then retarget the focused pane at a content-dense section page — the
  // SAME SectionView the primary mounts (single-column on every tier, no
  // viewport-width assumption), now in a pane ~half the viewport wide.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()

  const paneBox = (await paneB.boundingBox())!
  expect(paneBox.width, 'the pane is roughly half-width').toBeLessThan(760)
  // Nothing overflows horizontally — not the document, not the pane itself. A
  // page that assumed the full viewport width would blow past the pane here.
  const docHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(docHScroll, 'no document horizontal scroll with a section tiled in a pane').toBe(false)
  const listHScroll = await paneB.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(listHScroll, 'the section list fits the pane (inner scrollers aside)').toBe(false)

  // A DETAIL page opens INSIDE the pane (pane-local nav) and fits too.
  await paneB.getByText('Platform hardening').first().click()
  await expect(paneB.getByText('The platform team')).toBeVisible()
  const detailHScroll = await paneB.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(detailHScroll, 'the project DETAIL page fits the pane').toBe(false)

  // The PROJECT detail has no side column to stack any more — it is one column
  // of foldable sections at every width (owner directive 2026-08-12). Asserted
  // as an absence rather than deleted, because "no aside" is now the claim: this
  // arm used to prove the two columns stacked here, and a silent removal would
  // leave the walk looking like it still checked something about them.
  await expect(paneB.locator('aside')).toHaveCount(0)

  // A routine is the other composite resource. It uses the same one-column
  // page grammar in this half-width pane; configuration is folded into the
  // flow instead of restored as a squeezed side rail.
  await page
    .locator('nav[aria-label="Sections"]')
    .getByRole('button', { name: 'Scheduled', exact: true })
    .filter({ has: page.locator('svg') })
    .click()
  await paneB.getByText('Triage new GitHub issues').first().click()
  await expect(paneB.locator('aside')).toHaveCount(0)
  await expect(paneB.getByText('Instruction', { exact: true })).toBeVisible()
  await expect(paneB.getByText('Recent runs', { exact: true })).toBeVisible()
  const routineHScroll = await paneB.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(routineHScroll, 'and the one-column page still fits the pane').toBe(false)
})

test('New session lands in the FOCUSED pane and materializes in place — the primary keeps its content', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split (the duplicate takes focus), then New session: the FOCUSED pane
  // hosts the fresh draft — the primary conversation stays put (it used to
  // always snap the draft onto the primary, regardless of focus).
  await page.locator('[data-split-view="row"]').click()
  await page.getByRole('button', { name: 'New session' }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()
  await expect(paneB.locator('[data-session-title-bar]').getByText('New session')).toBeVisible()
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
  // The focused pane IS the fresh draft — the address projects it (the root).
  expect(new URL(page.url()).pathname).toBe('/')

  // Sending FROM the draft pane materializes it IN PLACE through the shared
  // draft funnel: the pane retargets to the real session id, the reply
  // streams there, and the ADDRESS follows the focused pane onto the real id.
  const composer = paneB.locator('textarea')
  await composer.fill('draft in a pane')
  await composer.press('Enter')
  // (.first(): the materialized session is TITLED from the first message, so
  // the text appears in the pane's title bar AND the thread — both correct.)
  await expect(paneB.getByText('draft in a pane').first()).toBeVisible()
  await expect(paneB.locator('[data-conversation-pane]')).not.toHaveAttribute('data-conversation-pane', 'draft', { timeout: ms(15_000) })
  await expect(paneB.getByText(/local mock|workspace/).last()).toBeVisible({ timeout: ms(15_000) })
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
  const materialized = new URL(page.url()).pathname
  expect(materialized).toMatch(/^\/s\//)
  expect(materialized).not.toBe('/s/auth-refactor')
})

test('a RETURNING visitor’s deep link opens what it names (the boot address wins over the restored tree)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  // First visit persists a tree (the fresh draft pane) — every returning
  // browser has one, so the deep link must route INTO the restored tree
  // rather than being swallowed by it (the pre-fix bug: the address applied
  // to the retired singleton and was then silently rewritten).
  await page.goto('/')
  await expect(page.getByText('What should we work on?')).toBeVisible()
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
})

test('a RELOAD restores a pane to its deep page — the reported location persists and round-trips', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByText('Platform hardening').first().click()
  await expect(page.getByText('The platform team')).toBeVisible()
  await expect(page).toHaveURL(/\/projects\/[^/]+$/)
  const deep = new URL(page.url()).pathname

  // The boots-twice rule (the Phase 6 lesson): the persisted tree carries the
  // pane's reported location, so a reload lands back ON the detail page with
  // the same address — not the section root.
  await page.reload()
  await expect(page.getByText('The platform team')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(deep)
})

test('the fresh draft is an EQUAL page: a lone draft splits, and every view of it is identical', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  await expect(page.getByText('What should we work on?')).toBeVisible()
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)

  // A lone fresh draft SPLITS like any page (it used to be the one view that
  // couldn't — "no duplicable identity"): the duplicate is a second view of
  // the same draft entry.
  await page.locator('[data-split-view="row"]').click()
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)

  // Homogeneous: BOTH views wear the SessionTitleBar ("New session") and the
  // SAME empty-state surface with the FWD-1 launcher — a draft looks identical
  // wherever it renders.
  for (const p of ['a', 'b']) {
    const pane = page.locator(`[data-main-pane="${p}"]`)
    await expect(pane.locator('[data-session-title-bar]').getByText('New session')).toBeVisible()
    await expect(pane.getByText('What should we work on?')).toBeVisible()
    await expect(pane.getByText('Start with a repo, folder, or connector…')).toBeVisible()
  }
})

test('an entity door inside a pane-hosted section page stays IN THE PANE (the nav-bridge override)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split, retarget the focused pane at Contexts.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Contexts', { exact: true }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByPlaceholder(/Search contexts/)).toBeVisible()

  // Click a connector row: its detail page opens INSIDE the pane — this door
  // routes through the useRelations().navigate bridge, which the pane's
  // SectionNavOverride resolves pane-locally (it used to escape and open the
  // detail on the PRIMARY, the reported bug).
  await paneB.getByRole('button').filter({ hasText: 'GitHub' }).first().click()
  await expect(paneB.getByText('Disconnect').first()).toBeVisible()
  const atomicAside = paneB.locator('aside')
  await expect(atomicAside).toHaveCount(1)
  const atomicStacked = await paneB.evaluate((el) => {
    const aside = el.querySelector('aside')!
    const main = aside.parentElement!.firstElementChild!
    return aside.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 4
  })
  expect(atomicStacked, 'an atomic detail side column yields to the pane container').toBe(true)

  // The primary is untouched; the address names the focused pane's DEEP page
  // (the connector's detail — the pane reports its live location).
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toMatch(/^\/contexts\/[^/]+$/)
})

test('an entity DOOR (the ⌘K palette) lands in the FOCUSED pane, detail open — the primary untouched', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split; the focused duplicate is where doors land now.
  await page.locator('[data-split-view="row"]').click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB).toHaveAttribute('data-focused', 'true')

  // A palette hit is a DOOR from the chrome (not a pane click, so focus stays
  // on pane b): it opens the project DETAIL inside the focused pane, seeded.
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const palette = page.getByRole('dialog', { name: 'Search' })
  await palette.getByRole('textbox').fill('Platform hardening')
  await palette.getByRole('button', { name: /Platform hardening/ }).first().click()
  await expect(paneB.getByText('The platform team')).toBeVisible()
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
})

test('a run session is ONE surface: run history floats as a click-down, never a second pane (UI-15)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  // The routine name now honestly opens the composite parent (UI-28), while
  // its disclosed run child opens the run SESSION. That child still fills the
  // focused pane ALONE — no run-switcher pane tiles beside it (the old
  // two-split-windows look this locks out).
  const scheduled = page.locator('[data-rail-pane="scheduled"]')
  const routineToggle = scheduled.getByRole('button', { name: /^(Expand|Collapse) Triage new GitHub issues$/ })
  if ((await routineToggle.getAttribute('aria-expanded')) === 'false') await routineToggle.click()
  const routineTree = scheduled.locator('[data-routine-tree="s-issue-triage"]')
  const runsToggle = routineTree.getByRole('button', { name: /^(Expand|Collapse) Recent runs$/ })
  if ((await runsToggle.getAttribute('aria-expanded')) === 'false') await runsToggle.click()
  await routineTree.getByRole('button', { name: 'Labeled 11 issues, drafted 6 replies' }).click()
  await expect(page).toHaveURL(/\/s\/srun-/)
  await expect(page.locator('[data-context-pane]'), 'no runs pane tiles beside the thread').toHaveCount(0)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  const firstUrl = new URL(page.url()).pathname

  // RELOAD on the run session's own address: the boot dedup FOCUSES the
  // restored pane (already focused — no focusedPath change), so the boot
  // latch must self-release or every later URL push stays held (the
  // reload-then-navigate address freeze this run-switch would then hit).
  await page.reload()
  await expect(page.locator('[data-session-title-bar]')).toBeVisible()

  // The title bar carries the floating run-history click-down.
  const bar = page.locator('[data-session-title-bar]')
  await bar.getByRole('button', { name: 'Run history' }).click()
  const menu = page.locator('[data-run-history]')
  await expect(menu).toBeVisible()

  // Selecting a DIFFERENT run retargets the SAME pane in place: the URL moves
  // to the sibling run's session, the layout stays one pane, and the popover
  // dismissed on selection.
  await menu.getByRole('button').filter({ hasText: /steps/ }).last().click()
  await expect
    .poll(async () => new URL(page.url()).pathname, { message: 'the click navigates to another run session' })
    .not.toBe(firstUrl)
  expect(new URL(page.url()).pathname).toMatch(/^\/s\/srun-/)
  await expect(menu).toHaveCount(0)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
})

test('the right panel folds into the tree: a repo session tiles its context PANEL beside the conversation (ADAPT-16 → ADAPT-17)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()

  // The right panel is no longer a separate frame that splits its own inner
  // view — it's a `context-panel` PANE in the ONE universal main tree, beside
  // the conversation, auto-tiled from the session's remembered/strongest context.
  await expect(page.locator('[data-split-frame]'), 'the ADAPT-16 frame is retired').toHaveCount(0)
  await expect(page.locator('[data-main-split]')).toBeVisible()
  const ctx = page.locator('[data-context-pane]')
  await expect(ctx).toBeVisible()
  // Its identity is (owning session, panel): the auth-refactor repo.
  await expect(ctx).toHaveAttribute('data-context-pane', /^auth-refactor repo/)
  // The panel body renders (the Repository header) and the conversation is beside it.
  await expect(ctx.getByText('Repository')).toBeVisible()
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()

  // Closed by the rail cluster like every other pane (no per-pane X). After
  // auto-open focus sits on the CONVERSATION (not the panel); closing the
  // focused context pane routes to its driver (`focus` clears), the panel
  // collapses, the conversation remains alone; the URL never moved.
  await expect(page.locator('[data-main-pane="a"]')).toHaveAttribute('data-focused', 'true')
  await page.locator('[data-context-pane]').dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
})

test("the rail's active highlight tracks the FOCUSED pane (UI-12 — no singleton mirror)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // The open conversation's Recents row is marked current (aria-current rides
  // the shared active cue — the singleton's frozen activeId once left the rail
  // highlighting nothing after the first pane-routed navigation).
  const rail = page.getByRole('complementary')
  const sessionRow = rail.getByRole('button', { name: 'Refactor auth middleware', exact: true })
  await expect(sessionRow).toHaveAttribute('aria-current', 'page')

  // Split; retarget the focused duplicate at Projects — the SECTION row takes
  // the highlight and the conversation row drops it (the focused pane is now a
  // section page).
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const sectionRow = rail.locator('nav[aria-label="Sections"]').getByRole('button', { name: 'Projects', exact: true })
  await expect(sectionRow).toHaveAttribute('aria-current', 'page')
  await expect(sessionRow).not.toHaveAttribute('aria-current', 'page')

  // A focus hop IS a navigation for the rail too: focusing the conversation
  // pane moves the highlight back to its session row.
  await page.locator('[data-main-pane="a"]').dispatchEvent('pointerdown')
  await expect(sessionRow).toHaveAttribute('aria-current', 'page')
  await expect(sectionRow).not.toHaveAttribute('aria-current', 'page')
})

test('reload of a MULTI-pane layout keeps every pane: the boot address FOCUSES the pane already showing it (boot dedup)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split; retarget the duplicate at Projects; focus stays on pane B, so the
  // ADDRESS names the SECOND pane — the reload crux: the focus cursor is not
  // persisted (boots at the first pane), so a blind boot route would clobber
  // pane A with a copy of pane B's content and destroy the layout.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)

  await page.reload()

  // Both panes survive — the conversation intact in pane A, Projects in pane
  // B — and the boot address re-FOCUSED the pane that projected it.
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  await expect(paneB).toHaveAttribute('data-focused', 'true')
  await expect(page).toHaveURL(/\/projects$/)
})

test('LIVE PRUNE: deleting a session evicts EVERY pane it hosts — the layout collapses to the background', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')

  // Materialize a fresh session from the draft (its recents row is the newest).
  await page.getByPlaceholder('Reply to Claude…').fill('prune me')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/s\/(?!draft)[\w-]+$/)
  const sessionPath = new URL(page.url()).pathname

  // Split: two panes on the SAME session (the duplicate keeps the id).
  await page.locator('[data-split-view="row"]').click()
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)

  // Delete it from the recents row menu (the row is titled after the first
  // message) — confirm inline.
  const row = page.getByRole('button', { name: 'Actions for prune me' })
  await row.click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()

  // EVERY pane hosting the session collapsed — none linger as ghosts — and
  // deleting the last pages leaves the BACKGROUND (the one close rule).
  await expect(page.locator('[data-main-pane]')).toHaveCount(0)
  await expect(page.locator('[data-main-background]')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(sessionPath) // the address is corrected by the next navigation, not a forced draft
})
