/** Rendered acknowledgement and recovery for discussion actions. */
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import type { AppNotification, CreateProjectResponse, Discussion } from '../contract/index.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'

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

async function assertPostControlSeparation(section: Locator, label: string) {
  const overlaps = await section.locator('[data-discussion-post-id] button').evaluateAll(buttons => {
    const targets = buttons.map(button => ({
      action: button.getAttribute('data-discussion-post-action'),
      name: button.getAttribute('aria-label') ?? button.textContent,
      rect: button.getBoundingClientRect(),
    })).filter(target => target.rect.width > 0 && target.rect.height > 0)
    return targets.flatMap((target, index) => {
      if (target.action !== 'fold-toggle' && target.action !== 'unfold-branch') return []
      return targets.flatMap((other, otherIndex) => {
        if (index === otherIndex) return []
        const width = Math.min(target.rect.right, other.rect.right) - Math.max(target.rect.left, other.rect.left)
        const height = Math.min(target.rect.bottom, other.rect.bottom) - Math.max(target.rect.top, other.rect.top)
        return width > 0.5 && height > 0.5 ? [{ target: target.name, other: other.name, width, height }] : []
      })
    })
  })
  expect(overlaps, `${label}: fold targets cannot cover another post control or byline door`).toEqual([])
}

test('all seven post control families keep 24px targets and full-page AA through folding and confirmation at every viewport', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, GRACE_HEADERS)
  try {
    const context = await arena(ada.page, `targets-${crypto.randomUUID()}`, true)
    const rootId = context.discussion.posts[0]!.id
    for (const body of ['First reviewed reply', 'Second reviewed reply']) {
      const reply = await grace.page.request.post(`/api/v1/discussions/${context.discussion.id}/posts`, {
        data: { body, replyTo: rootId },
      })
      expect(reply.ok()).toBe(true)
    }
    const neighboringRoot = await ada.page.request.post(`/api/v1/discussions/${context.discussion.id}/posts`, {
      data: { body: 'Adjacent root proves collapsed branch controls cannot cover the next row.' },
    })
    expect(neighboringRoot.ok()).toBe(true)
    const owner = await openDiscussion(ada.page, context)
    const commenter = await openDiscussion(grace.page, context)
    await expect(owner.section.locator('[data-discussion-post-id]')).toHaveCount(4)
    await expect(commenter.section.locator('[data-discussion-post-id]')).toHaveCount(4)
    let deletes = 0
    ada.page.on('request', request => {
      if (request.method() === 'DELETE' && new URL(request.url()).pathname.startsWith(`/api/v1/discussions/${context.discussion.id}/posts/`)) deletes += 1
    })
    for (const viewport of [
      { width: 320, height: 700 }, { width: 375, height: 812 },
      { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
    ]) {
      const size = `${viewport.width}x${viewport.height}`
      for (const [role, viewer, surface, families] of [
        ['owner', ada, owner, ['delete', 'endorse', 'fold-others', 'fold-toggle', 'reply']],
        ['commenter', grace, commenter, ['delete', 'endorse', 'fold-others', 'fold-toggle', 'reply', 'report']],
      ] as const) {
        await viewer.page.setViewportSize(viewport)
        await settledNarrowRail(viewer.page)
        const endorse = surface.row.getByRole('button', { name: 'Endorse this post', exact: true }).first()
        await endorse.hover()
        await settledOpaquePaint(endorse)
        const actions = surface.section.locator('[data-discussion-post-action]').filter({ visible: true })
        await expect(actions).toHaveCount(viewport.width < 640 ? 20 : 21)
        const targets = await actions.evaluateAll(elements => elements.map(element => {
          const { width, height } = element.getBoundingClientRect()
          return { action: element.getAttribute('data-discussion-post-action'), name: element.getAttribute('aria-label'), width, height }
        }))
        expect([...new Set(targets.map(target => target.action))].sort()).toEqual([
          ...families, ...(viewport.width < 640 ? [] : ['unfold-branch']),
        ].sort())
        for (const target of targets) {
          expect(target.width, `${role} ${target.name} width at ${size}`).toBeGreaterThanOrEqual(24)
          expect(target.height, `${role} ${target.name} height at ${size}`).toBeGreaterThanOrEqual(24)
        }
        // The same physical face preserves each viewer's real authority.
        expect(targets.filter(target => target.name === 'Retract this post')).toHaveLength(2)
        expect(targets.filter(target => target.name === 'Delete this post')).toHaveLength(role === 'owner' ? 2 : 0)
        expect(targets.filter(target => target.action === 'report')).toHaveLength(role === 'owner' ? 0 : 2)
        await assertPostControlSeparation(surface.section, `${role} expanded ${size}`)
        await expect.poll(() => viewer.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        await assertWcag22Aa(viewer.page, `${role} discussion actions closed ${size}`)
        await viewer.page.screenshot({ path: testInfo.outputPath(`post-actions-${role}-${size}.png`) })
        if (role === 'owner') {
          const toggle = surface.row.locator('[data-discussion-post-action="fold-toggle"]').first()
          const originalToggle = await toggle.elementHandle()
          if (!originalToggle) throw new Error('The reviewed fold toggle is missing')
          try {
            await toggle.focus()
            await toggle.press('Enter')
            await expect(toggle).toHaveAttribute('aria-expanded', 'false')
            expect(await originalToggle.evaluate(element => element.isConnected && element === document.activeElement), 'folding retains the same focused node').toBe(true)
            await expect(surface.section.locator('[data-discussion-post-id]')).toHaveCount(2)
            const stub = surface.row.locator('[data-discussion-post-stub]').first()
            const layout = await stub.evaluate(element => {
              const box = element.getBoundingClientRect()
              return {
                width: element.clientWidth,
                scrollWidth: element.scrollWidth,
                children: Array.from(element.children).map(child => {
                  const rect = child.getBoundingClientRect()
                  return { left: rect.left - box.left, right: rect.right - box.left, top: rect.top, bottom: rect.bottom }
                }),
              }
            })
            expect(layout.children, 'author, age, synopsis and reply count all remain in the stub').toHaveLength(4)
            expect(layout.scrollWidth, `collapsed stub stays within its local width at ${size}`).toBeLessThanOrEqual(layout.width + 1)
            for (const child of layout.children) {
              expect(child.left).toBeGreaterThanOrEqual(-1)
              expect(child.right).toBeLessThanOrEqual(layout.width + 1)
            }
            if (viewport.width < 640) {
              const synopsis = stub.locator('[data-discussion-post-synopsis]')
              expect(await synopsis.evaluate(element => element.clientWidth), `readable synopsis at ${size}`).toBeGreaterThanOrEqual(120)
              expect(await synopsis.evaluate(element => element.scrollWidth > element.clientWidth), 'the long fixture really exercises bounded ellipsis').toBe(true)
              expect(layout.children[2]!.top, 'the narrow synopsis owns a second row below identity').toBeGreaterThanOrEqual(layout.children[0]!.bottom)
            }
            await toggle.hover()
            const branch = surface.row.locator('[data-discussion-post-action="unfold-branch"]').first()
            if (viewport.width < 640) await expect(branch).toBeHidden()
            else await settledOpaquePaint(branch)
            const collapsed = surface.section.locator('[data-discussion-post-action]').filter({ visible: true })
            await expect(collapsed).toHaveCount(viewport.width < 640 ? 6 : 7)
            for (const control of await collapsed.all()) {
              const box = await control.boundingBox()
              expect(box?.width).toBeGreaterThanOrEqual(24)
              expect(box?.height).toBeGreaterThanOrEqual(24)
            }
            await assertPostControlSeparation(surface.section, `owner collapsed beside an adjacent root ${size}`)
            await assertWcag22Aa(viewer.page, `owner collapsed discussion ${size}`)
            await viewer.page.screenshot({ path: testInfo.outputPath(`post-actions-collapsed-${size}.png`) })
            if (viewport.width < 640) await toggle.press('Enter')
            else await branch.click()
            await expect(toggle).toHaveAttribute('aria-expanded', 'true')
            expect(await originalToggle.evaluate(element => element.isConnected), 'unfolding preserves the same disclosure node').toBe(true)
            await expect(surface.section.locator('[data-discussion-post-id]')).toHaveCount(4)
          } finally {
            await originalToggle.dispose()
          }
        }
      }
      await owner.row.getByRole('button', { name: 'Retract this post', exact: true }).first().click()
      const dialog = ada.page.getByRole('dialog', { name: 'Retract this post?', exact: true })
      await settledOpaquePaint(dialog)
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeFocused()
      await expect(cancel).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Retract', exact: true })).toBeInViewport()
      await expect(dialog.getByRole('checkbox', { name: 'Delete the 2 replies underneath as well', exact: true })).not.toBeChecked()
      // Audit the full page: the modal must not hide undersized background acts
      // from this regression, which was first found with confirmation open.
      await assertWcag22Aa(ada.page, `owner discussion actions confirmation open ${size}`)
      await ada.page.screenshot({ path: testInfo.outputPath(`post-actions-confirm-${size}.png`) })
      await cancel.click()
      await expect(dialog).toHaveCount(0)
    }
    expect(deletes).toBe(0)
    const unchanged = await ada.page.request.get(`/api/v1/discussions/${context.discussion.id}`)
    expect(unchanged.ok()).toBe(true)
    expect((await unchanged.json() as Discussion).posts).toHaveLength(4)
  } finally {
    await grace.context.close()
    await ada.context.close()
  }
})

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
