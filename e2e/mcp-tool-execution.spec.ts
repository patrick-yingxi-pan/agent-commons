import { test, expect, type Locator, type Page } from '@playwright/test'
import type { Session } from '../contract/index.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpFixture, startMcpRouterStack, type McpRouterStack } from './mcp-fixture.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function settleResponsiveView(page: Page) {
  // Responsive shell changes can remount the thread. Let the 280ms entrance
  // animation begin before polling so an empty between-layout frame cannot
  // satisfy the visual-settle condition vacuously.
  await page.waitForTimeout(350)
  await expect.poll(() => page.evaluate(() => {
    const animatedTurns = [...document.querySelectorAll<HTMLElement>('[data-turn]')]
    return animatedTurns.length >= 2
      && animatedTurns.every(turn => Number.parseFloat(getComputedStyle(turn).opacity) >= 0.99)
  })).toBe(true)
}

async function inspectExecutionFixture(page: Page, fixtureUrl: string, label: string) {
  await page.goto('/contexts')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true })
    .getByRole('button', { name: 'Add an MCP server' }).click()
  const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
  await create.getByLabel('Name').fill(label)
  await create.getByLabel('Server URL').fill(fixtureUrl)
  await create.getByRole('button', { name: 'Save server', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
  await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true })
    .getByRole('button', { name: 'Inspect catalog', exact: true }).click()
  await expect(page.getByText('Available with approval', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  const connectionId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('button', { name: 'Close pane', exact: true }).click()
  return connectionId
}

async function attachExternalMcp(page: Page, sessionId: string, label: string) {
  await page.goto(`/s/${sessionId}`)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^MCP server/ }).click()
  const external = picker.getByRole('button', { name: new RegExp(label) })
  await expect(external).toContainText('Approval required for every call')
  await external.click()
  await expect(page.getByTitle('Open in sidebar').filter({ hasText: label })).toBeVisible({ timeout: ms(20_000) })
  // The atomic context acknowledgement can remount the composer/picker host.
  // Close the settled instance when it remains open; the attached chip above,
  // not a transient popover node, is the authority that the mutation landed.
  const settledPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
  if (await settledPicker.isVisible()) await settledPicker.getByRole('button', { name: 'Done', exact: true }).click()
}

async function requestExternalCall(page: Page, query: string) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(`Use the attached external MCP tool with query “${query}”.`)
  await composer.press('Enter')
  const row = page.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'inspect_records' }).last()
  await expect(row.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(row).toContainText(`"query": "${query}"`)
  await expect(row).toContainText('Approval applies only to this call')
  return row
}

async function closeMcpDetailPane(page: Page) {
  const detail = page.locator('[data-mcp-connection]:visible, [data-mcp-catalog]:visible').first()
  if (!await detail.isVisible()) return
  if (await page.locator('[data-overlay-dock]').isVisible()) {
    await page.locator('[data-overlay-dock]').getByTitle('Close', { exact: true }).click()
  } else {
    await detail.click({ position: { x: 8, y: 8 } })
    const strip = page.locator('[data-mini-rail]')
    const chrome = await strip.isVisible() ? strip : page.getByRole('complementary')
    await chrome.getByRole('button', { name: 'Close pane', exact: true }).click()
  }
  await expect(page.locator('[data-mcp-connection]:visible, [data-mcp-catalog]:visible')).toHaveCount(0)
}

async function captureMcpState(page: Page, row: Locator, suffix: string) {
  const card = row.locator('xpath=../..')
  for (const viewport of VIEWPORTS) {
    const focus = viewport.height <= 390 ? row : card
    await page.setViewportSize(viewport)
    await closeMcpDetailPane(page)
    await settleResponsiveView(page)
    await focus.scrollIntoViewIfNeeded()
    if (viewport.height > 390) {
      await focus.evaluate((element) => {
        const box = element.getBoundingClientRect()
        if (box.top >= 88) return
        let scroller = element.parentElement
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
        scroller?.scrollBy({ top: box.top - 88 })
      })
    }
    await expect(focus).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `external MCP ${suffix} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/mcp-execution-review/${viewport.width}x${viewport.height}-${suffix}.png` })
  }
}

async function captureContextsGuidance(page: Page) {
  await page.goto('/contexts')
  const guidance = page.getByText('Inspect a server, attach its admitted tools to a conversation, then approve each call before it runs.', { exact: false })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(guidance).toBeVisible()
    await assertWcag22Aa(page, `external MCP Contexts guidance ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/mcp-execution-review/${viewport.width}x${viewport.height}-contexts.png` })
  }
}

