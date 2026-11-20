/** Browser evidence for the shell's keyboard bypass and the primary
 * conversation semantics. Source locks cannot prove focus order, focus
 * transfer, or the computed accessible tree. */
import { test, expect } from '@playwright/test'

test('the first Tab reveals one bypass and moves focus past the resource rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/models')
  await expect(page.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()

  const skip = page.getByRole('button', { name: 'Skip to main content' })
  await expect(skip).toBeAttached()
  const resting = await skip.boundingBox()
  expect(resting, 'the bypass has rendered geometry').not.toBeNull()
  expect(resting!.y + resting!.height, 'it is outside the viewport at rest').toBeLessThanOrEqual(0)

  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await expect.poll(
    async () => (await skip.boundingBox())?.y ?? -1,
    { message: 'keyboard focus reveals the bypass inside the viewport' },
  ).toBeGreaterThanOrEqual(0)

  await page.keyboard.press('Enter')
  const main = page.locator('main#main-workspace')
  await expect(main).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'New provider' })).toBeFocused()

  // On a phone the rail overlays—and inerts—the main surface. The same bypass
  // first dismisses that drawer, then transfers focus after React clears inert.
  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto('/models')
  const narrowMain = page.locator('main#main-workspace')
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(narrowMain).toHaveAttribute('inert', '')
  await skip.focus()
  await skip.press('Enter')
  await expect(narrowMain).not.toHaveAttribute('inert', '')
  await expect(narrowMain).toBeFocused()
})

test('an established conversation has a navigable title and named message field', async ({ page }) => {
  await page.goto('/s/auth-refactor')
  const pane = page.locator('[data-conversation-pane="auth-refactor"]')

  await expect(pane.getByRole('heading', { level: 1, name: 'Refactor auth middleware' })).toBeVisible()
  await expect(pane.getByRole('textbox', { name: 'Message', exact: true })).toHaveAttribute('placeholder', 'Message…')
})

test('compact resource pages preserve entity identity and shared Project attribution', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto('/agents/agent-default')
  const main = page.getByRole('main')
  const heading = main.getByRole('heading', { level: 1, name: 'Default agent', exact: true })
  // Playwright considers a 1px sr-only heading visible. Require actual painted title geometry.
  await expect.poll(async () => (await heading.boundingBox())?.height ?? 0).toBeGreaterThan(16)
  await expect(main.locator('header').getByText('Built in', { exact: true })).toBeVisible()

  await page.goto('/projects')
  const row = main.locator('[data-resource-synopsis-row]').filter({ has: page.getByRole('button', { name: 'Release Notes Atelier', exact: true }) })
  const title = row.getByRole('button', { name: 'Release Notes Atelier', exact: true })
  const description = row.getByText(/Notes per release/)
  await expect(row.getByText(/by Grace Hopper$/)).toBeVisible()
  await expect(description).toBeVisible()
  await expect(row.getByText('0 sessions', { exact: true })).toBeHidden()
  const titleBox = await title.boundingBox()
  const descriptionBox = await description.boundingBox()
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(row.getByText('0 sessions', { exact: true })).toBeVisible()
})

test('a compact detail keeps its heading when the resource is named after its section', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 })
  // Keep this intentionally ambiguous name local to one browser context.
  await page.route('**/api/v1/agents', async (route) => {
    const response = await route.fetch()
    const agents = await response.json() as { id: string }[]
    const template = agents.find((agent) => agent.id === 'agent-default')
    expect(template).toBeDefined()
    await route.fulfill({ response, json: [...agents, { ...template, id: 'named-after-section', label: 'Agents', tenantId: 'tenant-acme' }] })
  })
  const heading = page.getByRole('main').getByRole('heading', { name: 'Agents', level: 1, exact: true })
  await page.goto('/agents/named-after-section')
  await expect.poll(async () => (await heading.boundingBox())?.height ?? 0).toBeGreaterThan(16)
  await expect(page.getByRole('main').locator('header').getByText('Private', { exact: true })).toBeVisible()
  await page.goto('/agents')
  await expect(heading).toBeAttached()
  await expect.poll(async () => (await heading.boundingBox())?.height).toBe(1)
})
