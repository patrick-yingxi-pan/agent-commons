/** Rendered Routine Stop uses the real router/store and exact durable run identity. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { ScheduledRun, ScheduledTask, ScheduleTemplate } from '../contract/index.ts'
import { startMcpRouterStack, proxyMcpApi, type McpRouterStack } from './mcp-fixture.ts'
import { ms } from './budget.ts'
import { store } from '../server/store/index.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

type Principal = { userId: string; tenantId: string }
const owner: Principal = { userId: 'user-ada', tenantId: 'tenant-acme' }
const sharedReader: Principal = { userId: 'user-grace', tenantId: 'tenant-beta' }
const foreignReader: Principal = { userId: 'user-zeta', tenantId: 'tenant-zeta' }

function headers(principal: Principal) {
  return { 'content-type': 'application/json', 'x-user-id': principal.userId, 'x-tenant-id': principal.tenantId }
}

async function api<T>(stack: McpRouterStack, principal: Principal, path: string, method = 'GET', body?: unknown,
  extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${stack.url}/api/v1${path}`, {
    method,
    headers: { ...headers(principal), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`)
  return text ? JSON.parse(text) as T : undefined as T
}

async function createRoutine(stack: McpRouterStack, principal: Principal, name: string): Promise<ScheduledTask> {
  const templates = await api<ScheduleTemplate[]>(stack, principal, '/schedule-templates')
  const template = templates[0]
  if (!template) throw new Error('The real router exposed no Routine template')
  return api<ScheduledTask>(stack, principal, '/schedules', 'POST', {
    seed: { ...template.seed, name, enabled: true, runs: [] },
  })
}

async function createQueuedRun(stack: McpRouterStack, principal: Principal, taskId: string): Promise<ScheduledRun> {
  return api<ScheduledRun>(stack, principal, `/schedules/${encodeURIComponent(taskId)}/run`, 'POST')
}

async function readRoutine(stack: McpRouterStack, principal: Principal, taskId: string): Promise<ScheduledTask> {
  const schedules = await api<ScheduledTask[]>(stack, principal, '/schedules')
  const task = schedules.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Routine ${taskId} was not in its owner's schedule list`)
  return task
}

async function connectPage(page: Page, stack: McpRouterStack, principal: Principal): Promise<() => Promise<void>> {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': principal.userId, 'x-tenant-id': principal.tenantId })
  return proxyMcpApi(page, stack)
}

async function openRoutine(page: Page, task: ScheduledTask) {
  await page.goto(`/scheduled/${task.id}`)
  await expect(page.getByRole('heading', { name: task.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
}

test('real rendered Stop commits a queued run and preserves cadence at all five canonical sizes', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(90_000))
  const stack = await startMcpRouterStack()
  const dispose = await connectPage(page, stack, owner)
  try {
    const task = await createRoutine(stack, owner, `Stop across sizes ${Date.now().toString(36)}`)
    const cadence = { enabled: task.enabled, next: task.next, nextFireAt: task.nextFireAt, revision: task.revision }

    for (const [index, viewport] of VIEWPORTS.entries()) {
      await page.setViewportSize(viewport)
      const run = await createQueuedRun(stack, owner, task.id)
      expect(run.status).toBe('running')
      await openRoutine(page, task)
      const stop = page.getByRole('button', { name: 'Stop this run', exact: true })
      await expect(stop).toBeVisible()
      await expect(stop).toBeInViewport()
      await stop.hover()
      const scope = page.locator('p').filter({ hasText: /^(Stop affects only this run|Stops only this run)[.;]/ })
      await expect(scope).toBeVisible()
      expect(await scope.evaluate(element => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth
      }), `Stop consequence copy is fully contained at ${viewport.width}×${viewport.height}`).toBe(true)
      const stopGeometry = await stop.evaluate(element => {
        const box = element.getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          withinViewport: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }
      })
      expect(stopGeometry.withinViewport, `Stop fits ${viewport.width}×${viewport.height}`).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `document has no horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(true)
      const activeScreenshot = testInfo.outputPath(`routine-stop-active-${viewport.width}x${viewport.height}.png`)
      await page.screenshot({ path: activeScreenshot, animations: 'disabled' })
      await testInfo.attach(`routine-stop-active-${viewport.width}x${viewport.height}`, { path: activeScreenshot, contentType: 'image/png' })
      await stop.focus()
      await page.keyboard.press('Enter')

      await expect(page.getByRole('button', { name: 'Stop this run', exact: true })).toHaveCount(0)
      const history = page.locator('[data-resource-section="Recent runs"]').first()
      const historyToggle = history.locator(':scope > div > button').first()
      if (await historyToggle.getAttribute('aria-expanded') === 'false') await historyToggle.click()
      const stoppedSummary = history.getByText('Stopped by request', { exact: true }).first()
      await expect(stoppedSummary).toBeVisible()
      await stoppedSummary.scrollIntoViewIfNeeded()
      const summaryGeometry = await stoppedSummary.evaluate(element => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      })
      expect(summaryGeometry, `stopped history fits ${viewport.width}×${viewport.height}`).toBe(true)
      const historyScreenshot = testInfo.outputPath(`routine-stop-${viewport.width}x${viewport.height}.png`)
      await page.screenshot({ path: historyScreenshot, animations: 'disabled' })
      await testInfo.attach(`routine-stop-${viewport.width}x${viewport.height}`, { path: historyScreenshot, contentType: 'image/png' })
      const current = await readRoutine(stack, owner, task.id)
      const stopped = current.runs.find((candidate) => candidate.id === run.id)
      expect(stopped?.status, `viewport ${viewport.width}×${viewport.height}`).toBe('cancelled')
      expect(current.lastStatus).toBe('cancelled')
      expect({ enabled: current.enabled, next: current.next, nextFireAt: current.nextFireAt, revision: current.revision }).toEqual(cadence)

      const listRun = await createQueuedRun(stack, owner, task.id)
      await page.goto('/scheduled')
      const listRow = page.getByRole('main').locator('div.group').filter({
        has: page.getByRole('button', { name: task.name, exact: true }),
      })
      await listRow.hover()
      const listStop = listRow.getByRole('button', { name: 'Stop this run', exact: true })
      await expect(listStop).toBeVisible()
      await expect(listStop).toBeInViewport()
      await listStop.click()
      await expect.poll(async () => (await readRoutine(stack, owner, task.id)).runs.find(candidate => candidate.id === listRun.id)?.status).toBe('cancelled')
      if (index < VIEWPORTS.length - 1) await page.goto('about:blank')
    }
  } finally {
    await dispose()
    await stack.close()
  }
})

test('a rejected Stop controller stays held with honest recovery and sends nothing before reload', async ({ page }, testInfo) => {
  test.setTimeout(ms(70_000))
  const stack = await startMcpRouterStack()
  const dispose = await connectPage(page, stack, owner)
  const runtimeModule = /\/src\/controller\/scheduleRunStopRuntime(?:\.ts)?(?:\?|$)/
  let intercepted = 0
  let stopRequests = 0
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/schedules\/[^/]+\/runs\/[^/]+\/stop$/.test(new URL(request.url()).pathname)) stopRequests++
  })
  await page.route(runtimeModule, async (route) => {
    intercepted++
    await route.abort('failed')
  })
  try {
    const task = await createRoutine(stack, owner, `Stop controller recovery ${Date.now().toString(36)}`)
    const run = await createQueuedRun(stack, owner, task.id)
    await openRoutine(page, task)
    expect(intercepted, 'page admission does not eagerly load the Stop controller').toBe(0)
    await page.getByRole('button', { name: 'Stop this run', exact: true }).click()
    const notice = page.locator('[data-schedule-run="failed"]')
    await expect(notice).toContainText('No Stop request was sent')
    expect(intercepted).toBe(1)
    expect(stopRequests).toBe(0)
    await expect(page.getByRole('button', { name: 'Stopping this run…', exact: true })).toBeDisabled()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      expect(await notice.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth
      }), `Stop recovery fits ${viewport.width}×${viewport.height}`).toBe(true)
      const screenshot = testInfo.outputPath(`routine-stop-load-failure-${viewport.width}x${viewport.height}.png`)
      await page.screenshot({ path: screenshot, animations: 'disabled' })
      await testInfo.attach(`routine-stop-load-failure-${viewport.width}x${viewport.height}`, { path: screenshot, contentType: 'image/png' })
    }
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(notice).toContainText('No Stop request was sent')
    expect(stopRequests).toBe(0)
    expect((await readRoutine(stack, owner, task.id)).runs.find((candidate) => candidate.id === run.id)?.status).toBe('running')
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop this run', exact: true })).toBeEnabled()

    // Browsers cache failed module admission. Reload is explicit and does not
    // replay the discarded intent; a new person activation is still required.
    await page.unroute(runtimeModule)
    await page.reload()
    await expect(page.getByRole('heading', { name: task.name, exact: true })).toBeVisible()
    expect(stopRequests).toBe(0)
    await page.getByRole('button', { name: 'Stop this run', exact: true }).click()
    await expect.poll(async () => (await readRoutine(stack, owner, task.id)).runs.find((candidate) => candidate.id === run.id)?.status).toBe('cancelled')
    expect(stopRequests).toBe(1)
    expect(pageErrors, 'a handled lazy-load failure never becomes an unhandled page error').toEqual([])
  } finally {
    await dispose()
    await stack.close()
  }
})

test('a lost Stop acknowledgement retries only its frozen run after a newer run exists', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack()
  const dispose = await connectPage(page, stack, owner)
  try {
    const task = await createRoutine(stack, owner, `Stop retry exact target ${Date.now().toString(36)}`)
    const cadence = { enabled: task.enabled, next: task.next, nextFireAt: task.nextFireAt, revision: task.revision }
    const original = await createQueuedRun(stack, owner, task.id)
    const routeKeys: string[] = []
    let attempts = 0
    let failReconciliationRead = false
    let reconciliationFailureObserved = false
    await page.route('**/api/v1/schedules', async (route) => {
      if (route.request().method() === 'GET' && failReconciliationRead) {
        failReconciliationRead = false
        reconciliationFailureObserved = true
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary reconciliation failure' }) })
        return
      }
      await route.fallback()
    })
    await page.route(`**/api/v1/schedules/${task.id}/runs/${original.id}/stop`, async (route) => {
      attempts++
      routeKeys.push(route.request().headers()['idempotency-key'] ?? '')
      if (attempts === 1) {
        const requestUrl = new URL(route.request().url())
        const committed = await route.fetch({ url: `${stack.url}${requestUrl.pathname}${requestUrl.search}` })
        expect(committed.status()).toBe(200, 'the exact real Stop commits before its response is lost')
        failReconciliationRead = true
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'stop acknowledgement unavailable' }) })
        return
      }
      const requestUrl = new URL(route.request().url())
      const committed = await route.fetch({ url: `${stack.url}${requestUrl.pathname}${requestUrl.search}` })
      await route.fulfill({ response: committed })
    })

    await openRoutine(page, task)
    await page.getByRole('button', { name: 'Stop this run', exact: true }).click()
    const failure = page.locator('[data-revisioned-mutation="routine-run"]')
    await expect(failure).toContainText('Couldn’t confirm Stop. The run may still be active.')
    await expect(failure.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    expect(attempts).toBe(1)
    expect(reconciliationFailureObserved, 'the post-commit reconciliation GET also failed, so Retry remains actionable').toBe(true)

    const actualAfterLostAck = await readRoutine(stack, owner, task.id)
    expect(actualAfterLostAck.runs.find((run) => run.id === original.id)?.status).toBe('cancelled', 'the first request committed despite its lost response')
    const newer = await createQueuedRun(stack, owner, task.id)
    expect(newer.id).not.toBe(original.id)
    expect(newer.status).toBe('running')

    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(failure).toHaveCount(0)
    expect(attempts).toBe(2)
    expect(routeKeys[0]).not.toBe('')
    expect(routeKeys[1]).toBe(routeKeys[0])
    const current = await readRoutine(stack, owner, task.id)
    expect(current.runs.find((run) => run.id === original.id)?.status).toBe('cancelled')
    expect(current.runs.find((run) => run.id === newer.id)?.status).toBe('running')
    expect({ enabled: current.enabled, next: current.next, nextFireAt: current.nextFireAt, revision: current.revision }).toEqual(cadence)
  } finally {
    await dispose()
    await stack.close()
  }
})

