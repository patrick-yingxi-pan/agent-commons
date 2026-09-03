/** Rendered acknowledgement recovery for declaring Project work. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, Contribution, Identity, Project } from '../contract/index.ts'
import { contributionCreationId } from '../server/contributionCreationIdentity.ts'
import { ms } from './budget.ts'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function createProject(page: Page, name: string): Promise<Project> {
  const response = await page.request.post('/api/v1/projects', {
    data: { name, description: 'A test-owned Project for Contribution recovery.' },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as CreateProjectResponse).project
}

async function openContributionForm(page: Page, project: Project) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Changes\b/ })
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
  const trigger = main.getByRole('button', { name: 'Declare work', exact: true })
  await trigger.click()
  const form = main.locator('[data-contribution-creation-form]')
  await expect(form).toBeVisible()
  return { main, section, trigger, form }
}

async function roster(page: Page, projectId: string): Promise<Contribution[]> {
  const response = await page.request.get(`/api/v1/projects/${encodeURIComponent(projectId)}/contributions`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Contribution[]>
}

test('Contribution intent stays visible and Retry preserves one declared change', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Held Contribution ${stamp}`)
  const title = `Reliable change ${stamp}`
  const summary = 'Preserve this exact scope through an uncertain acknowledgement.'
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(`**/api/v1/projects/${project.id}/contributions`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  const { section, trigger, form } = await openContributionForm(page, project)
  await form.getByLabel('Contribution title').fill(title)
  await form.getByLabel('Contribution summary').fill(summary)
  await form.getByRole('button', { name: 'Declare', exact: true }).click()

  const failed = page.locator('[data-contribution-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Contribution was declared')
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Contribution title')).toBeDisabled()
  await expect(form.getByLabel('Contribution title')).toHaveValue(title)
  await expect(form.getByLabel('Contribution summary')).toBeDisabled()
  await expect(form.getByLabel('Contribution summary')).toHaveValue(summary)
  await expect(trigger).toBeDisabled()
  await expect(section).toHaveAttribute('aria-disabled', 'true')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('main').getByRole('heading', { name: title, exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({ title, summary })
  const expectedId = contributionCreationId(await tenantId(page), project.id, keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/changes/${expectedId}$`))
  expect((await roster(page, project.id)).filter((contribution) => contribution.id === expectedId)).toHaveLength(1)
})

test('a committed Contribution with a lost response keeps its form until exact reconciliation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Recovered Contribution ${stamp}`)
  const title = `Recovered change ${stamp}`
  const summary = 'Land only the one declaration whose response was lost.'
  const keys: string[] = []
  let attempts = 0
  let releaseReads!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve })
  await page.route(`**/api/v1/projects/${project.id}/contributions`, async (route) => {
    if (route.request().method() === 'POST') {
      attempts += 1
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (attempts > 0 && route.request().method() === 'GET') {
      markReadStarted()
      await readsReleased
    }
    await route.continue()
  })

  const { form } = await openContributionForm(page, project)
  await form.getByLabel('Contribution title').fill(title)
  await form.getByLabel('Contribution summary').fill(summary)
  await form.getByRole('button', { name: 'Declare', exact: true }).click()
  await readStarted
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Contribution title')).toHaveValue(title)

  releaseReads()
  await expect(page.locator('main').getByRole('heading', { name: title, exact: true })).toBeVisible()
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = contributionCreationId(await tenantId(page), project.id, keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/changes/${expectedId}$`))
  const stored = await roster(page, project.id)
  expect(stored.filter((contribution) => contribution.id === expectedId)).toHaveLength(1)
  expect(stored.find((contribution) => contribution.id === expectedId)?.summary).toBe(summary)
  await expect(page.locator('[data-contribution-creation="failed"]')).toHaveCount(0)
})
