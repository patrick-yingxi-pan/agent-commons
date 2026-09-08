/** Created Projects keep one identity across the registry, canonical detail,
 * tenant-scoped grants, and the rendered rail. */
import { test, expect } from '@playwright/test'
import type { Grant } from '../contract/index.ts'
import { API, newUser, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

test('created project registry stays unique, grant healing is live, and controls follow ownership', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  for (const user of [owner, reader, foreign]) user.page.setDefaultTimeout(ms(15_000))

  const name = `Registry project ${Date.now().toString(36)}`
  const description = `A single public description for the project registry. ${Date.now().toString(36)}`
  try {
    await owner.page.goto('/projects')
    await owner.page.getByRole('button', { name: 'New project', exact: true }).click()
    const dialog = owner.page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Description').fill(description)
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(owner.page).toHaveURL(/\/projects\/[^/?#]+$/)
    const id = owner.page.url().split('/').at(-1)!
    const projectPath = `/projects/${id}`
    const projectRows = async (page: typeof owner.page) => {
      const response = await page.request.get(`${API}/projects`)
      expect(response.ok()).toBeTruthy()
      return await response.json() as Array<{ id: string; name: string; description: string }>
    }

    const ownerProjects = await projectRows(owner.page)
    expect(ownerProjects.filter((project) => project.id === id), 'owner GET /projects has one created identity').toHaveLength(1)
    expect(ownerProjects.find((project) => project.id === id)?.description).toBe(description)

    // The reader is already on the canonical URL when the grant arrives. A
    // reload here would hide a missing live invalidation path.
    await reader.page.goto(projectPath)
    await expect(reader.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(reader.page.getByText('This project isn’t visible from this account (or no longer exists).')).toBeVisible()
    const granted = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'project', id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(granted.ok()).toBeTruthy()
    const grant = await granted.json() as Grant
    await expect(reader.page.getByRole('heading', { name })).toBeVisible()
    await openSection(reader.page, 'About')
    const readerAbout = reader.page.locator('section.group\\/section').filter({ has: reader.page.locator('[data-section-title]', { hasText: /^About$/ }) })
    await expect(readerAbout.locator('p', { hasText: description })).toBeVisible()
    const readerProjects = await projectRows(reader.page)
    expect(readerProjects.filter((project) => project.id === id), 'reader GET /projects has one granted identity').toHaveLength(1)
    expect(readerProjects.find((project) => project.id === id)?.description).toBe(description)

    for (const viewport of VIEWPORTS) {
      for (const [role, user] of [['owner', owner] as const, ['reader', reader] as const]) {
        await user.page.setViewportSize(viewport)
        await user.page.goto('/projects')
        if (role === 'reader') await expect(user.page.getByText('Projects shared with you — open a project to see its content and available actions.', { exact: true })).toBeVisible()
        const row = user.page.locator('[data-resource-synopsis-row]').filter({ has: user.page.getByRole('button', { name, exact: true }) })
        await expect(row, `${role} index has exactly one row`).toHaveCount(1)
        await expect(row).toContainText(description)
        if (viewport.width === 1280) {
          const expandSidebar = user.page.getByRole('button', { name: 'Expand sidebar', exact: true })
          if (await expandSidebar.count()) await expandSidebar.click()
          const sections = user.page.getByRole('navigation', { name: 'Sections' })
          const projects = sections.locator('[data-rail-node-key="section/projects"]')
          const projectsToggle = projects.getByRole('button', { name: /^(Expand|Collapse) Projects$/ })
          if (await projectsToggle.count() && (await projectsToggle.getAttribute('aria-expanded')) === 'false') await projectsToggle.click()
          await expect(projects.getByRole('button', { name, exact: true })).toHaveCount(1)
        }
        await row.scrollIntoViewIfNeeded()
        await user.page.screenshot({ path: testInfo.outputPath(`project-index-${role}-${viewport.width}x${viewport.height}.png`) })
        await row.getByRole('button', { name, exact: true }).click()
        await expect(user.page).toHaveURL(new RegExp(`${projectPath}$`))
        await expect(user.page.getByRole('heading', { name })).toBeVisible()
        await openSection(user.page, 'About')
        const about = user.page.locator('section.group\\/section').filter({ has: user.page.locator('[data-section-title]', { hasText: /^About$/ }) })
        await expect(about.locator('p', { hasText: description })).toBeVisible()
        await expect(user.page.getByRole('button', { name: /^Edit description/ })).toHaveCount(role === 'owner' ? 1 : 0)
        if (role === 'owner') {
          await openSection(user.page, 'Sharing')
          await expect(user.page.getByTestId('share-toggle')).toBeVisible()
          await expect(user.page.getByText('Loading sharing…', { exact: true })).toHaveCount(0)
          await openSection(user.page, 'About')
        } else {
          await expect(user.page.getByTestId('share-toggle')).toHaveCount(0)
        }
        await about.scrollIntoViewIfNeeded()
        await user.page.screenshot({ path: testInfo.outputPath(`project-detail-${role}-${viewport.width}x${viewport.height}.png`) })
      }

      await foreign.page.setViewportSize(viewport)
      await foreign.page.goto(projectPath)
      await expect(foreign.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
      await expect(foreign.page.getByText('This project isn’t visible from this account (or no longer exists).')).toBeVisible()
      await expect(foreign.page.getByText(description, { exact: true })).toHaveCount(0)
    }

    await reader.page.reload()
    await expect(reader.page.getByRole('heading', { name })).toBeVisible()
    await openSection(reader.page, 'About')
    const reloadedReaderAbout = reader.page.locator('section.group\\/section').filter({ has: reader.page.locator('[data-section-title]', { hasText: /^About$/ }) })
    await expect(reloadedReaderAbout.locator('p', { hasText: description })).toBeVisible()
    const revoked = await owner.page.request.delete(`${API}/grants/${grant.id}`)
    expect(revoked.ok()).toBeTruthy()
    await expect(reader.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(reader.page.getByText('This project isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(owner.page.getByRole('heading', { name })).toBeVisible()
    const ownerAbout = owner.page.locator('section.group\\/section').filter({ has: owner.page.locator('[data-section-title]', { hasText: /^About$/ }) })
    await expect(ownerAbout.locator('p', { hasText: description })).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
