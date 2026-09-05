/** Rendered acknowledgement recovery for guarded Project claim acquisition. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, Project, ProjectSubGoal, Reservation } from '../contract/index.ts'
import { SELF_PROJECT_HOLDER } from '../contract/index.ts'
import { ms } from './budget.ts'

async function createGuardedProject(page: Page, stamp: string): Promise<Project> {
  const response = await page.request.post('/api/v1/projects', {
    data: { name: `Claim recovery ${stamp}`, description: 'A test-owned guarded Coordination project.' },
  })
  expect(response.ok()).toBe(true)
  const project = ((await response.json()) as CreateProjectResponse).project
  const share = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
  })
  expect(share.ok()).toBe(true)
  return project
}

async function openClaimForm(page: Page, project: Project) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Coordination\b/ }).first()
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
  const form = main.locator('[data-subgoal-claim-form]')
  if (!(await form.isVisible())) await main.getByRole('button', { name: 'Claim a sub-goal', exact: true }).click()
  await expect(form).toBeVisible()
  return { main, form }
}

async function claims(page: Page, projectId: string): Promise<ProjectSubGoal[]> {
  const response = await page.request.get(`/api/v1/projects/${encodeURIComponent(projectId)}/subgoals`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ProjectSubGoal[]>
}

test('claim intent survives navigation and Retry retransmits one exact principal and sub-goal', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const project = await createGuardedProject(page, `${stamp}-retry`)
  const subGoal = `Preserve claim ${stamp}`
  const idempotencyHeaders: string[] = []
  const bodies: Record<string, unknown>[] = []
  let fail = true
  await page.route(`**/api/v1/projects/${project.id}/subgoals`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    idempotencyHeaders.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated claim outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let { form } = await openClaimForm(page, project)
  await form.getByPlaceholder('Claim a sub-goal…').fill(subGoal)
  await form.getByRole('button', { name: 'Claim', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-subgoal-claim="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this sub-goal was claimed')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByPlaceholder('Claim a sub-goal…')).toHaveValue(subGoal)
  await expect(form.getByPlaceholder('Claim a sub-goal…')).toBeDisabled()
  await expect(form.getByRole('button', { name: 'Claiming…' })).toBeDisabled()
  expect(idempotencyHeaders).toEqual([''])

  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('main').getByText(project.name, { exact: true }).click()
  const reopenedMain = page.locator('main')
  await expect(reopenedMain.getByRole('heading', { name: project.name, exact: true })).toBeVisible()
  const reopenedSection = reopenedMain.getByRole('button', { name: /^Coordination\b/ }).first()
  if ((await reopenedSection.getAttribute('aria-expanded')) === 'false') await reopenedSection.click()
  form = reopenedMain.locator('[data-subgoal-claim-form]')
  await expect(form).toBeVisible()
  await expect(form.getByPlaceholder('Claim a sub-goal…')).toHaveValue(subGoal)
  await expect(form).toHaveAttribute('aria-busy', 'true')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('main').getByText(subGoal, { exact: true })).toBeVisible()
  await expect(page.locator('[data-subgoal-claim-form]')).toHaveCount(0)
  expect(idempotencyHeaders).toEqual(['', ''])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({ holder: SELF_PROJECT_HOLDER, subGoal })
  expect((await claims(page, project.id)).filter((claim) =>
    claim.subGoal === subGoal && claim.holder === SELF_PROJECT_HOLDER && claim.canRelease === true,
  )).toHaveLength(1)
})

test('a lost acknowledgement retries by exact Guardian re-entry, not stale response replay', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const project = await createGuardedProject(page, stamp)
  const subGoal = `Recovered claim ${stamp}`
  const idempotencyHeaders: string[] = []
  const bodies: Record<string, unknown>[] = []
  const reservationIds: string[] = []
  let committed = false
  let serveFreshReads = false
  await page.route(`**/api/v1/projects/${project.id}/subgoals`, async (route) => {
    if (route.request().method() === 'POST') {
      idempotencyHeaders.push(route.request().headers()['idempotency-key'] ?? '')
      bodies.push(route.request().postDataJSON() as Record<string, unknown>)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      const body = await response.body()
      reservationIds.push((JSON.parse(body.toString()) as Reservation).id)
      committed = true
      if (reservationIds.length === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
        })
      } else {
        await route.fulfill({ status: response.status(), headers: response.headers(), body })
      }
      return
    }
    if (committed && !serveFreshReads && route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return
    }
    await route.continue()
  })

  const { main, form } = await openClaimForm(page, project)
  await form.getByPlaceholder('Claim a sub-goal…').fill(subGoal)
  await form.getByRole('button', { name: 'Claim', exact: true }).click()
  const failed = page.locator('[data-subgoal-claim="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this sub-goal was claimed')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByPlaceholder('Claim a sub-goal…')).toHaveValue(subGoal)
  expect(idempotencyHeaders).toEqual([''])
  expect(reservationIds).toHaveLength(1)

  serveFreshReads = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(main.getByText(subGoal, { exact: true })).toBeVisible()
  await expect(page.locator('[data-subgoal-claim]')).toHaveCount(0)
  await expect(main.locator('[data-subgoal-claim-form]')).toHaveCount(0)
  expect(idempotencyHeaders).toEqual(['', ''])
  expect(bodies).toEqual([
    { holder: SELF_PROJECT_HOLDER, subGoal },
    { holder: SELF_PROJECT_HOLDER, subGoal },
  ])
  expect(reservationIds).toHaveLength(2)
  expect(reservationIds[1]).toBe(reservationIds[0])
})
