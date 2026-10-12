/** Rendered Project-work Contribution lifecycle against a local real MCP peer. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { OpenSubGoal, Project } from '../contract/index.ts'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture.ts'
import { newUser, openSection } from './social-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function api(page: Page, stack: { url: string }, method: string, path: string, data?: unknown, key = randomUUID()) {
  const response = await page.request.fetch(`${stack.url}${API}${path}`, {
    method, data, headers: { 'Idempotency-Key': key },
  })
  return { response, json: await response.json().catch(() => ({})) as any }
}

async function ownedWork(page: Page, stack: { url: string }, stamp: string) {
  const made = await api(page, stack, 'POST', '/projects', {
    name: `Project work lifecycle ${stamp}`, description: 'A test-owned Project for exact linked work.',
  })
  expect(made.response.ok()).toBe(true)
  const project = made.json.project as Project
  const work = await api(page, stack, 'POST', `/projects/${project.id}/open-subgoals`, {
    subGoal: `Publish reviewed record ${stamp}`, type: 'mcp.mutate', target: 'write',
    note: `Only the exact write tool may resolve ${stamp}.`,
  })
  expect(work.response.ok()).toBe(true)
  return { project, item: work.json as OpenSubGoal }
}

async function capture(page: Page, info: TestInfo, subject: ReturnType<Page['locator']>, stem: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await subject.evaluate((element) => element.scrollWidth <= element.clientWidth), `${stem} fits at ${viewport.width}`).toBe(true)
    await page.screenshot({ path: info.outputPath(`${stem}-${viewport.width}.png`) })
  }
}

async function captureFiveWidths(page: Page, info: TestInfo, subject: ReturnType<Page['locator']>, stem: string, required?: ReturnType<Page['locator']>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    if (required) await expect(required).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${stem}-${viewport.width}x${viewport.height}.png`) })
  }
}

async function expectRowAndTitleFit(row: ReturnType<Page['locator']>, title: ReturnType<Page['locator']>) {
  const geometry = await row.evaluate((element) => {
    const text = element.querySelector('button')
    if (!text) throw new Error('linked Contribution row has no title door')
    const rowBox = element.getBoundingClientRect()
    const textBox = text.getBoundingClientRect()
    return {
      rowWidth: element.clientWidth,
      rowScrollWidth: element.scrollWidth,
      titleWidth: text.clientWidth,
      titleScrollWidth: text.scrollWidth,
      rowLeft: rowBox.left,
      rowRight: rowBox.right,
      titleLeft: textBox.left,
      titleRight: textBox.right,
    }
  })
  expect(geometry.rowScrollWidth).toBeLessThanOrEqual(geometry.rowWidth)
  expect(geometry.titleScrollWidth).toBeLessThanOrEqual(geometry.titleWidth)
  expect(geometry.titleLeft).toBeGreaterThanOrEqual(geometry.rowLeft - 1)
  expect(geometry.titleRight).toBeLessThanOrEqual(geometry.rowRight + 1)
  await expect(title).toBeVisible()
}

async function openWork(page: Page, project: Project, item: OpenSubGoal) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}/work/${encodeURIComponent(item.id)}`)
  await expect(page.getByRole('heading', { name: item.subGoal, exact: true })).toBeVisible({ timeout: ms(20_000) })
}

async function createMcpBinding(page: Page, stack: { url: string }, endpoint: string, stamp: string) {
  const connection = await api(page, stack, 'POST', '/mcp-connections', {
    creationId: randomUUID(), label: `Work lifecycle peer ${stamp}`, endpoint, authentication: 'none',
  })
  expect(connection.response.ok()).toBe(true)
  const inspected = await api(page, stack, 'POST', `/mcp-connections/${connection.json.connection.id}/inspect`, {
    operationId: randomUUID(), expectedRevision: 0,
  })
  expect(inspected.response.ok()).toBe(true)
  return { connection: connection.json.connection }
}

test('Project owner creates, runs, and resolves a linked Contribution only after exact saved MCP success', async ({ page }, info) => {
  test.setTimeout(ms(180_000))
  const stack = await startMcpRouterStack()
  const fixture = await startMcpFixture({ toolName: 'write' })
  const cleanup = await proxyMcpApi(page, stack)
  let landPosts = 0
  try {
    const stamp = randomUUID().slice(0, 8)
    const { project, item } = await ownedWork(page, stack, stamp)
    await createMcpBinding(page, stack, fixture.url, stamp)
    await openWork(page, project, item)
    await page.getByRole('button', { name: 'Start contribution', exact: true }).click()
    const form = page.locator('[data-work-item-contribution-form]')
    await expect(form).toBeVisible()
    const title = `Reviewed work ${stamp} ${'x'.repeat(150)}`
    const summary = `Use only the approved write tool for ${stamp}.`
    await page.getByLabel('Contribution title', { exact: true }).fill(title)
    await page.getByLabel('Contribution summary', { exact: true }).fill(summary)
    await capture(page, info, form, 'project-work-contribution-create')
    expect(fixture.toolCalls).toHaveLength(0)
    await page.locator('[data-work-item-contribution-submit]').click()
    const contributionRoute = new RegExp(`/projects/${project.id}/changes/`)
    await expect(page).toHaveURL(contributionRoute)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeDisabled()
    await expect(page.locator('[data-linked-work-item-resolution]')).toContainText('successful saved result')
    expect(fixture.toolCalls).toHaveLength(0)

    await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
    await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: `Work lifecycle peer ${stamp} · write` })
    const args = { query: `exact approved write ${stamp}` }
    await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify(args))
    await page.getByLabel('Max acts 1', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const confirm = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(confirm).toBeVisible()
    expect(fixture.toolCalls).toHaveLength(0)
    await confirm.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    await expect(page.locator('[data-contribution-effect-status="done"]')).toContainText(args.query)
    expect(fixture.toolCalls).toEqual([{ name: 'write', arguments: args }])
    await expect(page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeEnabled()
    await capture(page, info, page.locator('[data-linked-work-item-resolution]'), 'project-work-contribution-ready')

    await page.route(`**/api/v1/projects/${project.id}/contributions/*/land`, async (route) => {
      landPosts += 1
      const url = new URL(route.request().url())
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
      expect(response.ok()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Landing acknowledgement lost.' } }) })
    })
    await page.getByRole('button', { name: 'Land and resolve work', exact: true }).click()
    const landedBadge = page.getByRole('main').getByText(/Landed · L\d+/).first()
    await expect(landedBadge).toBeVisible()
    await expect.poll(async () => {
      const read = await api(page, stack, 'GET', `/projects/${project.id}/open-subgoals`)
      return (read.json as OpenSubGoal[]).find((row) => row.id === item.id)?.status
    }).toBe('done')
    expect(landPosts).toBe(1)
    expect(fixture.toolCalls).toHaveLength(1)
    const linkedRead = await api(page, stack, 'GET', `/projects/${project.id}/contributions`)
    const linked = (linkedRead.json as any[]).find((row) => row.workItemId === item.id)
    expect(linked?.status).toBe('landed')
    expect(linked?.workItemResolution).toBe('closed')
    const itemRead = (await api(page, stack, 'GET', `/projects/${project.id}/open-subgoals`)).json as OpenSubGoal[]
    expect(itemRead.find((row) => row.id === item.id)?.contributionResolution?.contributionId).toBe(linked.id)
    await page.unroute(`**/api/v1/projects/${project.id}/contributions/*/land`)
    await openWork(page, project, item)
    await expect(page.getByText('Landed and resolved this work item', { exact: false })).toBeVisible()
    await capture(page, info, page.locator('[data-work-item-contribution]'), 'project-work-contribution-done')
    await capture(page, info, page.getByRole('main').locator('[data-resource-page]'), 'project-work-resolved-title')
    expect(fixture.toolCalls).toHaveLength(1, 'landing acknowledgement recovery never repeats the external MCP call')
  } finally {
    await cleanup(); await fixture.close(); await stack.close()
  }
})

test('Project backlog and shared work/detail doors render at every viewport while private Project remains walled', async ({ page, browser }, info) => {
  test.setTimeout(ms(80_000))
  const stack = await startMcpRouterStack()
  const cleanup = await proxyMcpApi(page, stack)
  const readerUser = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreignUser = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const readerCleanup = await proxyMcpApi(readerUser.page, stack)
  const foreignCleanup = await proxyMcpApi(foreignUser.page, stack)
  try {
    const shared = await ownedWork(page, stack, randomUUID().slice(0, 8))
    expect(shared.project.guardianId).toBeUndefined()
    // The owner reaches the item through the actual Open work section and its
    // title door; the deep link alone would not prove that rendered path.
    await openWork(page, shared.project, shared.item)
    await page.getByRole('main').getByRole('button', { name: shared.project.name, exact: true }).click()
    await expect(page.getByRole('heading', { name: shared.project.name, exact: true })).toBeVisible()
    await openSection(page, 'Open work')
    const openWorkSection = page.locator('section.group\\/section').filter({
      has: page.locator('[data-section-title]', { hasText: /^Open work$/i }),
    })
    await expect(openWorkSection).toContainText('Reservations and standing coordination are unavailable until this Project has a Guardian.')
    const ownerWorkDoor = openWorkSection.getByRole('button', { name: shared.item.subGoal, exact: true })
    await captureFiveWidths(page, info, openWorkSection, 'project-work-owner-open-backlog', ownerWorkDoor)
    await ownerWorkDoor.click()
    await expect(page.getByRole('heading', { name: shared.item.subGoal, exact: true })).toBeVisible()

    // Sharing installs Guardian coordination, so only do it after the unguarded
    // Project backlog's own visibility and title-door behavior were captured.
    expect((await api(page, stack, 'POST', '/relations/ops', { op: {
      kind: 'share-project', projectId: shared.project.id, projectName: shared.project.name, shared: true,
    } })).response.ok()).toBe(true)
    const longContributionTitle = 'ReaderVisibleLinkedContribution'.repeat(5)
    const contribution = await api(readerUser.page, stack, 'POST', `/projects/${shared.project.id}/contributions`, {
      title: longContributionTitle, summary: 'No owner authority conveyed.', workItemId: shared.item.id,
    })
    expect(contribution.response.ok()).toBe(true)

    // Shared visitor reaches both item and linked Contribution from the
    // Project's visible backlog, then sees but cannot use the owner-only land.
    await readerUser.page.goto(`/projects/${encodeURIComponent(shared.project.id)}`)
    await expect(readerUser.page.getByRole('heading', { name: shared.project.name, exact: true })).toBeVisible()
    await openSection(readerUser.page, 'Open work')
    const readerBacklog = readerUser.page.locator('section.group\\/section').filter({
      has: readerUser.page.locator('[data-section-title]', { hasText: /^Open work$/i }),
    })
    const readerWorkDoor = readerBacklog.getByRole('button', { name: shared.item.subGoal, exact: true })
    await captureFiveWidths(readerUser.page, info, readerBacklog, 'project-work-reader-open-backlog', readerWorkDoor)
    await readerWorkDoor.click()
    await expect(readerUser.page.getByRole('heading', { name: shared.item.subGoal, exact: true })).toBeVisible()
    const readerWorkPanel = readerUser.page.locator('[data-work-item-contribution]')
    const contributionDoor = readerUser.page.getByRole('button', { name: longContributionTitle, exact: true })
    await expect(readerWorkPanel).toContainText(longContributionTitle)
    const contributionRow = readerWorkPanel.locator('li').filter({ has: contributionDoor })
    await captureFiveWidths(readerUser.page, info, readerWorkPanel, 'project-work-reader-item-controls', contributionDoor)
    for (const viewport of VIEWPORTS) {
      await readerUser.page.setViewportSize(viewport)
      await settleArtifactPageRail(readerUser.page)
      await contributionRow.scrollIntoViewIfNeeded()
      await expectRowAndTitleFit(contributionRow, contributionDoor)
    }
    await contributionDoor.click()
    await expect(readerUser.page.getByRole('heading', { name: longContributionTitle, exact: true })).toBeVisible()
    await expect(readerUser.page.getByRole('button', { name: 'Land and resolve work', exact: true })).toBeDisabled()
    await captureFiveWidths(readerUser.page, info, readerUser.page.getByRole('button', { name: 'Land and resolve work', exact: true }), 'project-work-reader-contribution-controls')

    const privateWork = await ownedWork(page, stack, randomUUID().slice(0, 8))
    await foreignUser.page.goto(`/projects/${encodeURIComponent(privateWork.project.id)}/work/${encodeURIComponent(privateWork.item.id)}`)
    const unavailable = foreignUser.page.getByText('This project isn’t visible from this account (or no longer exists).', { exact: true })
    await expect(unavailable).toBeVisible()
    await expect(foreignUser.page.getByRole('main')).not.toContainText(privateWork.item.subGoal)
    await captureFiveWidths(foreignUser.page, info, foreignUser.page.getByRole('main'), 'project-work-foreign-unavailable', unavailable)
  } finally {
    await cleanup(); await readerCleanup(); await foreignCleanup()
    await readerUser.context.close(); await foreignUser.context.close(); await stack.close()
  }
})

test('lost linked-creation acknowledgement preserves exact editable intent across SPA navigation and retries once', async ({ page }, info) => {
  test.setTimeout(ms(120_000))
  const stack = await startMcpRouterStack()
  const cleanup = await proxyMcpApi(page, stack)
  let created = 0
  let hideList = false
  let firstBody: unknown
  let firstKey = ''
  try {
    const { project, item } = await ownedWork(page, stack, randomUUID().slice(0, 8))
    await openWork(page, project, item)
    await page.getByRole('button', { name: 'Start contribution', exact: true }).click()
    const title = `Held exact title ${randomUUID().slice(0, 8)}`
    const summary = `Held exact editable summary ${randomUUID().slice(0, 8)}`
    await page.getByLabel('Contribution title', { exact: true }).fill(title)
    await page.getByLabel('Contribution summary', { exact: true }).fill(summary)
    await page.route(`**/api/v1/projects/${project.id}/contributions`, async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        if (hideList) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        else await route.fallback()
        return
      }
      if (req.method() !== 'POST') return route.fallback()
      created += 1
      const { origin: _origin, ...headers } = req.headers()
      const body = req.postDataJSON()
      if (created === 1) {
        firstBody = body
        firstKey = req.headers()['idempotency-key'] ?? ''
      } else {
        expect(body).toEqual(firstBody)
        expect(req.headers()['idempotency-key']).toBe(firstKey)
      }
      const response = await route.fetch({ url: `${stack.url}/api/v1/projects/${project.id}/contributions`, headers })
      expect(response.ok()).toBe(true)
      if (created === 1) {
        hideList = true
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Creation acknowledgement lost.' } }) })
      } else {
        hideList = false
        await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() })
      }
    })
    await page.locator('[data-work-item-contribution-submit]').click()
    const notice = page.locator('[data-revisioned-mutation="contribution-create"][data-contribution-creation="failed"]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Couldn’t confirm whether this Contribution was declared.')
    await expect.poll(() => created).toBe(1)
    expect(firstBody).toEqual({ title, summary, subGoal: item.subGoal, workItemId: item.id })
    expect(firstKey).not.toBe('')
    // In-app Project and rail doors preserve the shared in-memory recovery queue.
    await page.getByRole('main').getByRole('button', { name: project.name, exact: true }).click()
    await expect(page.getByRole('main').getByRole('heading', { name: project.name, exact: true })).toBeVisible()
    await page.getByRole('complementary').getByRole('button', { name: item.subGoal, exact: true }).click()
    const form = page.locator('[data-work-item-contribution-form]')
    await expect(form).toBeVisible()
    await expect(page.getByLabel('Contribution title', { exact: true })).toHaveValue(title)
    await expect(page.getByLabel('Contribution summary', { exact: true })).toHaveValue(summary)
    await expect(page.locator('[data-work-item-contribution-submit]')).toBeDisabled()
    await capture(page, info, notice, 'project-work-contribution-create-held')
    await capture(page, info, form, 'project-work-contribution-create-held-form')
    hideList = false
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => created).toBe(2)
    await expect(notice).toHaveCount(0)
    await expect(form).toHaveCount(0)
    const row = page.getByRole('button', { name: title, exact: true })
    await expect(row).toBeVisible()
    const persisted = (await api(page, stack, 'GET', `/projects/${project.id}/contributions`)).json as any[]
    expect(persisted.filter((entry) => entry.workItemId === item.id)).toHaveLength(1)
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/changes/`))
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  } finally {
    await cleanup(); await stack.close()
  }
})

