/** The MAIN workspace split, focused-pane model (universal split, ADAPT-17):
 *  the rail's split/close cluster (beside the bell) acts on the FOCUSED pane —
 *  the split buttons DUPLICATE it (no picker, no per-pane chrome), and close
 *  is HOMOGENEOUS: a secondary pane collapses, while closing the primary tile
 *  relocates the primary role into the surviving pane (its content promotes
 *  into the controller, so the URL follows what remains); rail navigation
 *  retargets the focused pane; the URL never follows a secondary pane. The tree math is locked by tests/main-split.test.ts;
 *  this locks the wiring. */
import { test, expect, type Page } from '@playwright/test'

/** A repo / workspace session auto-tiles its context PANEL as a pane in the
 *  universal tree on the wide tier now (ADAPT-16 folded into ADAPT-17, Phase 4).
 *  Close it so the conversation-split mechanics below start from a clean single
 *  primary: focus the context pane, then the rail cluster's close clears it. */
async function clearAutoPanel(page: Page) {
  const ctx = page.locator('[data-context-pane]')
  if ((await ctx.count()) === 0) return
  await ctx.first().dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
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
  // b in place — the primary (and the address bar) never move.
  const before = page.url()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()
  expect(page.url()).toBe(before)
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()

  // Pane-local navigation: a project detail opens INSIDE the pane; the URL stays.
  await paneB.getByText('Platform hardening').first().click()
  await expect(paneB.getByText('The platform team')).toBeVisible()
  expect(page.url()).toBe(before)

  // The main-pane divider is a named, keyboard-operable separator (UI-11).
  await expect(page.getByRole('separator', { name: 'Resize view panes (root)' })).toBeVisible()

  // No per-pane chrome at all: close lives in the rail cluster and acts on the
  // FOCUSED pane — homogeneously. Focus pane b (secondary) and close: it
  // collapses, the frame dissolves, the primary conversation survives.
  // (dispatchEvent: focus rides pointer-down capture, and actionability would
  // wait forever on the thread's continuous animations.)
  await paneB.dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
})

test('closing the focused PRIMARY tile is homogeneous: the survivor promotes and the URL follows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)

  // Split (duplicate takes focus), retarget the duplicate at Projects.
  await page.locator('[data-split-view="row"]').click()
  await page.locator('nav[aria-label="Sections"]').getByText('Projects', { exact: true }).click()
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB.getByText('Platform hardening').first()).toBeVisible()

  // Focus the PRIMARY tile and close it: the close button is offered (panes
  // are equals), the Projects pane's content promotes into the controller —
  // the frame dissolves onto Projects and the ADDRESS follows what survived.
  await page.locator('[data-main-pane="a"]').dispatchEvent('pointerdown')
  await expect(page.locator('[data-close-view]')).toBeVisible()
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.getByText('Platform hardening').first()).toBeVisible()
  await expect(page).toHaveURL(/\/projects$/)
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
  await expect(pane.getByText(/local mock|workspace/).last()).toBeVisible({ timeout: 15_000 })

  // …while the PRIMARY (auth-refactor) is untouched and the URL never moved.
  await expect(page.locator('[data-main-pane="a"]').getByText('quick pane check')).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
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

  // And the detail's side column STACKS below the main column — the layout
  // gates on the PANE's container width, not the (wide) viewport (UI-9
  // generalized: `lg:flex-row` used to hold two squeezed columns here).
  const stacked = await paneB.evaluate((el) => {
    const aside = el.querySelector('aside')
    if (!aside) return 'no-aside'
    const main = aside.parentElement!.firstElementChild!
    return aside.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 4
  })
  expect(stacked, 'the detail side column stacks in a half-width pane').toBe(true)
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
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')

  // Sending FROM the draft pane materializes it IN PLACE through the shared
  // draft funnel: the pane retargets to the real session id and the reply
  // streams there; the URL still never moved (pane-local, ADAPT-15).
  const composer = paneB.locator('textarea')
  await composer.fill('draft in a pane')
  await composer.press('Enter')
  await expect(paneB.getByText('draft in a pane')).toBeVisible()
  await expect(paneB.locator('[data-conversation-pane]')).not.toHaveAttribute('data-conversation-pane', 'draft', { timeout: 15_000 })
  await expect(paneB.getByText(/local mock|workspace/).last()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
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

  // The primary is untouched and the URL never moved (ADAPT-15: pane-local
  // navigation is not page identity).
  await expect(page.locator('[data-main-pane="a"]').getByText('token refresh logic').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
})

test('switching runs from the runs panel swaps the context pane IN PLACE — no tree dissolve, no main-area remount', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  // Open the scheduled routine's latest run from the rail: a run session tiles
  // the run-switcher panel as a context pane (the runs panel).
  await page.locator('aside').getByText('Triage new GitHub').first().click()
  const ctx = page.locator('[data-context-pane]')
  await expect(ctx).toHaveAttribute('data-context-pane', /^srun-.* runs /)
  const firstUrl = new URL(page.url()).pathname
  expect(firstUrl).toMatch(/^\/s\/srun-/)

  // Stamp identity probes on the pane containers and the run rows. A run
  // session's row RESOLVES ASYNC on open — the projection must hold (not
  // project a transient "no panel") or the tree dissolves and everything
  // remounts (the regression this locks: thread + runs list flashed and lost
  // their scroll on every run click).
  await page.evaluate(() => {
    document.querySelectorAll('[data-main-pane]').forEach((el, i) => {
      ;(el as HTMLElement & { __probe?: string }).__probe = `pane${i}`
    })
  })
  // Click a DIFFERENT run (the rows name their recency; pick the last).
  await ctx.getByRole('button').filter({ hasText: /steps/ }).last().click()
  await expect
    .poll(async () => new URL(page.url()).pathname, { message: 'the click navigates to another run session' })
    .not.toBe(firstUrl)
  await expect(ctx).toHaveAttribute('data-context-pane', /^srun-.* runs /)

  // The tree never dissolved: the SAME pane containers are still mounted.
  const probes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-main-pane]')].map(
      (el) => (el as HTMLElement & { __probe?: string }).__probe ?? 'REMOUNTED',
    ),
  )
  expect(probes, 'pane containers survived the run switch (swap in place, not dissolve/re-form)').toEqual(['pane0', 'pane1'])
  await expect(page.locator('[data-main-split]')).toHaveCount(1)
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
  // auto-open focus sits on the PRIMARY (not the panel), and the rail Close still
  // closes the panel — it routes to the active context pane rather than no-oping
  // (the primary tile has nothing promotable but its own context sibling). The
  // panel dissolves; the conversation stays; the URL never moved (ADAPT-15).
  await expect(page.locator('[data-main-pane="a"]')).toHaveAttribute('data-focused', 'true')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)
  await expect(page.locator('[data-main-split]')).toHaveCount(0)
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/s/auth-refactor')
})
