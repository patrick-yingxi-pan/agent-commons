/** Rendered acknowledgement recovery for Project open-work posting. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, Identity, OpenSubGoal, Project } from '../contract/index.ts'
import { openWorkCreationId } from '../server/openWorkCreationIdentity.ts'
import { ms } from './budget.ts'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function createProject(page: Page, name: string): Promise<Project> {
  const response = await page.request.post('/api/v1/projects', {
    data: { name, description: 'A test-owned Project for open-work recovery.' },
  })
  expect(response.ok()).toBe(true)
  const project = ((await response.json()) as CreateProjectResponse).project
  const guarded = await page.request.post('/api/v1/relations/ops', {
    data: {
      op: {
        kind: 'share-project',
        projectId: project.id,
        projectName: project.name,
        shared: true,
      },
    },
  })
  expect(guarded.ok()).toBe(true)
  return project
}

async function openWorkForm(page: Page, project: Project) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Open work\b/ })
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
  const trigger = main.getByRole('button', { name: 'Post a work item', exact: true })
  await trigger.click()
  const form = main.locator('[data-open-work-creation-form]')
  await expect(form).toBeVisible()
  return { main, section, trigger, form }
}

async function workItems(page: Page, projectId: string): Promise<OpenSubGoal[]> {
  const response = await page.request.get(`/api/v1/projects/${encodeURIComponent(projectId)}/open-subgoals`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<OpenSubGoal[]>
}

test('work-item intent stays visible and Retry posts one exact item', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Held open work ${stamp}`)
  const subGoal = `Preserve this work ${stamp}`
  const target = `connector:${stamp}`
  const note = 'Keep this context through acknowledgement recovery.'
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let fail = true
  await page.route(`**/api/v1/projects/${project.id}/open-subgoals`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated posting outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const { section, trigger, form } = await openWorkForm(page, project)
  await expect(form.getByLabel('Effect type')).toHaveValue('')
  await expect(form.getByRole('button', { name: 'Post work item' })).toBeDisabled()
  await form.getByLabel('Work item sub-goal').fill(subGoal)
  await form.getByLabel('Effect type').selectOption('connector.write')
  await form.getByLabel('Effect target').fill(target)
  await form.getByLabel('Work item context').fill(note)
  await form.getByRole('button', { name: 'Post work item' }).evaluate((button) => {
    button.click()
    button.click()
  })

  const failed = page.locator('[data-open-work-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this work item was posted')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Work item sub-goal')).toHaveValue(subGoal)
  await expect(form.getByLabel('Work item sub-goal')).toBeDisabled()
  await expect(form.getByLabel('Effect type')).toBeDisabled()
  await expect(form.getByLabel('Effect target')).toBeDisabled()
  await expect(form.getByLabel('Work item context')).toBeDisabled()
  const automationPosture = page.locator('main [data-automation-posture="fixture"]')
  await expect(automationPosture).toContainText('Legacy Standing simulation may mark eligible work done without running an Agent or tools')
  await expect(automationPosture).toContainText('separately approved real MCP may start automatically within its reviewed limits')
  await expect(trigger).toBeDisabled()
  await expect(section).toHaveAttribute('aria-disabled', 'true')
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('main').getByText(subGoal, { exact: true })).toBeVisible()
  await expect(page.locator('[data-open-work-creation-form]')).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({ subGoal, type: 'connector.write', target, note })
  const expectedId = openWorkCreationId(await tenantId(page), project.id, keys[0]!)
  expect((await workItems(page, project.id)).filter((item) => item.id === expectedId)).toHaveLength(1)
})

test('a committed work item with a lost response stays held until exact reconciliation', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Recovered open work ${stamp}`)
  const subGoal = `Recovered work ${stamp}`
  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let sawRead!: () => void
  const readStarted = new Promise<void>((resolve) => { sawRead = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`**/api/v1/projects/${project.id}/open-subgoals`, async (route) => {
    if (route.request().method() === 'POST') {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = true
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (committed && route.request().method() === 'GET') {
      sawRead()
      await readGate
    }
    await route.continue()
  })

  const { form } = await openWorkForm(page, project)
  await form.getByLabel('Work item sub-goal').fill(subGoal)
  await form.getByLabel('Effect type').selectOption('connector.write')
  await form.getByLabel('Effect target').fill(`connector:${stamp}`)
  await form.getByRole('button', { name: 'Post work item' }).click()
  await readStarted
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Work item sub-goal')).toHaveValue(subGoal)

  releaseRead()
  await expect(page.locator('main').getByText(subGoal, { exact: true })).toBeVisible()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  const expectedId = openWorkCreationId(await tenantId(page), project.id, keys[0]!)
  expect((await workItems(page, project.id)).filter((item) => item.id === expectedId)).toHaveLength(1)
  await expect(page.locator('[data-open-work-creation]')).toHaveCount(0)
})
