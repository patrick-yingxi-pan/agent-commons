/** Rendered private Agent-request lifecycle, including owner-only local consent. */
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { Identity } from '../contract/identity.ts'
import type { Agent } from '../contract/workers.ts'
import { SESSION_COOKIE } from '../server/auth.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import type { McpStdioConnection } from '../server/mcpStdioClient.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { proxyMcpApi, startMcpFixture, startMcpRouterStack, type McpRouterStack } from './mcp-fixture.ts'

const SECRET = `private request tool result ${randomUUID()}`
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

function nativePeer(methods: string[]): McpStdioConnection {
  return {
    request: async (method, params) => {
      methods.push(method)
      if (method === 'tools/call') {
        const args = params?.arguments as { query?: string } | undefined
        return { jsonrpc: '2.0', id: method, result: { resultType: 'complete', isError: false,
          content: [{ type: 'text', text: `Native fixture result for ${args?.query ?? ''}.` }] } }
      }
      return { jsonrpc: '2.0', id: method, result: method === 'server/discover'
        ? { resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
        : { resultType: 'complete', tools: [{ name: 'fixture_search', description: 'Search the isolated local fixture.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }] } }
    },
    initialized: async () => undefined,
    close: async () => ({ code: 'released' }),
    closed: Promise.resolve({ code: 'released' }),
  }
}

type Person = { identity: Identity; cookie: string }
const sourceHeader = (person: Person) => ({ 'x-account-transition-source': `session:${person.identity.user.id}` })

async function expectOption(select: Locator, value: string) {
  await expect.poll(() => select.locator('option').evaluateAll((options, expected) =>
    options.some(option => (option as HTMLOptionElement).value === expected), value)).toBe(true)
}

async function reviewViewports(page: Page, info: TestInfo, state: string, focus?: Locator) {
  // Close the live wide rail before resizing. During a tier transition the
  // clipped old collapse button can still have a box but is not hit-testable.
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapse.evaluateAll(nodes => nodes.some(node => !node.closest('[inert]')))) await collapse.click()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledNarrowRail(page)
    await expect(page.locator('main')).not.toHaveAttribute('inert', '')
    if (focus) {
      await focus.scrollIntoViewIfNeeded()
      await expect(focus).toBeInViewport()
    }
    await settledOpaquePaint(focus ?? page.locator('main'))
    await expect.poll(() => page.evaluate(() => ({ documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      overflowing: [...document.querySelectorAll('main input, main select, main textarea, main pre')].filter(element => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
      }).map(element => element.tagName) })), { message: `${state} settles within ${viewport.width}×${viewport.height}` })
      .toEqual({ documentOverflow: false, overflowing: [] })
    if (viewport.width === 320 || viewport.width === 1280) await assertWcag22Aa(page, `${state} ${viewport.width}`)
    await page.screenshot({ path: info.outputPath(`${state}-${viewport.width}.png`) })
  }
}

async function signedPerson(request: APIRequestContext, stack: McpRouterStack, name: string): Promise<Person> {
  const stamp = randomUUID()
  const response = await request.post(`${stack.url}/api/v1/auth/signup`, {
    data: { name, email: `${stamp}@agent-requests.example.test`, password: `password-${stamp}` },
  })
  const body = await response.text()
  expect(response.status(), body).toBe(200)
  const identity = JSON.parse(body) as Identity
  expect(identity.via).toBe('session')
  const cookie = response.headers()['set-cookie']?.match(new RegExp(`${SESSION_COOKIE}=([^;,]+)`))?.[1]
  expect(cookie, 'signup returns the signed session used to bind Agent provenance').toBeTruthy()
  return { identity, cookie: cookie! }
}

async function api(request: APIRequestContext, stack: McpRouterStack, person: Person,
  method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, key?: string) {
  const response = await request.fetch(`${stack.url}/api/v1${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${person.cookie}`, ...sourceHeader(person), ...(key ? { 'idempotency-key': key } : {}) },
    ...(data === undefined ? {} : { data }),
  })
  const text = await response.text()
  expect(response.status(), `${method} ${path}: ${text}`).toBeLessThan(300)
  return text ? JSON.parse(text) as any : undefined
}

