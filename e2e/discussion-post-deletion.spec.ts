/** Rendered recovery for exact, consent-bound discussion-post deletion. */
import { test, expect, type Page } from '@playwright/test'
import type { CreateProjectResponse, Discussion, DiscussionPost } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena {
  projectId: string
  discussion: Discussion
}

async function arena(page: Page, stamp: string, replies = 0): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Deletion recovery ${stamp}`, description: 'A test-owned discussion Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const openedResponse = await page.request.post('/api/v1/discussions', {
    data: {
      anchor: { ref: { kind: 'project', id: project.id } },
      firstPost: `Reviewed opening ${stamp}`,
    },
  })
  expect(openedResponse.ok()).toBe(true)
  let discussion = await openedResponse.json() as Discussion
  let parentId = discussion.posts[0]!.id
  for (let index = 0; index < replies; index += 1) {
    const response = await page.request.post(`/api/v1/discussions/${discussion.id}/posts`, {
      data: { body: `Reviewed reply ${index + 1} ${stamp}`, replyTo: parentId },
    })
    expect(response.ok()).toBe(true)
    discussion = await response.json() as Discussion
    parentId = discussion.posts.at(-1)!.id
  }
  return { projectId: project.id, discussion }
}

async function openDiscussion(page: Page, context: Arena) {
  await page.goto(`/projects/${context.projectId}`)
  const section = page.locator('[data-resource-section="Discussion"]')
  await expect(section.locator(`[data-discussion-post-id="${context.discussion.posts[0]!.id}"]`)).toBeVisible({ timeout: ms(20_000) })
  return section
}

test('pre-commit failure keeps the exact row held across navigation and Retry reuses one key', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const context = await arena(page, Date.now().toString(36))
  const target = context.discussion.posts[0]!
  const keys: string[] = []
  const bodies: Array<{ expectedPostIds?: string[] }> = []
  let fail = true
  await page.route(`**/api/v1/discussions/${context.discussion.id}/posts/${target.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as { expectedPostIds?: string[] })
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated deletion outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let section = await openDiscussion(page, context)
  const row = section.locator(`[data-discussion-post-id="${target.id}"]`)
  await row.getByRole('button', { name: 'Retract this post', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Retract this post?' })
  await expect(dialog).toContainText('cannot be undone')
  await dialog.getByRole('button', { name: 'Retract', exact: true }).click()

  const failed = page.locator('[data-discussion-post-deletion-notice="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether these posts were deleted', { timeout: ms(20_000) })
  await expect(row).toHaveAttribute('data-discussion-post-deletion', 'failed')
  await expect(row.getByRole('button', { name: 'Retract this post', exact: true }).first()).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  expect(bodies[0]?.expectedPostIds).toEqual([target.id])

  await page.getByRole('button', { name: 'Models', exact: true }).first().click()
  await expect(page).toHaveURL(/\/models$/)
  await page.goBack()
  section = page.locator('[data-resource-section="Discussion"]')
  const restored = section.locator(`[data-discussion-post-id="${target.id}"]`)
  await expect(restored).toHaveAttribute('data-discussion-post-deletion', 'failed', { timeout: ms(20_000) })
  await expect(restored.getByRole('button', { name: 'Retract this post', exact: true }).first()).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-discussion-post-deletion-notice]')).toHaveCount(0)
  await expect(restored).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect((await page.request.get(`/api/v1/discussions/${context.discussion.id}`)).status()).toBe(404)
})

test('lost cascade acknowledgement reconciles exact absence without a second DELETE', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const context = await arena(page, Date.now().toString(36), 2)
  const target = context.discussion.posts[0]!
  const reviewedIds = context.discussion.posts.map((post: DiscussionPost) => post.id)
  const attempts: Array<{ key: string; body: { expectedPostIds?: string[] } }> = []
  await page.route(`**/api/v1/discussions/${context.discussion.id}/posts/${target.id}?cascade=1`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON() as { expectedPostIds?: string[] },
    })
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  const section = await openDiscussion(page, context)
  const row = section.locator(`[data-discussion-post-id="${target.id}"]`)
  await row.getByRole('button', { name: 'Retract this post', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Retract this post?' })
  await dialog.getByText('Delete the 2 replies underneath as well').click()
  await dialog.getByRole('button', { name: 'Retract 3 posts', exact: true }).click()

  await expect(page.locator('[data-discussion-post-deletion-notice]')).toHaveCount(0, { timeout: ms(20_000) })
  await expect(row).toHaveCount(0)
  expect(attempts).toHaveLength(1)
  expect(attempts[0]!.key).not.toBe('')
  expect(new Set(attempts[0]!.body.expectedPostIds)).toEqual(new Set(reviewedIds))
  expect((await page.request.get(`/api/v1/discussions/${context.discussion.id}`)).status()).toBe(404)
})
