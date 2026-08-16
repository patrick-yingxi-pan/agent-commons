import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

const sectionsNav = (page: import('@playwright/test').Page) => page.locator('nav[aria-label="Sections"]')

async function runRailForestCommand(
  page: import('@playwright/test').Page,
  command: 'Fold all' | 'Unfold all',
) {
  await page.getByRole('button', { name: 'Rail view options', exact: true }).click()
  await page
    .getByRole('menu', { name: 'Rail view options' })
    .getByRole('menuitem', { name: command, exact: true })
    .click()
}

test('collection roots preserve main-page sections in the rail and canonical URL', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const ada = await newUser(browser)
  const page = ada.page

  await page.goto('/artifacts')
  await expect(page.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible({ timeout: ms(20_000) })
  const artifacts = sectionsNav(page).locator('[data-section-tree="artifacts"]')
  const insights = artifacts.locator('[data-collection-section="p-insights"]')
  await expect(insights.getByRole('button', { name: 'Insights dashboard', exact: true })).toBeVisible()
  await insights.getByRole('button', { name: 'Insights dashboard', exact: true }).click()
  await expect(page).toHaveURL(/\/artifacts\/groups\/p-insights$/)
  await expect(page.locator('main').getByText('Insights dashboard', { exact: true }).first()).toBeVisible()
  await expect(page.locator('main').getByText('Platform hardening', { exact: true })).toHaveCount(0)

  await page.goto('/contexts')
  const contexts = sectionsNav(page).locator('[data-section-tree="contexts"]')
  const connectors = contexts.locator('[data-collection-section="connector"]')
  await expect(connectors.getByRole('button', { name: 'Connectors', exact: true })).toBeVisible()
  await connectors.getByRole('button', { name: 'Connectors', exact: true }).click()
  await expect(page).toHaveURL(/\/contexts\/groups\/connector$/)
  await expect(page.locator('main').getByText('Connectors', { exact: true }).first()).toBeVisible()
  await expect(page.locator('main').getByText('This account is an MCP server', { exact: true })).toHaveCount(0)

  await page.goto('/models')
  const models = sectionsNav(page).locator('[data-section-tree="models"]')
  const providers = models.locator('[data-collection-section="providers"]')
  await expect(providers.getByRole('button', { name: 'Providers', exact: true })).toBeVisible()
  await providers.getByRole('button', { name: 'Expand Providers', exact: true }).click()
  await expect(models.locator('[data-collection-section-resources="providers"]')).toContainText('Anthropic')
  await providers.getByRole('button', { name: 'Providers', exact: true }).click()
  await expect(page).toHaveURL(/\/models\/groups\/providers$/)
  await expect(page.locator('main').getByText('Providers', { exact: true }).first()).toBeVisible()

  await ada.context.close()
})

test('rail Fold all and Unfold all reach nested collection branches', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto('/artifacts')
  const rail = sectionsNav(page)

  await runRailForestCommand(page, 'Fold all')
  await expect(rail.getByRole('button', { name: 'Expand Artifacts', exact: true })).toBeVisible()
  await expect(rail.locator('[data-collection-section-resources]')).toHaveCount(0)

  await runRailForestCommand(page, 'Unfold all')
  await expect(rail.locator('[data-section-tree="artifacts"]')).toBeAttached()
  await expect(rail.locator('[data-collection-section-resources="p-insights"]')).toBeAttached()

  await ada.context.close()
})

