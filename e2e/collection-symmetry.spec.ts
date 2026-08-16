import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

const sectionsNav = (page: import('@playwright/test').Page) => page.locator('nav[aria-label="Sections"]')

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

  await rail.getByRole('button', { name: 'Fold all rail sections', exact: true }).click()
  await expect(rail.getByRole('button', { name: 'Expand Artifacts', exact: true })).toBeVisible()
  await expect(rail.locator('[data-collection-section-resources]')).toHaveCount(0)

  await rail.getByRole('button', { name: 'Unfold all rail sections', exact: true }).click()
  await expect(rail.locator('[data-section-tree="artifacts"]')).toBeAttached()
  await expect(rail.locator('[data-collection-section-resources="p-insights"]')).toBeAttached()

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
