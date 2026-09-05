/** Rendered acknowledgement and recovery for discussion actions. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { AppNotification, CreateProjectResponse, Discussion } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena {
  projectId: string
  projectName: string
  discussion: Discussion
}

const GRACE_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }

async function arena(page: Page, stamp: string, shared = false): Promise<Arena> {
  const projectName = `Discussion actions ${stamp}`
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: projectName, description: 'A test-owned discussion action arena.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  if (shared) {
    const grant = await page.request.post('/api/v1/grants', {
      data: {
        subject: { kind: 'project', id: project.id },
        audience: { kind: 'org', orgId: 'tenant-beta' },
        tier: 'comment',
      },
    })
    expect(grant.ok()).toBe(true)
  }
  const opened = await page.request.post('/api/v1/discussions', {
    data: {
      anchor: { ref: { kind: 'project', id: project.id } },
      firstPost: `Reviewed discussion ${stamp}`,
    },
  })
  expect(opened.ok()).toBe(true)
  return { projectId: project.id, projectName, discussion: await opened.json() as Discussion }
}

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  return { context, page: await context.newPage() }
}

async function openDiscussion(page: Page, context: Arena) {
  await page.goto(`/projects/${context.projectId}`)
  const section = page.locator('[data-resource-section="Discussion"]')
  const disclosure = section.locator('> div > button[aria-expanded]').first()
  await expect(disclosure).toHaveAttribute('aria-expanded', /true|false/, { timeout: ms(20_000) })
  if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click()
  const row = section.locator(`[data-discussion-post-id="${context.discussion.posts[0]!.id}"]`)
  await expect(row).toBeVisible({ timeout: ms(20_000) })
  return { section, row }
}

test('reaction retry preserves desired state and a lost report acknowledgement stays honest without a duplicate bell', async ({ browser }) => {
  test.setTimeout(ms(70_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, GRACE_HEADERS)
  try {
    const context = await arena(ada.page, Date.now().toString(36), true)
    const postId = context.discussion.posts[0]!.id
    const reactions: Array<{ key: string; body: { reacted?: boolean } }> = []
    let reactionFails = true
    await grace.page.route(`**/api/v1/discussions/${context.discussion.id}/posts/${postId}/react`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      reactions.push({
        key: route.request().headers()['idempotency-key'] ?? '',
        body: route.request().postDataJSON() as { reacted?: boolean },
      })
      if (reactionFails) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Simulated endorsement outage.' } }),
        })
        return
      }
      await route.continue()
    })

    const { section, row } = await openDiscussion(grace.page, context)
    let endorse = row.getByRole('button', { name: 'Endorse this post', exact: true })
    await endorse.click()
    await expect(section.getByRole('alert')).toContainText('Simulated endorsement outage.', { timeout: ms(20_000) })
    await expect(endorse).toHaveAttribute('aria-pressed', 'false')
    reactionFails = false
    await endorse.click()
    endorse = row.getByRole('button', { name: 'Remove your endorsement', exact: true })
    await expect(endorse).toHaveAttribute('aria-pressed', 'true', { timeout: ms(20_000) })
    expect(reactions).toHaveLength(2)
    expect(reactions.every(({ body }) => body.reacted === true)).toBe(true)
    expect(reactions.every(({ key }) => key.length > 0)).toBe(true)

    let reportAttempts = 0
    await grace.page.route(`**/api/v1/discussions/${context.discussion.id}/posts/${postId}/report`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      reportAttempts += 1
      if (reportAttempts === 1) {
        const committed = await route.fetch()
        expect(committed.ok()).toBe(true)
        await committed.body()
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
        })
        return
      }
      await route.continue()
    })
    let report = row.getByRole('button', { name: 'Report this post to the owner of this surface', exact: true })
    await report.click()
    await expect(section.getByRole('alert')).toContainText('Acknowledgement lost after commit.', { timeout: ms(20_000) })
    await expect(report).toBeEnabled()
    await report.click()
    report = row.getByRole('button', { name: 'Reported', exact: true })
    await expect(report).toBeDisabled({ timeout: ms(20_000) })
    expect(reportAttempts).toBe(2)

    const notifications = await (await ada.page.request.get('/api/v1/notifications')).json() as AppNotification[]
    expect(notifications.filter((item) =>
      item.kind === 'social.reported' && item.discussionId === context.discussion.id,
    )).toHaveLength(1)
    await ada.page.goto('/notifications')
    const bell = ada.page.getByText(`Grace Hopper reported a post on “${context.projectName}” — you hold the delete`, { exact: true })
    await bell.click()
    await expect(ada.page).toHaveURL(new RegExp(`/discussions/${context.discussion.id}$`))
  } finally {
    await grace.context.close()
    await ada.context.close()
  }
})

test('failed resolve stays held across navigation and Retry reuses its exact revision and key', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const context = await arena(page, Date.now().toString(36))
  const attempts: Array<{ key: string; body: { state?: string; expectedStateRevision?: number } }> = []
  let fail = true
  await page.route(`**/api/v1/discussions/${context.discussion.id}/resolve`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON() as { state?: string; expectedStateRevision?: number },
    })
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated lifecycle outage.' } }),
      })
      return
    }
    await route.continue()
  })

  let { section } = await openDiscussion(page, context)
  await section.getByRole('button', { name: 'Resolve this discussion', exact: true }).click()
  const notice = page.locator('[data-discussion-state-mutation="failed"]')
  await expect(notice).toContainText('Couldn’t confirm the discussion state', { timeout: ms(20_000) })
  await expect(section.getByRole('button', { name: 'Resolve this discussion', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Models', exact: true }).first().click()
  await expect(page).toHaveURL(/\/models$/)
  await expect(notice).toBeVisible()
  await page.goBack()
  section = page.locator('[data-resource-section="Discussion"]')
  await expect(section.getByRole('button', { name: 'Resolve this discussion', exact: true })).toBeDisabled({ timeout: ms(20_000) })

  fail = false
  await notice.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-discussion-state-mutation]')).toHaveCount(0, { timeout: ms(20_000) })
  await expect(section.getByRole('button', { name: 'Reopen this discussion', exact: true })).toBeEnabled({ timeout: ms(20_000) })
  expect(attempts).toHaveLength(2)
  expect(attempts[0]!.key).not.toBe('')
  expect(attempts[1]!.key).toBe(attempts[0]!.key)
  expect(attempts[0]!.body).toEqual({ state: 'resolved', expectedStateRevision: 0 })
  expect(attempts[1]!.body).toEqual(attempts[0]!.body)
})
