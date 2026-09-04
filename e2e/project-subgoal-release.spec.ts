/** Rendered authority and acknowledgement recovery for Coordination claim release. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { CreateProjectResponse, Project, ProjectSubGoal, Reservation } from '../contract/index.ts'
import { SELF_PROJECT_HOLDER } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena {
  project: Project
  claim: ProjectSubGoal
}

async function arena(page: Page, stamp: string): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Claim release ${stamp}`, description: 'A test-owned shared Coordination project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const shareResponse = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
  })
  expect(shareResponse.ok()).toBe(true)
  const claimResponse = await page.request.post(`/api/v1/projects/${project.id}/subgoals`, {
    data: { holder: SELF_PROJECT_HOLDER, subGoal: `Review release ${stamp}` },
  })
  expect(claimResponse.ok()).toBe(true)
  const reservation = await claimResponse.json() as Reservation
  const listResponse = await page.request.get(`/api/v1/projects/${project.id}/subgoals`)
  expect(listResponse.ok()).toBe(true)
  const claim = ((await listResponse.json()) as ProjectSubGoal[])
    .find((candidate) => candidate.reservationId === reservation.id)
  expect(claim).toBeTruthy()
  return { project, claim: claim! }
}

async function openProject(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(main.getByText(context.claim.subGoal, { exact: true })).toBeVisible()
  return main
}

async function visitor(browser: Browser) {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' },
  })
  return { context, page: await context.newPage() }
}

test('only the holder sees Release, and pre-commit Retry keeps one release act across navigation', async ({ browser, page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const guest = await visitor(browser)

  const guestMain = await openProject(guest.page, context)
  await expect(guestMain.getByText(/held by Ada Lovelace/)).toBeVisible()
  await expect(guestMain.getByRole('button', { name: `Release ${context.claim.subGoal}` })).toHaveCount(0)
  const forged = await guest.page.request.post(`/api/v1/reservations/${context.claim.reservationId}/release`)
  expect(forged.status()).toBe(403)

  let fail = true
  const keys: string[] = []
  await page.route(`**/api/v1/reservations/${context.claim.reservationId}/release`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated release outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let main = await openProject(page, context)
  await main.getByRole('button', { name: `Release ${context.claim.subGoal}` }).click()
  const failed = page.locator('[data-subgoal-release="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this claim was released')
  await expect(main.getByRole('button', { name: `Releasing ${context.claim.subGoal}` })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('main').getByText(context.project.name, { exact: true }).click()
  main = page.locator('main')
  await expect(main.getByRole('button', { name: `Releasing ${context.claim.subGoal}` })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(main.getByText('No sub-goals in flight.')).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  await guest.context.close()
})

test('a lost release response survives stale reconciliation through same-key replay', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const staleClaims = [context.claim]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false

  await page.route(`**/api/v1/projects/${context.project.id}/subgoals`, async (route) => {
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleClaims) })
      return
    }
    await route.continue()
  })
  await page.route(`**/api/v1/reservations/${context.claim.reservationId}/release`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (!committed) {
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
    await route.continue()
  })

  const main = await openProject(page, context)
  await main.getByRole('button', { name: `Release ${context.claim.subGoal}` }).click()
  const failed = page.locator('[data-subgoal-release="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this claim was released')
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-subgoal-release]')).toHaveCount(0)
  await expect(main.getByText('No sub-goals in flight.')).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
})
