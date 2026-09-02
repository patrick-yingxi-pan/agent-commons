/** Standards-based rendered accessibility coverage for the product's core
 * workspace faces. Keyboard journey details remain in accessibility-navigation;
 * this suite catches semantic, naming, contrast, and target-size regressions
 * across shared chrome, pages, and modal forms. */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const WIDE = { width: 1280, height: 800 }
const NARROW = { width: 375, height: 812 }

async function auditSurface(
  page: Page,
  surface: { name: string; path: string; heading: string },
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport)
  await page.goto(surface.path)
  await expect(page.getByRole('heading', { level: 1, name: surface.heading })).toBeVisible()
  // The conversation heading can settle before its keyed controller finishes
  // hydrating. Measure the resting composer, not the temporary disabled-opacity
  // face that exists only while the controller becomes writable.
  if (surface.path.startsWith('/s/')) {
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  }
  await assertWcag22Aa(page, `${surface.name} at ${viewport.width}×${viewport.height}`)
}

const conversation = { name: 'conversation', path: '/s/auth-refactor', heading: 'Refactor auth middleware' }
const commons = { name: 'Commons', path: '/commons', heading: 'Commons' }
const projects = { name: 'Projects', path: '/projects', heading: 'Projects' }
const artifacts = { name: 'Artifacts', path: '/artifacts', heading: 'Artifacts' }
const models = { name: 'Models', path: '/models', heading: 'Models' }
const agents = { name: 'Agents', path: '/agents', heading: 'Agents' }
const routines = { name: 'Routines', path: '/scheduled', heading: 'Routines' }
const customize = { name: 'Customize', path: '/customize', heading: 'Customize' }

// Keep each Playwright declaration explicit. The release verifier counts these
// declarations independently of Playwright's reporter so a silently omitted
// spec or shard cannot look green.
test('conversation has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, conversation, WIDE))
test('Commons has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, commons, WIDE))
test('Projects has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, projects, WIDE))
test('Artifacts has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, artifacts, WIDE))
test('Models has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, models, WIDE))
test('Agents has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, agents, WIDE))
test('Routines has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, routines, WIDE))
test('Customize has no detectable WCAG 2.2 AA violations', async ({ page }) => auditSurface(page, customize, WIDE))

test('conversation remains WCAG 2.2 AA-clean on the narrow tier', async ({ page }) => auditSurface(page, conversation, NARROW))
test('Commons remains WCAG 2.2 AA-clean on the narrow tier', async ({ page }) => auditSurface(page, commons, NARROW))
test('Projects remains WCAG 2.2 AA-clean on the narrow tier', async ({ page }) => auditSurface(page, projects, NARROW))
test('Artifacts remains WCAG 2.2 AA-clean on the narrow tier', async ({ page }) => auditSurface(page, artifacts, NARROW))
test('Models remains WCAG 2.2 AA-clean on the narrow tier', async ({ page }) => auditSurface(page, models, NARROW))

test('core creation dialogs have no detectable WCAG 2.2 AA violations', async ({ page }) => {
  await page.setViewportSize(WIDE)

  await page.goto('/models')
  await expect(page.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
  await page.getByRole('button', { name: 'New provider', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New provider' })).toBeVisible()
  await assertWcag22Aa(page, 'New provider dialog')

  await page.goto('/artifacts')
  await expect(page.getByRole('heading', { level: 1, name: 'Artifacts' })).toBeVisible()
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New document' })).toBeVisible()
  await assertWcag22Aa(page, 'New document dialog')
})
