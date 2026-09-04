/** Rendered acknowledgement recovery for both work-item comment projections. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, Identity, OpenSubGoal, Project } from '../contract/index.ts'
import { workItemCommentCreationId } from '../server/workItemCommentCreationIdentity.ts'
import { ms } from './budget.ts'

interface Arena {
  project: Project
  item: OpenSubGoal
  tenantId: string
}

async function arena(page: Page, stamp: string): Promise<Arena> {
  const meResponse = await page.request.get('/api/v1/me')
  expect(meResponse.ok()).toBe(true)
  const tenantId = ((await meResponse.json()) as Identity).tenant.id
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Comment recovery ${stamp}`, description: 'A test-owned comment recovery Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const guardedResponse = await page.request.post('/api/v1/relations/ops', {
    data: {
      op: {
        kind: 'share-project',
        projectId: project.id,
        projectName: project.name,
        shared: true,
      },
    },
  })
  expect(guardedResponse.ok()).toBe(true)
  const itemResponse = await page.request.post(`/api/v1/projects/${project.id}/open-subgoals`, {
    data: { subGoal: `Review the recovery ${stamp}`, type: 'charge', target: `budget:${stamp}` },
    headers: { 'Idempotency-Key': `item-${stamp}` },
  })
  expect(itemResponse.ok()).toBe(true)
  return { project, item: await itemResponse.json() as OpenSubGoal, tenantId }
}

async function openItem(page: Page, { project, item }: Arena) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}/work/${encodeURIComponent(item.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: item.subGoal, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  const form = main.locator('[data-work-item-comment-form]')
  await expect(form).toBeVisible()
  return { main, form }
}

async function comments(page: Page, projectId: string, itemId: string) {
  const response = await page.request.get(`/api/v1/projects/${projectId}/open-subgoals`)
  expect(response.ok()).toBe(true)
  const items = await response.json() as OpenSubGoal[]
  return items.find((item) => item.id === itemId)?.comments ?? []
}

test('a failed comment stays visible across projections and Retry posts it once', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const body = `Preserve this comment ${stamp}`
  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await page.route(`**/api/v1/projects/${context.project.id}/open-subgoals/${context.item.id}/comments`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
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

  let { main, form } = await openItem(page, context)
  const input = form.getByLabel(`Comment on ${context.item.subGoal}`)
  await input.fill(body)
  await form.getByRole('button', { name: 'Post', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })

  const failed = page.locator('[data-work-item-comment-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this comment was posted')
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  const openWork = main.getByRole('button', { name: /^Open work\b/ })
  if ((await openWork.getAttribute('aria-expanded')) === 'false') await openWork.click()
  const compactForm = main.locator('[data-work-item-comment-form]')
  await expect(compactForm.getByLabel(`Comment on ${context.item.subGoal}`)).toHaveValue(body)
  await expect(compactForm).toHaveAttribute('aria-busy', 'true')
  await main.getByRole('button', { name: context.item.subGoal, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.item.subGoal, exact: true })).toBeVisible()
  form = main.locator('[data-work-item-comment-form]')
  await expect(form.getByLabel(`Comment on ${context.item.subGoal}`)).toHaveValue(body)
  await expect(form).toHaveAttribute('aria-busy', 'true')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(main.getByText(body, { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({ body })
  const expectedId = workItemCommentCreationId(
    context.tenantId,
    context.project.id,
    context.item.id,
    keys[0]!,
  )
  expect((await comments(page, context.project.id, context.item.id)).filter((comment) => comment.id === expectedId)).toHaveLength(1)
})

test('a committed comment with a lost response stays held until exact reconciliation', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const body = `Recovered exact comment ${stamp}`
  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let sawRead!: () => void
  const readStarted = new Promise<void>((resolve) => { sawRead = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`**/api/v1/projects/${context.project.id}/open-subgoals**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.item.id}/comments`)) {
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

  const { main, form } = await openItem(page, context)
  const input = form.getByLabel(`Comment on ${context.item.subGoal}`)
  await input.fill(body)
  await form.getByRole('button', { name: 'Post', exact: true }).click()
  await readStarted
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue(body)
  await expect(input).toBeDisabled()

  releaseRead()
  await expect(main.getByText(body, { exact: true })).toBeVisible()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  const expectedId = workItemCommentCreationId(
    context.tenantId,
    context.project.id,
    context.item.id,
    keys[0]!,
  )
  expect((await comments(page, context.project.id, context.item.id)).filter((comment) => comment.id === expectedId)).toHaveLength(1)
  await expect(page.locator('[data-work-item-comment-creation]')).toHaveCount(0)
})