async function proxyReadOnlySession(page: Page, stack: McpRouterStack, sessionId: string) {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/events') return route.abort()
    const { origin: _origin, ...headers } = route.request().headers()
    const response = await route.fetch({ url: `${stack.url}${url.pathname}${url.search}`, headers })
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/sessions' && url.search === '') {
      const rows = await response.json() as Session[]
      await route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify(
        rows.map(session => session.id === sessionId ? { ...session, own: false } : session),
      ) })
      return
    }
    await route.fulfill({ response })
  })
}

test('an attached HTTPS MCP tool requires owner approval and persists its inert result', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const fixture = await startMcpFixture({ label: 'Execution fixture' })
  const stack = await startMcpRouterStack()
  try {
    await proxyMcpApi(page, stack)
    const connectionId = await inspectExecutionFixture(page, fixture.url, 'Execution fixture')
    await captureContextsGuidance(page)
    const created = await page.request.post(`${stack.url}/api/v1/sessions`, { data: {} })
    expect(created.ok()).toBe(true)
    const session = await created.json() as Session
    await attachExternalMcp(page, session.id, 'Execution fixture')
    const contexts = await (await page.request.get(`${stack.url}/api/v1/sessions/${session.id}/contexts`)).json() as Array<{ id: string }>
    expect(contexts.map(context => context.id)).toContain(connectionId)

    const proposed = await requestExternalCall(page, 'approval-e2e')
    await closeMcpDetailPane(page)
    expect(fixture.calls).toEqual(['server/discover', 'tools/list'])
    await captureMcpState(page, proposed, 'owner-approval')

    const reader = await page.context().newPage()
    try {
      await proxyReadOnlySession(reader, stack, session.id)
      await reader.goto(`/s/${session.id}`)
      const readOnly = reader.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'inspect_records' }).last()
      await expect(readOnly).toContainText('Only the conversation owner can approve or decline this call.')
      await expect(readOnly.getByRole('button', { name: 'Run tool', exact: true })).toBeDisabled()
      await expect(readOnly.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled()
      await captureMcpState(reader, readOnly, 'read-only-approval')
    } finally { await reader.close() }

    await proposed.getByRole('button', { name: 'Run tool', exact: true }).click()
    const done = page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'inspect_records' }).last()
    await expect(done).toContainText('Fixture result for approval-e2e.', { timeout: ms(20_000) })
    await expect(done).toContainText('Media omitted · image · image/png')
    await expect(done).toContainText('Resource link omitted · Fixture report')
    await expect(done).toContainText('"matched": 1')
    await expect(done.locator('a[href], img, audio, video, iframe, object, embed')).toHaveCount(0)
    await captureMcpState(page, done, 'result')
    expect(fixture.toolCalls).toEqual([{ name: 'inspect_records', arguments: { query: 'approval-e2e' } }])
    await page.reload()
    await expect(page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'Fixture result for approval-e2e.' })).toBeVisible()

    const declined = await requestExternalCall(page, 'decline-e2e')
    await declined.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(page.locator('[data-mcp-tool-status="declined"]').filter({ hasText: 'inspect_records' }).last())
      .toContainText('the external tool was not run')
    expect(fixture.toolCalls).toHaveLength(1)
  } finally { await fixture.close(); await stack.close() }
})

test('known MCP errors and post-submission uncertainty stay durable without replay', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const fixture = await startMcpFixture({ label: 'Outcome fixture', toolBehavior: 'error' })
  const stack = await startMcpRouterStack()
  try {
    await proxyMcpApi(page, stack)
    await inspectExecutionFixture(page, fixture.url, 'Outcome fixture')
    const created = await page.request.post(`${stack.url}/api/v1/sessions`, { data: {} })
    const session = await created.json() as Session
    await attachExternalMcp(page, session.id, 'Outcome fixture')

    const knownError = await requestExternalCall(page, 'known-error')
    await knownError.getByRole('button', { name: 'Run tool', exact: true }).click()
    const failed = page.locator('[data-mcp-tool-status="failed"]').filter({ hasText: 'inspect_records' }).last()
    await expect(failed).toContainText('Server-reported error', { timeout: ms(20_000) })
    await expect(failed).toContainText('No successful effect is claimed.')
    await captureMcpState(page, failed, 'server-error')
    expect(fixture.toolCalls).toHaveLength(1)

    fixture.setToolBehavior('uncertain')
    const proposed = await requestExternalCall(page, 'uncertain')
    await proposed.getByRole('button', { name: 'Run tool', exact: true }).click()
    const uncertain = page.locator('[data-mcp-tool-status="uncertain"]').filter({ hasText: 'inspect_records' }).last()
    await expect(uncertain).toContainText('may have run, but no result was confirmed', { timeout: ms(30_000) })
    await expect(uncertain).toContainText('won’t be retried automatically')
    await expect(uncertain.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    await captureMcpState(page, uncertain, 'uncertain')
    expect(fixture.toolCalls).toHaveLength(2)
    await page.reload()
    const persisted = page.locator('[data-mcp-tool-status="uncertain"]').filter({ hasText: 'inspect_records' }).last()
    await expect(persisted).toContainText('won’t be retried automatically')
    await expect(persisted.getByRole('button', { name: 'Retry' })).toHaveCount(0)
    expect(fixture.toolCalls).toHaveLength(2)
  } finally { await fixture.close(); await stack.close() }
})

