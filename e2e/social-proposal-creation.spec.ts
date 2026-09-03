/** Rendered acknowledgement recovery for offering typed changes. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, Identity, ScheduledTask, ScheduleTemplate, SocialProposal } from '../contract/index.ts'
import { socialProposalCreationId } from '../server/socialProposalCreationIdentity.ts'
import { ms } from './budget.ts'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function createProject(page: Page, name: string) {
  const response = await page.request.post('/api/v1/projects', {
    data: { name, description: 'A test-owned Project for change-offer recovery.' },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as CreateProjectResponse).project
}

async function proposals(page: Page, kind: string, id: string): Promise<SocialProposal[]> {
  const response = await page.request.get(`/api/v1/proposals?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<SocialProposal[]>
}

test('a Project change offer stays visible and Retry preserves one proposal and review thread', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Held change offer ${stamp}`)
  const change = `Clarify the launch boundary ${stamp}`
  const rationale = 'This exact rationale should open one review thread.'
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route('**/api/v1/proposals', async (route) => {
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

  await page.goto(`/projects/${project.id}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Changes\b/ })
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
  await main.getByRole('button', { name: 'Offer a change', exact: true }).click()
  const form = main.locator('[data-social-proposal-creation-form]')
  await form.getByLabel('The change you propose').fill(change)
  await form.getByLabel('Why this change').fill(rationale)
  await form.getByRole('button', { name: 'Offer', exact: true }).click()

  const failed = page.locator('[data-social-proposal-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this change was offered')
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('The change you propose')).toBeDisabled()
  await expect(form.getByLabel('The change you propose')).toHaveValue(change)
  await expect(form.getByLabel('Why this change')).toBeDisabled()
  await expect(form.getByLabel('Why this change')).toHaveValue(rationale)
  await expect(section).toHaveAttribute('aria-disabled', 'true')
  await expect(main.getByRole('button', { name: 'Declare work', exact: true })).toBeDisabled()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(main.getByText(change, { exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const expectedId = socialProposalCreationId(await tenantId(page), keys[0]!)
  const rows = await proposals(page, 'project', project.id)
  const created = rows.filter((proposal) => proposal.id === expectedId)
  expect(created).toHaveLength(1)
  const review = await page.request.get(`/api/v1/discussions/${created[0]!.discussionId}`)
  expect(review.ok()).toBe(true)
  expect((await review.json()).posts[0].body).toBe(rationale)
})

test('a committed typed Improvement stays held until exact lost-response reconciliation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const templateResponse = await page.request.get('/api/v1/schedule-templates')
  expect(templateResponse.ok()).toBe(true)
  const [template] = (await templateResponse.json()) as ScheduleTemplate[]
  const stamp = Date.now().toString(36)
  const routineResponse = await page.request.post('/api/v1/schedules', {
    data: { seed: { ...template!.seed, name: `Proposal host ${stamp}`, runs: [] } },
  })
  expect(routineResponse.ok()).toBe(true)
  const routine = (await routineResponse.json()) as ScheduledTask
  const changedName = `Reviewed routine ${stamp}`
  const rationale = 'Keep this typed name change attached to one durable offer.'
  const keys: string[] = []
  let attempts = 0
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readReleased = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route('**/api/v1/proposals', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
    })
  })
  await page.route('**/api/v1/proposals/sprop-new-*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    markReadStarted()
    await readReleased
    await route.continue()
  })

  await page.goto(`/scheduled/${routine.id}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: routine.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Improvements\b/ })
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
  await main.getByRole('button', { name: 'Offer a change', exact: true }).click()
  const form = main.locator('[data-social-proposal-creation-form]')
  const fieldPicker = form.getByLabel('Field to change')
  await expect(fieldPicker.locator('option')).toHaveText([
    'Run status', 'Name', 'Instructions', 'Schedule', 'Time zone', 'Failure alerts',
  ])
  await fieldPicker.selectOption('name')
  await form.getByLabel('New value').fill(changedName)
  await form.getByLabel('Why this change').fill(rationale)
  await form.getByRole('button', { name: 'Offer', exact: true }).click()
  await readStarted

  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Field to change')).toBeDisabled()
  await expect(form.getByLabel('New value')).toBeDisabled()
  await expect(form.getByLabel('New value')).toHaveValue(changedName)
  await expect(form.getByLabel('Why this change')).toBeDisabled()
  await expect(section).toHaveAttribute('aria-disabled', 'true')
  releaseRead()

  await expect(form).toHaveCount(0)
  await expect(main.getByText(changedName, { exact: false })).toBeVisible()
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = socialProposalCreationId(await tenantId(page), keys[0]!)
  const rows = await proposals(page, 'schedule', routine.id)
  expect(rows.filter((proposal) => proposal.id === expectedId)).toHaveLength(1)
  await expect(page.locator('[data-social-proposal-creation="failed"]')).toHaveCount(0)
})