test('a completion that wins before Stop remains completed in the rendered history', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stack = await startMcpRouterStack()
  const dispose = await connectPage(page, stack, owner)
  try {
    const task = await createRoutine(stack, owner, `Stop completion wins ${Date.now().toString(36)}`)
    const run = await createQueuedRun(stack, owner, task.id)
    await openRoutine(page, task)
    const context = store.routineExecutionContext(task.id, run.id)
    if (!context) throw new Error('The real queued run has no execution context')
    const completed = store.completeScheduleRun(task.id, run.id,
      { id: `completion-${run.id}`, role: 'assistant', content: 'Known completed result.' },
      { agentId: context.agent.id, providerId: context.provider.id })
    expect(completed?.status).toBe('ok')
    const frozen = structuredClone(completed)

    // The page has no event stream in this fixture, so it still holds the real
    // pre-race running row. The server must return the winning terminal row.
    await page.getByRole('button', { name: 'Stop this run', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop this run', exact: true })).toHaveCount(0)
    const current = await readRoutine(stack, owner, task.id)
    expect(current.runs.find((candidate) => candidate.id === run.id)).toEqual(frozen)
  } finally {
    await dispose()
    await stack.close()
  }
})

test('rail, Project and detail Stop controls stay owner-only for shared and foreign readers', async ({ page, browser }) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack()
  const disposeOwner = await connectPage(page, stack, owner)
  const reader = await browser.newPage()
  const disposeReader = await connectPage(reader, stack, sharedReader)
  const foreign = await browser.newPage()
  const disposeForeign = await connectPage(foreign, stack, foreignReader)
  try {
    const task = await createRoutine(stack, owner, `Shared Stop ownership ${Date.now().toString(36)}`)
    const granted = await api<unknown>(stack, owner, '/grants', 'POST', {
      subject: { kind: 'schedule', id: task.id },
      audience: { kind: 'org', orgId: sharedReader.tenantId },
      tier: 'view',
    })
    expect(granted).toBeTruthy()
    const railRun = await createQueuedRun(stack, owner, task.id)
    await page.goto('/')
    const sections = page.getByRole('navigation', { name: 'Sections' })
    const routinesToggle = sections.getByRole('button', { name: /^(Expand|Collapse) Routines$/ })
    if (await routinesToggle.getAttribute('aria-expanded') === 'false') await routinesToggle.click()
    const routinesTree = sections.locator('[data-section-tree="scheduled"]')
    const routineRow = routinesTree.locator('[data-routine-row]').filter({ hasText: task.name })
    await expect(routineRow).toBeVisible()
    await routineRow.getByRole('button', { name: `Actions for ${task.name}`, exact: true }).click()
    await page.getByRole('menu', { name: `Actions for ${task.name}`, exact: true })
      .getByRole('menuitem', { name: 'Stop this run', exact: true }).click()
    await expect.poll(async () => (await readRoutine(stack, owner, task.id)).runs.find(run => run.id === railRun.id)?.status).toBe('cancelled')

    const projectResult = await api<{ project: { id: string; name: string } }>(stack, owner, '/projects', 'POST', {
      name: `Stop project ${Date.now().toString(36)}`,
    })
    const project = projectResult.project
    const relation = await api<unknown>(stack, owner, '/relations/ops', 'POST', {
      op: { kind: 'link-schedule-project', scheduleId: task.id, scheduleName: task.name, projectId: project.id, projectName: project.name },
    }, { 'idempotency-key': `schedule-stop-project-${Date.now()}-${Math.random()}` })
    expect(relation).toBeTruthy()
    const projectRun = await createQueuedRun(stack, owner, task.id)
    await page.goto(`/projects/${project.id}`)
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    const projectRoutines = page.locator('[data-resource-section="Routines"]').first()
    const projectRoutinesToggle = projectRoutines.locator(':scope > div > button').first()
    if (await projectRoutinesToggle.getAttribute('aria-expanded') === 'false') await projectRoutinesToggle.click()
    const projectStop = projectRoutines.getByRole('button', { name: 'Stop this run', exact: true })
    await expect(projectStop).toBeVisible()
    await projectStop.click()
    await expect.poll(async () => (await readRoutine(stack, owner, task.id)).runs.find(run => run.id === projectRun.id)?.status).toBe('cancelled')

    const sharedRun = await createQueuedRun(stack, owner, task.id)
    await openRoutine(page, task)
    await expect(page.getByRole('button', { name: 'Stop this run', exact: true })).toBeVisible()
    await openRoutine(reader, task)
    await expect(reader.getByRole('button', { name: 'Stop this run', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: 'Run now', exact: true })).toHaveCount(0)

    await foreign.goto(`/scheduled/${task.id}`)
    await expect(foreign.getByRole('button', { name: 'Stop this run', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await api<ScheduledTask[]>(stack, foreignReader, '/schedules'))
      .some((candidate) => candidate.id === task.id)).toBe(false)

    const denied = await fetch(`${stack.url}/api/v1/schedules/${encodeURIComponent(task.id)}/runs/${encodeURIComponent(sharedRun.id)}/stop`, {
      method: 'POST', headers: headers(sharedReader),
    })
    expect(denied.status).toBe(404, 'a shared reader cannot stop and the route hides write authority')
    const stillRunning = await readRoutine(stack, owner, task.id)
    expect(stillRunning.runs.find((candidate) => candidate.id === sharedRun.id)?.status).toBe('running')
  } finally {
    await disposeOwner()
    await disposeReader()
    await disposeForeign()
    await reader.close()
    await foreign.close()
    await stack.close()
  }
})