test('long external labels and result descriptors stay contained at 320px', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const longLabel = `Long external connection ${'identity-'.repeat(20)}`
  const longResource = `Resource ${'descriptor-'.repeat(24)}`
  const longMime = `application/vnd.agent-commons.${'schema-'.repeat(20)}+json`
  const fixture = await startMcpFixture({
    label: longLabel,
    resultResourceName: longResource,
    resultMimeType: longMime,
  })
  const stack = await startMcpRouterStack()
  try {
    await proxyMcpApi(page, stack)
    await inspectExecutionFixture(page, fixture.url, longLabel)
    const created = await page.request.post(`${stack.url}/api/v1/sessions`, { data: {} })
    const session = await created.json() as Session
    await attachExternalMcp(page, session.id, longLabel)
    const proposed = await requestExternalCall(page, 'long-content')
    await proposed.getByRole('button', { name: 'Run tool', exact: true }).click()
    const done = page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'inspect_records' }).last()
    await expect(done).toContainText(longResource, { timeout: ms(20_000) })
    await closeMcpDetailPane(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await settleResponsiveView(page)
    await done.scrollIntoViewIfNeeded()
    const geometry = await done.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, 'long external MCP result 320x700')
    await page.screenshot({ path: '.data/mcp-execution-review/320x700-long-result.png' })
  } finally { await fixture.close(); await stack.close() }
})

test('withheld and rejected tool-card chunks stay local and reload recovers truth', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = `deferred-${Date.now().toString(36)}`
  const targetResponse = await page.request.post('/api/v1/sessions', { data: { firstMessage: `Deferred target ${stamp}` } })
  const target = await targetResponse.json() as Session
  const driverResponse = await page.request.post('/api/v1/sessions', { data: { firstMessage: `Deferred driver ${stamp}` } })
  const driver = await driverResponse.json() as Session
  const proposed = await page.request.post(`/api/v1/sessions/${driver.id}/messages`, {
    data: { text: `Please archive session ${target.id}.` },
    headers: { 'Idempotency-Key': `deferred-tool-${stamp}` },
  })
  expect(proposed.ok()).toBe(true)
  await proposed.body()

  let rejectChunk!: () => Promise<void>
  await page.route(/\/src\/components\/ToolActivityCard\.tsx(?:\?.*)?$/, async route => {
    await new Promise<void>((resolve) => {
      rejectChunk = async () => {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'withheld test chunk' })
        resolve()
      }
    })
  })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto(`/s/${driver.id}`)
  const loading = page.locator('[data-tool-activity-loading]')
  await expect(loading).toHaveAccessibleName('')
  await expect(loading).toContainText('Loading tool activity…')
  await settleResponsiveView(page)
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Workspace remains usable while the tool card loads')
  await expect(composer).toHaveValue('Workspace remains usable while the tool card loads')
  await assertWcag22Aa(page, 'deferred tool activity loading 320x700')
  await page.screenshot({ path: '.data/mcp-execution-review/320x700-tool-chunk-loading.png' })

  await rejectChunk()
  const failed = page.locator('[data-tool-activity-load-error]')
  await expect(failed).toContainText('Couldn’t load tool activity. Reload to review its latest status.')
  await expect(failed).not.toContainText(/approved|declined|proposed/i)
  await expect(composer).toHaveValue('Workspace remains usable while the tool card loads')
  await assertWcag22Aa(page, 'deferred tool activity load error 320x700')
  await page.screenshot({ path: '.data/mcp-execution-review/320x700-tool-chunk-error.png' })

  await page.unroute(/\/src\/components\/ToolActivityCard\.tsx(?:\?.*)?$/)
  await failed.getByRole('button', { name: 'Reload to review', exact: true }).click()
  await expect(page.locator('[data-tool-activity-decision]').filter({ hasText: target.id })).toBeVisible({ timeout: ms(20_000) })
  await expect(page.locator('[data-tool-activity-loading]')).toHaveCount(0)
  await expect(page.locator('[data-tool-activity-load-error]')).toHaveCount(0)
})
