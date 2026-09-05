/** Rendered acknowledgement recovery for Contribution timeline comments. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Identity, Project } from '../contract/index.ts'
import { contributionCommentCreationId } from '../server/contributionCommentCreationIdentity.ts'
import { ms } from './budget.ts'

interface Arena {
  project: Project
  contribution: Contribution
  tenantId: string
}

async function arena(page: Page, stamp: string): Promise<Arena> {
  const meResponse = await page.request.get('/api/v1/me')
  expect(meResponse.ok()).toBe(true)
  const tenantId = ((await meResponse.json()) as Identity).tenant.id
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Contribution comment recovery ${stamp}`, description: 'A test-owned comment Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Discuss durable work ${stamp}`, summary: 'Comments remain part of the landing record.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  return { project, contribution: await contributionResponse.json() as Contribution, tenantId }
}

async function openContribution(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  return { main, form: main.locator('[data-contribution-comment-form]') }
}

async function currentContribution(page: Page, context: Arena): Promise<Contribution> {
  const response = await page.request.get(`/api/v1/projects/${context.project.id}/contributions`)
  expect(response.ok()).toBe(true)
  const rows = await response.json() as Contribution[]
  return rows.find((candidate) => candidate.id === context.contribution.id)!
}

test('a failed Contribution comment keeps its exact draft through navigation and Retry posts once', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const body = `Keep this review thought ${stamp}`
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`
  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON())
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated comment outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let { main, form } = await openContribution(page, context)
  const input = form.getByLabel(`Comment on ${context.contribution.title}`)
  await input.fill(body)
  await form.getByRole('button', { name: 'Post', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })

  const failed = page.locator('[data-contribution-comment-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Contribution comment was posted')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible()
  form = main.locator('[data-contribution-comment-form]')
  await expect(form.getByLabel(`Comment on ${context.contribution.title}`)).toHaveValue(body)
  await expect(form).toHaveAttribute('aria-busy', 'true')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(main.getByText(body, { exact: true })).toBeVisible()
  await expect(page.locator('[data-contribution-comment-creation]')).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({ body })
  const expectedId = contributionCommentCreationId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
})

test('a committed Contribution comment stays frozen until exact reconciliation after response loss', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const body = `Recover this exact aftermath ${stamp}`
  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let sawRead!: () => void
  const readStarted = new Promise<void>((resolve) => { sawRead = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().url().endsWith(`/${context.contribution.id}/comments`)
    ) {
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

  const { main, form } = await openContribution(page, context)
  const input = form.getByLabel(`Comment on ${context.contribution.title}`)
  await input.fill(body)
  await form.getByRole('button', { name: 'Post', exact: true }).click()
  await readStarted
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeEnabled()

  releaseRead()
  await expect(main.getByText(body, { exact: true })).toBeVisible()
  await expect(page.locator('[data-contribution-comment-creation]')).toHaveCount(0)
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  const expectedId = contributionCommentCreationId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
})