test('dismissing uncertain linked creation preserves the entire editable draft and does not submit again', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stack = await startMcpRouterStack()
  const cleanup = await proxyMcpApi(page, stack)
  let submissions = 0
  let hideList = false
  try {
    const { project, item } = await ownedWork(page, stack, randomUUID().slice(0, 8))
    await openWork(page, project, item)
    await page.getByRole('button', { name: 'Start contribution', exact: true }).click()
    const title = `Dismissed held title ${randomUUID().slice(0, 8)}`
    const summary = `Dismiss preserves all of this long authored prose: ${'constraint '.repeat(16)}${randomUUID()}`
    await page.getByLabel('Contribution title', { exact: true }).fill(title)
    await page.getByLabel('Contribution summary', { exact: true }).fill(summary)
    await page.route(`**/api/v1/projects/${project.id}/contributions`, async (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        if (hideList) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        else await route.fallback()
        return
      }
      if (req.method() !== 'POST') return route.fallback()
      submissions += 1
      const { origin: _origin, ...headers } = req.headers()
      const response = await route.fetch({ url: `${stack.url}/api/v1/projects/${project.id}/contributions`, headers })
      expect(response.ok()).toBe(true)
      hideList = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    })
    await page.locator('[data-work-item-contribution-submit]').click()
    const notice = page.locator('[data-revisioned-mutation="contribution-create"][data-contribution-creation="failed"]')
    await expect(notice).toBeVisible()
    await expect.poll(() => submissions).toBe(1)
    const form = page.locator('[data-work-item-contribution-form]')
    await expect(page.getByLabel('Contribution title', { exact: true })).toHaveValue(title)
    await expect(page.getByLabel('Contribution summary', { exact: true })).toHaveValue(summary)
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(form).toBeVisible()
    await expect(page.getByLabel('Contribution title', { exact: true })).toHaveValue(title)
    await expect(page.getByLabel('Contribution summary', { exact: true })).toHaveValue(summary)
    expect(submissions).toBe(1, 'Dismiss is local recovery-state cleanup, never a second POST')
  } finally {
    await cleanup(); await stack.close()
  }
})
