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