async function bindCookie(context: BrowserContext, person: Person) {
  await context.addCookies([{ name: SESSION_COOKIE, value: person.cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])
}

async function bindings(request: APIRequestContext, stack: McpRouterStack, person: Person) {
  const [providers, prompts] = await Promise.all([
    api(request, stack, person, 'GET', '/providers'), api(request, stack, person, 'GET', '/system-prompts'),
  ])
  const pick = (rows: Array<{ id: string; isDefault?: boolean }>) => rows.find(row => row.isDefault)?.id ?? rows[0]?.id
  const providerId = pick(providers), systemPromptId = pick(prompts)
  expect(providerId).toBeTruthy(); expect(systemPromptId).toBeTruthy()
  return { providerId, systemPromptId }
}

async function createBoundAgent(request: APIRequestContext, stack: McpRouterStack, person: Person, label: string): Promise<Agent> {
  const created = await api(request, stack, person, 'POST', '/agents', { label, ...(await bindings(request, stack, person)) }, randomUUID()) as Agent
  expect(created.id).toBeTruthy()
  return created
}

async function makePage(browser: Browser, origin: string, person: Person, stack: McpRouterStack) {
  const context = await browser.newContext({ baseURL: origin })
  await bindCookie(context, person)
  const page = await context.newPage()
  const dispose = await proxyMcpApi(page, stack)
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText(person.identity.user.name, { timeout: ms(15_000) })
  return { context, page, dispose }
}

test('private Agent requests require separate owner Run and Share choices, retain GET-only recovery, and fit consent at five viewports', async ({ page, browser, request }, info) => {
  test.setTimeout(ms(180_000))
  const nativeMethods: string[] = []
  const stack = await startMcpRouterStack({ localProcessesAvailable: true,
    openStdio: () => nativePeer(nativeMethods), synchronizeStdioBindings: async () => ({ available: true }) })
  const http = await startMcpFixture({ label: 'Agent request local HTTP fixture', toolName: 'write_private_note',
    description: 'Write one exact note only after human review.', toolResult: () => ({ resultType: 'complete', isError: false,
      content: [{ type: 'text', text: SECRET }] }) })
  let ownerPage: Awaited<ReturnType<typeof makePage>> | undefined
  let thirdPage: Awaited<ReturnType<typeof makePage>> | undefined
  let duplicate: Page | undefined
  let disposeRequester: (() => Promise<void>) | undefined, disposeDuplicate: (() => Promise<void>) | undefined
  let releaseCreate!: () => void
  let committedCreate: { id: string; key: string } | undefined
  const heldCreate = new Promise<void>(resolve => { releaseCreate = resolve })
  let createPosts = 0, detailReads = 0
  try {
    const requester = await signedPerson(request, stack, 'Requesting person')
    const owner = await signedPerson(request, stack, 'Receiving person')
    const third = await signedPerson(request, stack, 'Uninvolved person')
    const connectionResult = await api(request, stack, owner, 'POST', '/mcp-connections', {
      creationId: randomUUID(), label: 'Private note fixture', endpoint: http.url, authentication: 'none',
    }) as { connection: { id: string; revision: number } }
    await api(request, stack, owner, 'POST', `/mcp-connections/${connectionResult.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: connectionResult.connection.revision,
    })
    const localCreated = await api(request, stack, owner, 'POST', '/mcp-connections', {
      transport: 'stdio', creationId: randomUUID(), label: 'Private local fixture',
    }) as { connection: { id: string; revision: number } }
    const grantReference = `MCP_STDIO_${randomUUID().replaceAll('-', '').toUpperCase()}`
    await api(request, stack, owner, 'POST', `/mcp-connections/${localCreated.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: localCreated.connection.revision, grantReference,
    })
    const requesterAgent = await createBoundAgent(request, stack, requester, `Request source ${randomUUID().slice(0, 8)}`)
    const ownerAgent = await createBoundAgent(request, stack, owner, `Request target ${randomUUID().slice(0, 8)}`)
    const published = await api(request, stack, owner, 'PATCH', `/agents/${ownerAgent.id}`, {
      published: true,
      authority: { connectors: [connectionResult.connection.id, localCreated.connection.id] },
      expectedRevision: ownerAgent.revision,
    }) as Agent

    disposeRequester = await proxyMcpApi(page, stack)
    await page.goto('/')
    const origin = new URL(page.url()).origin
    // The test fixture page is requester; account cookies are copied from the
    // in-memory router, not impersonated through development identity headers.
    await bindCookie(page.context(), requester)
    await page.reload()
    await expect(page.getByTestId('account-chip')).toContainText(requester.identity.user.name)
    ownerPage = await makePage(browser, origin, owner, stack)
    thirdPage = await makePage(browser, origin, third, stack)

    const empty = await api(request, stack, third, 'GET', '/agent-request-options')
    expect(empty.sourceAgents).toEqual([], 'a newly signed-in person has no implicit or shared Agent source')
    await thirdPage.page.goto('/agents/requests')
    await expect(thirdPage.page.getByText(/Create or fork an Agent while signed in to bind it to you/)).toBeVisible()
    await page.goto('/agents/requests')
    await expect(page.getByRole('heading', { name: 'Requests', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Your Agent', exact: true })).toHaveValue('')
    await expect(page.getByRole('combobox', { name: 'Receiving Agent', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Requested outcome', exact: true })).toBeVisible()
    await expectOption(page.getByLabel('Your Agent'), requesterAgent.id)
    await expectOption(page.getByLabel('Receiving Agent'), published.id)
    await page.getByLabel('Your Agent').selectOption(requesterAgent.id)
    await page.getByLabel('Receiving Agent').selectOption(published.id)
    const task = `Please prepare one reviewed note (${randomUUID().slice(0, 8)}).`
    await page.getByLabel('Requested outcome').fill(task)
    await reviewViewports(page, info, 'request-entry')

    // Commit the request, then hold the browser acknowledgement while the user
    // navigates. The second pane recovers solely by GET; no mutation is replayed.
    await page.route('**/api/v1/agent-requests', async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      createPosts++
      if (createPosts > 1) return route.fallback()
      const key = route.request().headers()['idempotency-key'] ?? ''
      const browserRequest = route.request()
      const url = new URL(browserRequest.url())
      const committed = await request.fetch(`${stack.url}${url.pathname}`, {
        method: 'POST', data: browserRequest.postDataJSON(),
        headers: { cookie: `${SESSION_COOKIE}=${requester.cookie}`, ...sourceHeader(requester), 'idempotency-key': key },
      })
      const row = await committed.json() as { id: string }
      expect(committed.status()).toBe(200)
      committedCreate = { id: row.id, key }
      await heldCreate
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'The saved request acknowledgement was lost.' } }) })
    })
    await page.route('**/api/v1/agent-requests/*', async route => {
      if (route.request().method() === 'GET') detailReads++
      await route.fallback()
    })
    await page.getByRole('button', { name: 'Send request', exact: true }).click()
    await expect.poll(() => committedCreate?.id).toMatch(/^agent-request-[a-f0-9]{32}$/)
    const committed = committedCreate!
    expect(committed.key).not.toBe('')
    expect(committed.id).toMatch(/^agent-request-[a-f0-9]{32}$/)
    const foreign = await request.get(`${stack.url}/api/v1/agent-requests/${encodeURIComponent(committed.id)}`, {
      headers: { cookie: `${SESSION_COOKIE}=${third.cookie}`, ...sourceHeader(third) },
    })
    expect(foreign.status(), 'an uninvolved account cannot open this exact private history').toBe(404)
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
    await page.getByRole('navigation').getByRole('button', { name: 'Requests', exact: true }).click()

    duplicate = await page.context().newPage()
    disposeDuplicate = await proxyMcpApi(duplicate, stack)
    await duplicate.route('**/api/v1/agent-requests/*', async route => {
      if (route.request().method() === 'GET') detailReads++
      await route.fallback()
    })
    await duplicate.goto('/agents/requests')
    const duplicateRecovery = duplicate.getByRole('button', { name: 'Check saved status', exact: true })
    await expect(duplicateRecovery).toBeVisible()
    await duplicateRecovery.click()
    await expect(duplicate.getByRole('main').getByText(task, { exact: true })).toBeVisible({ timeout: ms(15_000) })
    const recoveredRows = await api(request, stack, requester, 'GET', '/agent-requests') as Array<{ id: string }>
    expect(recoveredRows.filter(row => row.id === committed.id)).toHaveLength(1)
    await duplicate.goto(`/agents/requests/${encodeURIComponent(committed.id)}`)
    await expect(duplicate.getByRole('heading', { name: 'Agent request', exact: true })).toBeVisible()
    releaseCreate()
    await expect.poll(() => createPosts).toBe(1)
    await expect.poll(() => detailReads).toBeGreaterThan(0)

    await ownerPage.page.goto(`/agents/requests/${encodeURIComponent(committed.id)}`)
    await expect(ownerPage.page.getByRole('heading', { name: 'Choose one call', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await reviewViewports(ownerPage.page, info, 'owner-tool-choice')
    const toolSelect = ownerPage.page.getByRole('combobox', { name: 'Inspected tool', exact: true })
    await expect(ownerPage.page.getByRole('textbox', { name: 'Arguments (JSON)', exact: true })).toHaveValue('{}')
    await toolSelect.selectOption({ label: 'Private local fixture · fixture_search · Local program' })
    await ownerPage.page.getByLabel('Arguments (JSON)').fill('{"query":"local-consent-check"}')
    await ownerPage.page.getByRole('button', { name: 'Review call', exact: true }).click()
    const acknowledgement = ownerPage.page.getByRole('checkbox', { name: /I understand this local program has normal OS access/ })
    const runOnce = ownerPage.page.getByRole('button', { name: 'Run once', exact: true })
    await expect(acknowledgement).toHaveAttribute('aria-checked', 'false')
    await expect(runOnce).toBeDisabled()
    for (const viewport of VIEWPORTS) {
      await ownerPage.page.setViewportSize(viewport)
      await settledNarrowRail(ownerPage.page)
      await runOnce.scrollIntoViewIfNeeded()
      await expect(acknowledgement).toBeInViewport()
      await expect(runOnce).toBeInViewport()
      await settledOpaquePaint(acknowledgement)
      await expect(runOnce).toBeDisabled()
      const width = await ownerPage.page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }))
      expect(width.scroll, `no horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(width.inner + 1)
      if (viewport.width === 320 || viewport.width === 1280) await assertWcag22Aa(ownerPage.page, `owner-local-consent ${viewport.width}`)
      await ownerPage.page.screenshot({ path: info.outputPath(`owner-local-consent-${viewport.width}.png`) })
    }
    await acknowledgement.click()
    await expect(runOnce).toBeEnabled()
    await expect(ownerPage.page.getByText(/This call may change an external system/)).toBeVisible()
    await ownerPage.page.getByRole('button', { name: 'Back to arguments', exact: true }).click()
    await toolSelect.selectOption({ label: 'Private note fixture · write_private_note · HTTP service' })
    await ownerPage.page.getByLabel('Arguments (JSON)').fill(JSON.stringify({ query: 'reviewed note value' }))
    await ownerPage.page.getByRole('button', { name: 'Review call', exact: true }).click()
    await ownerPage.page.getByRole('button', { name: 'Run once', exact: true }).click()
    const receipt = ownerPage.page.getByRole('region', { name: 'Private execution receipt', exact: true })
    await expect(ownerPage.page.getByRole('heading', { name: 'Write a reply to share', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await receipt.getByText('Exact call and raw result · visible only to you', { exact: true }).click()
    await expect(receipt).toContainText(SECRET)
    await reviewViewports(ownerPage.page, info, 'owner-receipt')
    await receipt.getByText('Exact call and raw result · visible only to you', { exact: true }).click()

    await page.goto(`/agents/requests/${encodeURIComponent(committed.id)}`)
    await expect(page.getByRole('heading', { name: 'Agent request', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(SECRET)
    await expect(page.getByRole('heading', { name: 'Shared reply', exact: true })).toHaveCount(0)
    await reviewViewports(page, info, 'requester-private-result-wall')

    const reply = `Reviewed and approved summary ${randomUUID().slice(0, 8)}.`
    await ownerPage.page.getByRole('textbox', { name: 'Reply', exact: true }).fill(reply)
    await reviewViewports(ownerPage.page, info, 'owner-reply-draft', ownerPage.page.getByRole('button', { name: 'Review reply', exact: true }))
    await ownerPage.page.getByRole('button', { name: 'Review reply', exact: true }).click()
    await reviewViewports(ownerPage.page, info, 'owner-share-review', ownerPage.page.getByRole('button', { name: 'Share reply', exact: true }))
    await ownerPage.page.getByRole('button', { name: 'Share reply', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('region', { name: 'Shared reply', exact: true })).toContainText(reply)
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(SECRET)

    await reviewViewports(page, info, 'requester-shared-reply')

    // A second, not-yet-run request can be cancelled by either participant;
    // it never offers an execution receipt or shares the original call.
    await page.goto('/agents/requests')
    await expectOption(page.getByLabel('Your Agent'), requesterAgent.id)
    await expectOption(page.getByLabel('Receiving Agent'), published.id)
    await page.getByLabel('Your Agent').selectOption(requesterAgent.id)
    await page.getByLabel('Receiving Agent').selectOption(published.id)
    const cancelTask = `Cancel before any run (${randomUUID().slice(0, 8)}).`
    await page.getByLabel('Requested outcome').fill(cancelTask)
    const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/agent-requests'))
    await page.getByRole('button', { name: 'Send request', exact: true }).click()
    expect((await createdResponse).status()).toBe(200)
    const second = await api(request, stack, requester, 'GET', '/agent-requests') as Array<{ id: string; task: string }>
    const cancelledId = second.find(row => row.task === cancelTask)?.id
    expect(cancelledId).toBeTruthy()
    await ownerPage.page.goto(`/agents/requests/${encodeURIComponent(cancelledId!)}`)
    await ownerPage.page.getByRole('button', { name: 'Cancel request', exact: true }).click()
    await ownerPage.page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
    await expect(ownerPage.page.getByText(/Cancelled/)).toBeVisible()
    await page.goto(`/agents/requests/${encodeURIComponent(cancelledId!)}`)
    await expect(page.getByText(/Cancelled/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toHaveCount(0)

    // The local-program gate is exercised end-to-end against an in-memory
    // native adapter: the request is not dispatched until its actual checkbox
    // enables and the owner activates Run once.
    await page.goto('/agents/requests')
    await page.getByLabel('Your Agent').selectOption(requesterAgent.id)
    await page.getByLabel('Receiving Agent').selectOption(published.id)
    const localTask = `Local fixture request ${randomUUID().slice(0, 8)}.`
    await page.getByLabel('Requested outcome').fill(localTask)
    const localCreatedResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/agent-requests'))
    await page.getByRole('button', { name: 'Send request', exact: true }).click()
    expect((await localCreatedResponse).status()).toBe(200)
    const afterLocalCreate = await api(request, stack, requester, 'GET', '/agent-requests') as Array<{ id: string; task: string }>
    const localId = afterLocalCreate.find(row => row.task === localTask)?.id
    expect(localId).toBeTruthy()
    await ownerPage.page.goto(`/agents/requests/${encodeURIComponent(localId!)}`)
    await expect(ownerPage.page.getByRole('heading', { name: 'Choose one call', exact: true })).toBeVisible()
    await ownerPage.page.getByLabel('Inspected tool').selectOption({ label: 'Private local fixture · fixture_search · Local program' })
    await ownerPage.page.getByLabel('Arguments (JSON)').fill('{"query":"authorized local run"}')
    await ownerPage.page.getByRole('button', { name: 'Review call', exact: true }).click()
    const localAcknowledgement = ownerPage.page.getByRole('checkbox', { name: /I understand this local program has normal OS access/ })
    const localRun = ownerPage.page.getByRole('button', { name: 'Run once', exact: true })
    await expect(localAcknowledgement).toHaveAttribute('aria-checked', 'false')
    await expect(localRun).toBeDisabled()
    expect(nativeMethods.filter(method => method === 'tools/call')).toEqual([])
    await localAcknowledgement.click()
    await expect(localRun).toBeEnabled()
    await localRun.click()
    await expect.poll(() => nativeMethods.filter(method => method === 'tools/call').length, { timeout: ms(20_000) }).toBe(1)
    await expect(ownerPage.page.getByRole('region', { name: 'Private execution receipt', exact: true })).toContainText('Native fixture result for authorized local run.', { timeout: ms(20_000) })
  } finally {
    releaseCreate()
    await disposeDuplicate?.().catch(() => undefined)
    await duplicate?.close().catch(() => undefined)
    await ownerPage?.dispose().catch(() => undefined)
    await ownerPage?.context.close().catch(() => undefined)
    await thirdPage?.dispose().catch(() => undefined)
    await thirdPage?.context.close().catch(() => undefined)
    await disposeRequester?.().catch(() => undefined)
    await http.close().catch(() => undefined)
    await stack.close().catch(() => undefined)
  }
})
