/** ADAPT-19 / INV-1 — rendered wiring for the composable Appearance editor.
 * Pure recipe/persistence/contrast behavior lives in src/lib tests; this walk
 * proves the controls write the one live root funnel, survive reload, and stay
 * operable at the smallest supported width. */
import { test, expect, type Page } from '@playwright/test'

const SETTINGS_KEY = 'claude-ui.customize.theme-recipe.v1'

const rootTheme = (page: Page) => page.evaluate(() => {
  const root = document.documentElement
  const style = getComputedStyle(root)
  return {
    mode: root.dataset.theme,
    preset: root.dataset.palette,
    finish: root.dataset.themeFinish,
    accent: style.getPropertyValue('--color-accent').trim(),
    response: style.getPropertyValue('--color-co').trim(),
    ok: style.getPropertyValue('--color-ok').trim(),
  }
})

test('preset + sparse dimensions apply instantly, reset independently, and persist', async ({ page }) => {
  await page.goto('/customize')
  await page.getByRole('button', { name: /Change theme preset/ }).click()
  const preset = page.getByLabel('Theme preset')
  await expect(preset.locator('option')).toHaveCount(14)

  const before = await rootTheme(page)
  await preset.selectOption('delft')
  const delft = await rootTheme(page)
  expect(delft.preset).toBe('delft')
  expect(delft.accent).not.toBe(before.accent)
  expect(delft.ok, 'semantic status color stays palette-invariant').toBe(before.ok)

  await page.getByText('Tune palette', { exact: true }).click()
  const actionHue = page.getByRole('slider', { name: 'Action hue' })
  const presetAccent = delft.accent
  await actionHue.fill('42')
  await expect(page.getByText('1 override', { exact: true })).toBeVisible()
  const tuned = await rootTheme(page)
  expect(tuned.accent).not.toBe(presetAccent)

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY)
  expect(stored).toEqual({ version: 1, preset: 'delft', overrides: { actionHue: 42 } })

  await page.reload()
  await page.getByRole('button', { name: /Change theme preset/ }).click()
  await expect(preset).toHaveValue('delft')
  await page.getByText('Tune palette', { exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Action hue' })).toHaveValue('42')
  expect((await rootTheme(page)).accent).toBe(tuned.accent)

  await page.getByRole('button', { name: 'Reset Action hue' }).click()
  expect((await rootTheme(page)).accent).toBe(presetAccent)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).overrides, SETTINGS_KEY)).toEqual({})

  await page.getByLabel('Optical finish').selectOption('hairline')
  expect((await rootTheme(page)).finish).toBe('hairline')
  await page.getByRole('radio', { name: 'Dark' }).click()
  const dark = await rootTheme(page)
  expect(dark.mode).toBe('dark')
  expect(dark.preset).toBe('delft')
  expect(dark.finish).toBe('hairline')
})

test('advanced dimensions remain contained and usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/customize')
  await page.getByText('Tune palette', { exact: true }).click()
  await expect(page.getByLabel('Ground hue')).toBeVisible()
  await expect(page.getByLabel('Optical finish')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'Appearance creates no horizontal page scroll').toBe(true)
})
