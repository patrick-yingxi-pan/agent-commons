/** Rendered exact-call consent and Project-visible receipts against a local peer. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi, type McpRouterStack } from './mcp-fixture.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function post(page: Page, stack: McpRouterStack, path: string, data: unknown) {
  const response = await page.request.post(`${stack.url}/api/v1${path}`, {
    data, headers: { 'Idempotency-Key': randomUUID() },
  })
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true)
  return response.json()
}

async function setup(page: Page, stack: McpRouterStack, endpoint: string) {
  const label = `Reviewed MCP ${'longconnectionlabel'.repeat(5)}`
  const { connection } = await post(page, stack, '/mcp-connections', {
    creationId: randomUUID(), label, endpoint, authentication: 'none',
  })
  await post(page, stack, `/mcp-connections/${connection.id}/inspect`, { operationId: randomUUID(), expectedRevision: 0 })
  const { project } = await post(page, stack, '/projects', {
    name: `Exact MCP consent ${randomUUID().slice(0, 8)}`, description: 'Review one exact tool call before sending it.',
  })
  await post(page, stack, '/grants', {
    subject: { kind: 'project', id: project.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
  })
  const contribution = await post(page, stack, `/projects/${project.id}/contributions`, {
    title: 'Publish the reviewed record', summary: 'Arguments and saved results belong to the Project.',
  })
  const route = `/projects/${project.id}/changes/${contribution.id}`
  const path = `/projects/${project.id}/contributions/${contribution.id}`
  return { label, connection, project, contribution, route, path }
}

async function capture(page: Page, subject: Locator, label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await subject.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expectEnvelopeFieldsContained(page)
    await assertWcag22Aa(page, `${label} ${viewport.width}`)
    await page.screenshot({ path: test.info().outputPath(`${label}-${viewport.width}.png`) })
  }
}

async function expectEnvelopeFieldsContained(page: Page) {
  for (const fields of await page.locator('[data-contribution-envelope-fields]').all()) {
    expect(await fields.locator('input, select, button').count()).toBeGreaterThan(0)
    expect(await fields.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return element.scrollWidth <= element.clientWidth &&
        [...element.querySelectorAll('input, select, button')].every((control) => {
          const rect = control.getBoundingClientRect()
          return rect.left >= box.left - 1 && rect.right <= box.right + 1
        })
    }), 'every effect field fits its actual pane, not just the browser viewport').toBe(true)
  }
}

test('explicit proposal and separate Run expose exact inert history to owner and readers at every tier', async ({ page, browser }) => {
  test.setTimeout(ms(150_000))
  const stack = await startMcpRouterStack()
  const fixture = await startMcpFixture()
  const cleanup = await proxyMcpApi(page, stack)
  const readerContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' } })
  const foreignContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' } })
  const reader = await readerContext.newPage()
  const foreign = await foreignContext.newPage()
  const readerCleanup = await proxyMcpApi(reader, stack)
  const foreignCleanup = await proxyMcpApi(foreign, stack)
  try {
    const arena = await setup(page, stack, fixture.url)
    await page.goto(arena.route)
    await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
    // This intermediate width keeps a real rail alongside a narrow main pane.
    // A viewport-only sm: grid used to overflow despite a contained document.
    await page.setViewportSize({ width: 668, height: 988 })
    await settleArtifactPageRail(page)
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await expect.poll(() => page.getByRole('main').evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(500)
    await expect(page.locator('[data-contribution-envelope-fields]')).toHaveCount(1)
    await expectEnvelopeFieldsContained(page)
    await page.screenshot({ path: test.info().outputPath('proposal-narrow-pane-668.png') })
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
    await expect(page.getByLabel('Effect target 1', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Safety harness 1', { exact: true })).toHaveCount(0)
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('connector.write')
    const legacyHarness = page.getByLabel('Safety harness 1', { exact: true })
    await expect(legacyHarness).toHaveValue('draft-escrow')
    await expect(legacyHarness.locator('option[value="explicit-call"]')).toHaveCount(0)
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
    await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: `${arena.label} · inspect_records` })
    const query = `Approved record ${'unbrokenargument'.repeat(10)}`
    await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify({ query }))
    await page.getByLabel('Max acts 1', { exact: true }).fill('3')
    await expect(page.getByRole('main')).toContainText('visible to every Project reader')
    await capture(page, page.getByLabel('MCP arguments 1', { exact: true }), 'proposal')
    expect(fixture.toolCalls).toHaveLength(0)
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    await expect(page.getByRole('main')).toContainText('Effect envelope · v1')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    const review = page.getByRole('button', { name: 'Review & run', exact: true })
    await expect(review).toBeVisible()
    expect(fixture.toolCalls).toHaveLength(0)
    await review.click()
    const consent = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(consent).toContainText('credentials stay private')
    await expect(consent).toContainText('running again may duplicate')
    await capture(page, consent, 'confirmation')
    expect(fixture.toolCalls).toHaveLength(0)
    await consent.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    const done = page.locator('[data-contribution-effect-status="done"]').first()
    await expect(done).toContainText(`Fixture result for ${query}.`)
    expect(fixture.toolCalls).toEqual([{ name: 'inspect_records', arguments: { query } }])
    await capture(page, done, 'owner-result')
    expect(await done.locator('img, audio, video, iframe, a[href]').count()).toBe(0)
    await page.reload()
    await expect(done).toContainText(query)
    expect(fixture.toolCalls).toHaveLength(1)

    await reader.goto(arena.route)
    const shared = reader.locator('[data-contribution-effect-status="done"]').first()
    await expect(shared).toContainText(`Fixture result for ${query}.`)
    await expect(reader.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    await capture(reader, shared, 'reader-result')

    await foreign.goto(arena.route)
    await expect(foreign.locator('[data-contribution-effect-status]')).toHaveCount(0)
    await expect(foreign.getByRole('main')).not.toContainText(query)
    await capture(foreign, foreign.getByRole('main'), 'foreign-unavailable')
    expect(fixture.toolCalls).toHaveLength(1)
  } finally {
    await cleanup(); await readerCleanup(); await foreignCleanup()
    await readerContext.close(); await foreignContext.close()
    await fixture.close(); await stack.close()
  }
})

test('lost Run acknowledgement offers only receipt reads and uncertain history survives a new explicit call', async ({ page }) => {
  test.setTimeout(ms(100_000))
  const stack = await startMcpRouterStack()
  const fixture = await startMcpFixture({ toolBehavior: 'uncertain' })
  const cleanup = await proxyMcpApi(page, stack)
  try {
    const arena = await setup(page, stack, fixture.url)
    const proposed = await post(page, stack, `${arena.path}/envelope`, { expectedVersion: 0, lines: [{
      type: 'mcp.mutate', target: 'inspect_records', harness: 'explicit-call', cardinality: 2,
      mcp: { connectionId: arena.connection.id, connectionRevision: 1, toolName: 'inspect_records', arguments: { query: 'receipt-only recovery' } },
    }] })
    await post(page, stack, `${arena.path}/envelope/approve`, { expectedVersion: proposed.envelope.version })
    let submissions = 0
    let hideReceipt = true
    await page.route(`**/api/v1${arena.path}/effects`, async (route) => {
      submissions += 1
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}/api/v1${arena.path}/effects`, headers })
      expect(response.ok()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }) })
    })
    await page.route(`**/api/v1/projects/${arena.project.id}/contributions`, async (route) => {
      if (submissions > 0 && hideReceipt) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Receipt read unavailable.' } }) })
      } else await route.fallback()
    })
    await page.goto(arena.route)
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    const held = page.locator('[data-contribution-mcp-attempt="uncertain"]')
    await expect(held.getByRole('button', { name: 'Check saved receipt', exact: true })).toBeVisible()
    expect(submissions).toBe(1)
    expect(fixture.toolCalls).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Amend', exact: true })).toBeDisabled()
    await capture(page, held, 'unresolved-acknowledgement')
    await held.getByRole('button', { name: 'Check saved receipt', exact: true }).click()
    await expect(held).toBeVisible()
    expect(submissions).toBe(1)
    hideReceipt = false
    await held.getByRole('button', { name: 'Check saved receipt', exact: true }).click()
    const uncertain = page.locator('[data-contribution-effect-status="uncertain"]').first()
    await expect(uncertain).toBeVisible()
    await capture(page, uncertain, 'uncertain-receipt')
    expect(submissions).toBe(1)
    expect(fixture.toolCalls).toHaveLength(1)
    await page.unroute(`**/api/v1${arena.path}/effects`)
    await page.reload()
    await expect(uncertain).toBeVisible()
    fixture.setToolBehavior('success')
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    await expect(page.locator('[data-contribution-effect-status="done"]')).toHaveCount(1)
    await expect(page.locator('[data-contribution-effect-status="uncertain"]')).toHaveCount(1)
    expect(fixture.toolCalls).toHaveLength(2)
  } finally {
    await cleanup(); await fixture.close(); await stack.close()
  }
})

