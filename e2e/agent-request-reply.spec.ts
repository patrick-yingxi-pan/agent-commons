/** Owner-started reply drafting stays optional, private advice until explicit adoption. */
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import type { Identity } from '../contract/identity.ts'
import type { Agent, ModelProvider, SystemPromptEntry } from '../contract/index.ts'
import { SESSION_COOKIE } from '../server/auth.ts'
import { store } from '../server/store/index.ts'
import { proxyMcpApi, startMcpFixture, startMcpRouterStack, type McpFixture, type McpRouterStack } from './mcp-fixture.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const MODEL_ID = `agent-reply-${randomUUID()}`
const PRIVATE_MARKER = `private tool-result marker ${randomUUID()}`
const DRAFT_TEXT = `Suggested private reply ${randomUUID()}`
type Person = { identity: Identity; cookie: string }
type ModelPeer = {
  baseURL: string
  calls: Array<Record<string, unknown>>
  setMode(mode: 'hold' | 'success'): void
  release(): void
  close(): Promise<void>
}

async function modelPeer(): Promise<ModelPeer> {
  let mode: 'hold' | 'success' = 'success'
  let release!: () => void
  let gate = Promise.resolve()
  const calls: Array<Record<string, unknown>> = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    if (Array.isArray(body.tools)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'reply-draft-probe', type: 'message', role: 'assistant', model: MODEL_ID,
        stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    calls.push(body)
    if (mode === 'hold') await gate
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: `reply-${calls.length}`, type: 'message', role: 'assistant', model: MODEL_ID,
      stop_reason: 'end_turn', content: [{ type: 'text', text: DRAFT_TEXT }], usage: { input_tokens: 83, output_tokens: 17 } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent reply-draft model fixture did not bind')
  return {
    baseURL: `http://127.0.0.1:${address.port}`, calls,
    setMode(next) { mode = next; if (next === 'hold') gate = new Promise<void>(resolve => { release = resolve }) },
    release() { release?.() },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}

const sourceHeader = (person: Person) => ({ 'x-account-transition-source': `session:${person.identity.user.id}` })

async function signedPerson(request: APIRequestContext, stack: McpRouterStack, name: string): Promise<Person> {
  const stamp = randomUUID()
  const response = await request.post(`${stack.url}/api/v1/auth/signup`, {
    data: { name, email: `${stamp}@agent-request-reply.test`, password: `password-${stamp}` },
  })
  const body = await response.text()
  expect(response.status(), body).toBe(200)
  const identity = JSON.parse(body) as Identity
  const cookie = response.headers()['set-cookie']?.match(new RegExp(`${SESSION_COOKIE}=([^;,]+)`))?.[1]
  expect(cookie).toBeTruthy()
  return { identity, cookie: cookie! }
}

async function api(request: APIRequestContext, stack: McpRouterStack, person: Person,
  method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown, key?: string) {
  const response = await request.fetch(`${stack.url}/api/v1${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${person.cookie}`, ...sourceHeader(person), ...(key ? { 'idempotency-key': key } : {}) },
    ...(data === undefined ? {} : { data }),
  })
  const body = await response.text()
  expect(response.status(), `${method} ${path}: ${body}`).toBeLessThan(300)
  return body ? JSON.parse(body) as any : undefined
}

async function createAgent(request: APIRequestContext, stack: McpRouterStack, person: Person,
  label: string, providerId?: string): Promise<Agent> {
  const [prompts, providers] = await Promise.all([
    api(request, stack, person, 'GET', '/system-prompts'), api(request, stack, person, 'GET', '/providers'),
  ]) as [SystemPromptEntry[], ModelProvider[]]
  const prompt = prompts[0]
  const provider = providerId ?? providers[0]?.id
  expect(prompt).toBeTruthy(); expect(provider).toBeTruthy()
  return api(request, stack, person, 'POST', '/agents', { label, providerId: provider, systemPromptId: prompt!.id, tools: [],
    instructions: 'Use the task and owner notes only. Keep the reply concise.' }, randomUUID()) as Promise<Agent>
}

async function bind(context: BrowserContext, person: Person) {
  await context.addCookies([{ name: SESSION_COOKIE, value: person.cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }])
}

async function openAs(browser: Browser, origin: string, stack: McpRouterStack, person: Person) {
  const context = await browser.newContext({ baseURL: origin })
  await bind(context, person)
  const page = await context.newPage()
  const dispose = await proxyMcpApi(page, stack)
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText(person.identity.user.name, { timeout: ms(15_000) })
  return { context, page, dispose }
}