test('Sessions is an ordinary root with one live filter across rail and page', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto('/sessions')

  const rail = sectionsNav(page)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(rail.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible()
  await expect(page.locator('aside').getByText('SECTIONS', { exact: true })).toHaveCount(0)
  await expect(page.locator('aside').getByText('RECENTS', { exact: true })).toHaveCount(0)

  const railFilter = rail.getByRole('button', { name: 'Filter & sort sessions', exact: true })
  const pageFilter = main.getByRole('button', { name: 'Filter & sort sessions', exact: true })
  await pageFilter.click()
  const filterMenu = page.getByRole('menu', { name: 'Filter & sort sessions' })
  await filterMenu.getByRole('menuitem', { name: /^Status/ }).hover()
  await page.getByRole('menuitemradio', { name: 'Archived', exact: true }).click()
  await expect(main.getByText('No sessions match these filters.', { exact: true })).toBeVisible()
  await expect(rail.getByText('No sessions match these filters.', { exact: true })).toBeVisible()

  await filterMenu.getByRole('menuitem', { name: /^Status/ }).hover()
  await page.getByRole('menuitemradio', { name: 'Active', exact: true }).click()
  await expect(main.getByText('Refactor auth middleware', { exact: true })).toBeVisible()
  await expect(rail.getByText('Refactor auth middleware', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(page.getByRole('separator', { name: 'Resize lower rail pane' })).toBeVisible()
  await page.getByRole('button', { name: 'Rail view options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Lower pane', exact: true }).hover()
  await expect(page.getByRole('menuitemradio', { name: 'Start at Sessions', exact: true })).toBeChecked()

  await ada.context.close()
})

test('composite page controls mirror rail filters and fold dynamic bands', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto('/artifacts')
  await expect(page.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible({ timeout: ms(20_000) })

  const rail = sectionsNav(page)
  const main = page.locator('main')
  const railFilter = rail.getByRole('button', { name: 'Filter & sort artifacts', exact: true })
  const pageFilter = main.getByRole('button', { name: 'Filter & sort artifacts', exact: true })
  const railProjection = railFilter.locator('..')
  const pageProjection = pageFilter.locator('..')
  await expect(railFilter).toBeAttached()
  await expect(pageFilter).toBeVisible()

  // Choose a facet from the PAGE projection. Both control copies and both list
  // projections read one live value, so the rail head and page change together.
  await pageFilter.click()
  await page.getByRole('menu', { name: 'Filter & sort artifacts' }).getByRole('menuitem', { name: /^Type/ }).hover()
  await page.getByRole('menuitemradio', { name: 'Images', exact: true }).click()
  await expect(pageProjection).toHaveAttribute('data-filter-active', 'true')
  await expect(railProjection).toHaveAttribute('data-filter-active', 'true')
  await expect(main.getByText('insights-hero.png', { exact: true })).toBeVisible()
  await expect(main.getByText('insights-onepager.md', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const insightsRailGroup = rail.locator('[data-collection-section="p-insights"]')
  await insightsRailGroup.getByRole('button', { name: 'Expand Insights dashboard', exact: true }).click()
  const insightsRailResources = rail.locator('[data-collection-section-resources="p-insights"]')
  await expect(insightsRailResources.getByText('insights-hero.png', { exact: true })).toBeVisible()
  await expect(insightsRailResources.getByText('insights-onepager.md', { exact: true })).toHaveCount(0)

  // Change it back from the RAIL projection; the page control and page list
  // update without remounting or maintaining a private copy.
  await railFilter.click()
  await page.getByRole('menu', { name: 'Filter & sort artifacts' }).getByRole('menuitem', { name: /^Type/ }).hover()
  await page.getByRole('menuitemradio', { name: 'All types', exact: true }).click()
  await expect(pageProjection).not.toHaveAttribute('data-filter-active', 'true')
  await expect(railProjection).not.toHaveAttribute('data-filter-active', 'true')
  await expect(main.getByText('insights-onepager.md', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(insightsRailResources.getByText('insights-onepager.md', { exact: true })).toBeVisible()

  // Artifact project bands use persist={false}; they still participate in the
  // in-memory composite fold registry, which was the missing template feature.
  const foldAll = main.getByRole('button', { name: 'Fold all sections', exact: true })
  await expect(foldAll).toBeVisible()
  await foldAll.click()
  const headers = main.locator('[data-resource-page-section] > div > button[aria-expanded]')
  await expect(headers).not.toHaveCount(0)
  for (const header of await headers.all()) await expect(header).toHaveAttribute('aria-expanded', 'false')

  const unfoldAll = main.getByRole('button', { name: 'Unfold all sections', exact: true })
  await expect(unfoldAll).toBeVisible()
  await unfoldAll.click()
  for (const header of await headers.all()) await expect(header).toHaveAttribute('aria-expanded', 'true')

  await ada.context.close()
})

test('rail composite controls invoke the same page action, search, and bulk disclosure', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto('/artifacts')
  await expect(page.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible({ timeout: ms(20_000) })

  const rail = sectionsNav(page)
  const main = page.locator('main')
  const controls = rail.getByRole('button', { name: 'Controls for Artifacts', exact: true })
  const artifactsRow = controls.locator('xpath=ancestor::div[contains(@class, "group")][1]')

  // The compact rail projection is hover-revealed on desktop, like other row
  // verbs. It routes the focused pane and lands in the page's own search field.
  await artifactsRow.hover()
  await controls.click()
  await page.getByRole('menu', { name: 'Controls for Artifacts' }).getByRole('menuitem', { name: 'Search artifacts', exact: true }).click()
  await expect(main.getByPlaceholder('Search artifacts…')).toBeFocused()

  // The primary action is the same dialog-opening callback as the page header,
  // not a second creation flow owned by the rail.
  await artifactsRow.hover()
  await controls.click()
  await page.getByRole('menu', { name: 'Controls for Artifacts' }).getByRole('menuitem', { name: 'New artifact', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New artifact' })).toBeVisible()
  await page.keyboard.press('Escape')

  // One fold request reaches both projections: dynamic page bands collapse and
  // the rail's nested collection branches collapse without hiding Artifacts.
  await artifactsRow.hover()
  await controls.click()
  await page.getByRole('menu', { name: 'Controls for Artifacts' }).getByRole('menuitem', { name: 'Fold all', exact: true }).click()
  const headers = main.locator('[data-resource-page-section] > div > button[aria-expanded]')
  for (const header of await headers.all()) await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(rail.locator('[data-section-tree="artifacts"]')).toBeAttached()
  await expect(rail.locator('[data-collection-section-resources]')).toHaveCount(0)

  // A later forest-wide command supersedes the branch-local posture; the
  // resource-specific signal must not remain cached as a permanent override.
  await runRailForestCommand(page, 'Unfold all')
  await expect(rail.locator('[data-collection-section-resources="p-insights"]')).toBeAttached()

  await artifactsRow.hover()
  await controls.click()
  await page.getByRole('menu', { name: 'Controls for Artifacts' }).getByRole('menuitem', { name: 'Unfold all', exact: true }).click()
  for (const header of await headers.all()) await expect(header).toHaveAttribute('aria-expanded', 'true')
  await expect(rail.locator('[data-collection-section-resources="p-insights"]')).toBeAttached()

  await ada.context.close()
})