test('effect controls wait for their command module and a failed load requires explicit reload', async ({ page }) => {
  test.setTimeout(ms(100_000))
  const stack = await startMcpRouterStack()
  const fixture = await startMcpFixture()
  const cleanup = await proxyMcpApi(page, stack)
  const commands = /\/src\/api\/contributionMcpEffectCommands\.ts(?:\?|$)/
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let requested = 0
  let submissions = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/effects')) submissions += 1
  })
  await page.route(commands, async (route) => {
    requested += 1
    await held
    await route.abort()
  })
  try {
    const arena = await setup(page, stack, fixture.url)
    await page.goto(arena.route)
    const loading = page.locator('[data-contribution-envelope-load="loading"]')
    await expect(loading.getByRole('status')).toContainText('Loading effect envelope')
    await expect.poll(() => requested).toBe(1)
    await expect(page.getByRole('button', { name: 'Declare effects', exact: true })).toHaveCount(0)
    await capture(page, loading, 'envelope-loading')
    release()
    const failed = page.locator('[data-contribution-envelope-load="error"]')
    await expect(failed.getByRole('alert')).toContainText('Unsaved')
    await expect(failed.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Declare effects', exact: true })).toHaveCount(0)
    await capture(page, failed, 'envelope-load-error')
    expect(submissions).toBe(0)
    expect(fixture.toolCalls).toHaveLength(0)
    await page.unroute(commands)
    await failed.getByRole('button', { name: 'Reload app', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Declare effects', exact: true })).toBeVisible()
    expect(submissions).toBe(0)
    expect(fixture.toolCalls).toHaveLength(0)
  } finally {
    release()
    await page.unroute(commands)
    await cleanup(); await fixture.close(); await stack.close()
  }
})

test('dismissing a lost acknowledgement cannot hide duplicate risk from the next explicit confirmation', async ({ page }) => {
  const stack = await startMcpRouterStack()
  const fixture = await startMcpFixture()
  const cleanup = await proxyMcpApi(page, stack)
  try {
    const arena = await setup(page, stack, fixture.url)
    const proposed = await post(page, stack, `${arena.path}/envelope`, { expectedVersion: 0, lines: [{
      type: 'mcp.mutate', target: 'inspect_records', harness: 'explicit-call', cardinality: 2,
      mcp: { connectionId: arena.connection.id, connectionRevision: 1, toolName: 'inspect_records', arguments: { query: 'completed but unreadable' } },
    }] })
    await post(page, stack, `${arena.path}/envelope/approve`, { expectedVersion: proposed.envelope.version })
    let submissions = 0
    await page.route(`**/api/v1${arena.path}/effects`, async (route) => {
      submissions += 1
      const { origin: _origin, ...headers } = route.request().headers()
      const response = await route.fetch({ url: `${stack.url}/api/v1${arena.path}/effects`, headers })
      expect(response.ok()).toBe(true)
      await route.fulfill({ status: 503, json: { error: { code: 'internal', message: 'Acknowledgement lost.' } } })
    })
    await page.route(`**/api/v1/projects/${arena.project.id}/contributions`, async (route) => {
      if (submissions > 0) await route.fulfill({ status: 503, json: { error: { code: 'internal', message: 'Receipt unavailable.' } } })
      else await route.fallback()
    })
    await page.goto(arena.route)
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    const held = page.locator('[data-contribution-mcp-attempt="uncertain"]')
    await expect(held).toBeVisible()
    await expect(page.locator('[data-contribution-effect-status]')).toHaveCount(0)
    await held.getByRole('button', { name: 'Dismiss and review before a new run', exact: true }).click()
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const consent = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(consent).toContainText('running again may duplicate its effects')
    await consent.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(submissions).toBe(1)
    expect(fixture.toolCalls).toHaveLength(1)
  } finally {
    await cleanup(); await fixture.close(); await stack.close()
  }
})