async function captureViewports(page: Page, info: TestInfo, name: string, focus: ReturnType<Page['getByRole']>) {
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapse.evaluateAll(nodes => nodes.some(node => !node.closest('[inert]')))) await collapse.click()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledNarrowRail(page)
    await expect(page.locator('main')).not.toHaveAttribute('inert', '')
    await focus.scrollIntoViewIfNeeded()
    await expect(focus).toBeInViewport()
    await settledOpaquePaint(focus)
    await expect.poll(() => page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
      controls: [...document.querySelectorAll('main input, main select, main textarea, main pre')].some(node => {
        const box = node.getBoundingClientRect()
        return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
      }) })), { message: `${name} fits ${viewport.width}×${viewport.height}` }).toEqual({ overflow: false, controls: false })
    await assertWcag22Aa(page, `${name} ${viewport.width}`)
    await page.screenshot({ path: info.outputPath(`${name}-${viewport.width}.png`) })
  }
}

test('owner reply drafting is private, optional and explicitly adopted before sharing', async ({ browser, request }, info) => {
  test.setTimeout(ms(240_000))
  const stack = await startMcpRouterStack()
  const model = await modelPeer()
  const peer: McpFixture = await startMcpFixture({ label: 'Private reply-draft tool fixture', toolName: 'read_private_note',
    description: 'Read one private note for owner review.', toolResult: () => ({ resultType: 'complete', isError: false,
      content: [{ type: 'text', text: PRIVATE_MARKER }] }) })
  const keyName = `PROVIDER_AGENT_REPLY_DRAFT_${randomUUID().replaceAll('-', '').toUpperCase()}`
  const oldKey = process.env[keyName]
  process.env[keyName] = `local-fixture-key-${randomUUID()}`
  let ownerPage: Awaited<ReturnType<typeof openAs>> | undefined
  let requesterPage: Awaited<ReturnType<typeof openAs>> | undefined
  let foreignPage: Awaited<ReturnType<typeof openAs>> | undefined
  try {
    const requester = await signedPerson(request, stack, 'Reply requester')
    const owner = await signedPerson(request, stack, 'Reply owner')
    const foreign = await signedPerson(request, stack, 'Reply unrelated person')
    const connectionResult = await api(request, stack, owner, 'POST', '/mcp-connections', {
      creationId: randomUUID(), label: 'Private reply-draft tool fixture', endpoint: peer.url, authentication: 'none',
    }) as { connection: { id: string; revision: number } }
    await api(request, stack, owner, 'POST', `/mcp-connections/${connectionResult.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: connectionResult.connection.revision,
    })
    const provider = store.createProvider({ label: `Local reply fixture ${randomUUID().slice(0, 8)}`, modelFamily: 'claude',
      effortLevels: ['Low'], models: [{ id: MODEL_ID, label: 'Local reply fixture' }] },
      { baseURL: model.baseURL, apiKeyEnv: keyName, model: MODEL_ID, capabilities: { toolUse: true } }, owner.identity.tenant.id)
    const from = await createAgent(request, stack, requester, `Reply source ${randomUUID().slice(0, 8)}`)
    const target = await createAgent(request, stack, owner, `Reply target ${randomUUID().slice(0, 8)}`, provider.id)
    const published = await api(request, stack, owner, 'PATCH', `/agents/${target.id}`, {
      published: true, authority: { connectors: [connectionResult.connection.id] }, expectedRevision: target.revision,
    }) as Agent
    const task = `Summarize the status of an isolated task. ${randomUUID()}`
    const requestRow = await api(request, stack, requester, 'POST', '/agent-requests', {
      fromAgentId: from.id, toAgentId: published.id, task,
    }, randomUUID()) as { id: string; status: string }
    expect(requestRow.status).toBe('waiting')

    const origin = 'http://127.0.0.1:5173'
    ownerPage = await openAs(browser, origin, stack, owner)
    requesterPage = await openAs(browser, origin, stack, requester)
    foreignPage = await openAs(browser, origin, stack, foreign)
    const page = ownerPage.page
    let toolReviewReads = 0
    await page.route(`**/api/v1/agent-requests/${encodeURIComponent(requestRow.id)}/review`, async route => {
      if (route.request().method() === 'GET') toolReviewReads++
      await route.fallback()
    })
    await page.goto(`/agents/requests/${encodeURIComponent(requestRow.id)}`)
    await expect(page.getByRole('region', { name: 'Share reviewed reply', exact: true })).toBeVisible()
    await expect(page.getByLabel('Reply', { exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Review reply', exact: true })).toBeDisabled()

    // The model capability is not even read until the owner opens its explicit
    // optional branch; ordinary manual reply remains the default.
    let reviewReads = 0
    await page.route(`**/api/v1/agent-requests/${encodeURIComponent(requestRow.id)}/reply-review`, async route => {
      if (route.request().method() === 'GET') reviewReads++
      await route.fallback()
    })
    await expect(page.getByRole('button', { name: 'Draft a reply…', exact: true })).toBeVisible()
    expect(reviewReads).toBe(0)
    await captureViewports(page, info, 'reply-draft-collapsed', page.getByRole('button', { name: 'Draft a reply…', exact: true }))

    await page.getByRole('button', { name: 'Draft a reply…', exact: true }).click()
    const draftRegion = page.getByRole('region', { name: 'Optional reply draft', exact: true })
    await expect(draftRegion).toBeVisible()
    await expect(draftRegion).toContainText('Provider')
    await expect(draftRegion).toContainText(MODEL_ID)
    await expect(draftRegion).toContainText('only the request, Agent instructions and your notes')
    await expect(draftRegion).toContainText('One attempt per request')
    await expect.poll(() => reviewReads).toBeGreaterThan(0)
    await captureViewports(page, info, 'reply-draft-disclosure', page.getByRole('button', { name: 'Draft reply', exact: true }))
    const notes = `Mention that this is only a suggested reply. ${randomUUID()}`
    await page.getByLabel('Notes for a reply draft', { exact: true }).fill(notes)
    await page.getByLabel('Reply', { exact: true }).fill('Manual reply preserved while a suggestion is pending.')
    await expect(page.getByRole('button', { name: 'Review reply', exact: true })).toBeEnabled()
    model.setMode('hold')
    const beforeDraft = model.calls.length
    let draftPosts = 0, recoveryReads = 0
    await page.route(`**/api/v1/agent-requests/${encodeURIComponent(requestRow.id)}`, async route => {
      if (route.request().method() === 'GET') recoveryReads++
      await route.fallback()
    })
    await page.route(`**/api/v1/agent-requests/${encodeURIComponent(requestRow.id)}/decision`, async route => {
      const wireRequest = route.request()
      if (wireRequest.method() !== 'POST') return route.fallback()
      const body = wireRequest.postDataJSON() as { action?: string }
      if (body.action !== 'draft-reply') return route.fallback()
      draftPosts++
      const url = new URL(wireRequest.url())
      const committed = await request.fetch(`${stack.url}${url.pathname}`, { method: 'POST', data: body,
        headers: { cookie: `${SESSION_COOKIE}=${owner.cookie}`, ...sourceHeader(owner) } })
      const responseBody = await committed.text()
      expect(committed.status(), responseBody).toBe(200)
      // Simulate an acknowledgement lost after the one-shot decision committed.
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: { code: 'internal', message: 'The reply-draft acknowledgement was lost.' },
      }) })
    })
    await page.getByRole('button', { name: 'Draft reply', exact: true }).click()
    await expect.poll(() => model.calls.length, { message: 'one local generation request reaches the authored peer' }).toBe(beforeDraft + 1)
    const wire = JSON.stringify(model.calls.at(-1))
    expect(wire).toContain(task)
    expect(wire).toContain(notes)
    expect(wire).toContain('Use the task and owner notes only.')
    expect(wire).not.toContain(PRIVATE_MARKER)
    expect(wire).not.toContain(process.env[keyName]!)
    expect((model.calls.at(-1) as Record<string, unknown>).tools).toBeUndefined()
    await expect(draftRegion).toContainText(/draft is pending|drafting/i)
    await expect(page.getByRole('button', { name: 'Draft reply', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Reply', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Review reply', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Decline request', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeEnabled()
    await expect.poll(() => draftPosts).toBe(1)
    await expect.poll(() => recoveryReads).toBeGreaterThan(0)
    await captureViewports(page, info, 'reply-draft-pending', draftRegion)
    model.setMode('success'); model.release()

    await expect(draftRegion).toContainText('Suggested reply · private to you', { timeout: ms(15_000) })
    await expect(draftRegion).toContainText(DRAFT_TEXT)
    await expect(page.getByRole('button', { name: 'Use reply draft', exact: true })).toBeVisible()
    await expect(page.getByLabel('Reply', { exact: true })).toHaveValue('Manual reply preserved while a suggestion is pending.')
    await captureViewports(page, info, 'reply-draft-complete', page.getByRole('button', { name: 'Use reply draft', exact: true }))

    const persisted = await api(request, stack, owner, 'GET', `/agent-requests/${requestRow.id}`)
    expect(persisted.replyDraft).toMatchObject({ status: 'done', text: DRAFT_TEXT, binding: { model: MODEL_ID, providerId: provider.id } })
    await page.reload()
    await page.getByRole('button', { name: 'Draft a reply…', exact: true }).click()
    const restoredDraftRegion = page.getByRole('region', { name: 'Optional reply draft', exact: true })
    await expect(restoredDraftRegion).toContainText(DRAFT_TEXT)
    await expect(restoredDraftRegion).toContainText('Suggested reply · private to you')
    await expect(page.getByLabel('Reply', { exact: true })).toHaveValue('')
    await expect.poll(async () => (await api(request, stack, owner, 'GET', `/agent-requests/${requestRow.id}`)).replyDraft.text).toBe(DRAFT_TEXT)
    expect(draftPosts, 'lost acknowledgement recovery never repeats the effect POST').toBe(1)
    const requesterReceipt = await api(request, stack, requester, 'GET', '/agent-requests/' + requestRow.id)
    expect(requesterReceipt.replyDraft).toBeUndefined()

    // Adoption is an explicit replacement step, followed by the same human
    // review and exact-text sharing gate as a hand-written answer.
    await page.getByLabel('Reply', { exact: true }).fill('Manual text to be replaced')
    await page.getByRole('button', { name: 'Review reply', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Share reply', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Use reply draft', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(/replace|discard/i)
    await page.getByRole('button', { name: /Replace with suggested reply|Confirm replacement/i }).click()
    await expect(page.getByLabel('Reply', { exact: true })).toHaveValue(DRAFT_TEXT)
    await expect(page.getByRole('button', { name: 'Share reply', exact: true })).toHaveCount(0)
    await page.getByLabel('Reply', { exact: true }).fill(`${DRAFT_TEXT} edited by owner.`)
    await page.getByRole('button', { name: 'Review reply', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Share reviewed reply', exact: true })).toContainText(`${DRAFT_TEXT} edited by owner.`)
    await page.getByRole('button', { name: 'Share reply', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Shared reply', exact: true })).toContainText(`${DRAFT_TEXT} edited by owner.`)
    const privateHistory = page.getByRole('region', { name: 'Private reply draft receipt', exact: true })
    await privateHistory.getByText('Saved reply draft · visible only to you', { exact: true }).click()
    await expect(privateHistory).toContainText(DRAFT_TEXT)
    await captureViewports(page, info, 'reply-draft-owner-shared', privateHistory)

    await requesterPage.page.goto(`/agents/requests/${encodeURIComponent(requestRow.id)}`)
    await expect(requesterPage.page.getByRole('region', { name: 'Shared reply', exact: true })).toContainText(`${DRAFT_TEXT} edited by owner.`)
    await expect(requesterPage.page.getByRole('region', { name: 'Private reply draft receipt', exact: true })).toHaveCount(0)
    await expect(requesterPage.page.getByText(DRAFT_TEXT, { exact: true })).toHaveCount(0)
    await expect(requesterPage.page.getByText(notes, { exact: true })).toHaveCount(0)
    await expect(requesterPage.page.getByText(PRIVATE_MARKER, { exact: true })).toHaveCount(0)
    await captureViewports(requesterPage.page, info, 'reply-draft-requester-shared', requesterPage.page.getByRole('region', { name: 'Shared reply', exact: true }))
    const foreignRead = await request.get(`${stack.url}/api/v1/agent-requests/${encodeURIComponent(requestRow.id)}`, {
      headers: { cookie: `${SESSION_COOKIE}=${foreign.cookie}`, ...sourceHeader(foreign) },
    })
    expect(foreignRead.status()).toBe(404)
    await foreignPage.page.goto(`/agents/requests/${encodeURIComponent(requestRow.id)}`)
    await expect(foreignPage.page.getByText('This request is unavailable to this person.', { exact: true })).toBeVisible()
    await captureViewports(foreignPage.page, info, 'reply-draft-foreign', foreignPage.page.getByText('This request is unavailable to this person.', { exact: true }))

    expect(model.calls).toHaveLength(1, 'manual reply and adoption do not silently regenerate')
    expect(toolReviewReads, 'direct reply-draft workflow never fetches MCP tool review').toBe(0)

    const afterTool = await api(request, stack, requester, 'POST', '/agent-requests', {
      fromAgentId: from.id, toAgentId: published.id, task: `Keep this post-tool suggestion private ${randomUUID()}`,
    }, randomUUID()) as { id: string; task: string; status: string; revision: number }
    const toolReview = await api(request, stack, owner, 'GET', `/agent-requests/${afterTool.id}/review`)
    const selectedTool = toolReview.tools.find((item: { tool: { name: string } }) => item.tool.name === 'read_private_note')
    expect(selectedTool).toBeTruthy()
    await api(request, stack, owner, 'POST', `/agent-requests/${afterTool.id}/decision`, {
      action: 'run', expectedRevision: afterTool.revision,
      approval: { transport: 'http', call: { connectionId: selectedTool.connectionId,
        connectionRevision: selectedTool.connectionRevision, toolName: selectedTool.tool.name,
        schemaHash: selectedTool.schemaHash, arguments: { query: 'owner-only result' } } },
    })
    await expect.poll(async () => (await api(request, stack, owner, 'GET', `/agent-requests/${afterTool.id}`)).status).toBe('awaiting-reply')
    const runReceipt = await api(request, stack, owner, 'GET', `/agent-requests/${afterTool.id}`)
    expect(JSON.stringify(runReceipt.execution?.result)).toContain(PRIVATE_MARKER)
    expect(peer.toolCalls).toEqual([{ name: 'read_private_note', arguments: { query: 'owner-only result' } }])

    await page.goto(`/agents/requests/${encodeURIComponent(afterTool.id)}`)
    await expect(page.getByRole('region', { name: 'Private execution receipt', exact: true })).toContainText(PRIVATE_MARKER)
    await page.getByRole('button', { name: 'Draft a reply…', exact: true }).click()
    const staleRegion = page.getByRole('region', { name: 'Optional reply draft', exact: true })
    await expect(staleRegion).toContainText('Provider')
    await page.getByRole('button', { name: 'Draft reply', exact: true }).click()
    await expect.poll(() => model.calls.length).toBe(2)
    const postToolWire = JSON.stringify(model.calls.at(-1))
    expect(postToolWire).toContain(afterTool.task)
    expect(postToolWire).toContain('Use the task and owner notes only.')
    expect(postToolWire).not.toContain(PRIVATE_MARKER,
      'a prior MCP result remains private and is excluded from reply-drafting input')
    expect((model.calls.at(-1) as Record<string, unknown>).tools).toBeUndefined()
    await expect(staleRegion).toContainText('Suggested reply · private to you', { timeout: ms(15_000) })
    await expect(staleRegion).toContainText(DRAFT_TEXT)

    // A failed current-model read cannot authorize adoption of cached text.
    const failedReview = `**/api/v1/agent-requests/${afterTool.id}/reply-review`
    await page.route(failedReview, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) }))
    await page.reload()
    await page.getByRole('button', { name: 'Draft a reply…', exact: true }).click()
    await expect(page.getByText('Could not verify the current Agent and model binding.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use reply draft', exact: true })).toHaveCount(0)
    await page.unroute(failedReview)

    const currentAgent = await api(request, stack, owner, 'GET', `/agents/${published.id}`) as Agent
    await api(request, stack, owner, 'PATCH', `/agents/${published.id}`, {
      instructions: `Changed after suggestion ${randomUUID()}.`, expectedRevision: currentAgent.revision,
    })
    await page.reload()
    await page.getByRole('button', { name: 'Draft a reply…', exact: true }).click()
    const staleReopened = page.getByRole('region', { name: 'Optional reply draft', exact: true })
    await expect(staleReopened).toContainText(DRAFT_TEXT)
    await expect(staleReopened).toContainText('Agent or model binding changed')
    await expect(page.getByRole('button', { name: 'Use reply draft', exact: true })).toHaveCount(0)
    await captureViewports(page, info, 'reply-draft-stale', staleReopened)
    expect(model.calls).toHaveLength(2, 'a changed binding cannot silently produce a replacement suggestion')
  } finally {
    model.release()
    await ownerPage?.dispose().catch(() => undefined)
    await ownerPage?.context.close().catch(() => undefined)
    await requesterPage?.dispose().catch(() => undefined)
    await requesterPage?.context.close().catch(() => undefined)
    await foreignPage?.dispose().catch(() => undefined)
    await foreignPage?.context.close().catch(() => undefined)
    await model.close().catch(() => undefined)
    await peer.close().catch(() => undefined)
    await stack.close().catch(() => undefined)
    if (oldKey === undefined) delete process.env[keyName]
    else process.env[keyName] = oldKey
  }
})
