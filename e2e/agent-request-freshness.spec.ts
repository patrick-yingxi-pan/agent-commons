/** Real completion events may arrive before the pending decision acknowledgement.
 * The controlled response ordering must heal without the five-second fallback,
 * another model call, a page reload, or a second human decision. */
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '@playwright/test'
import type { Agent, ModelProvider } from '../contract/index.ts'
import type { AgentRequestView } from '../contract/agentRequests.ts'
import type { Identity } from '../contract/identity.ts'
import { DEFAULT_PROVIDER_ID } from '../contract/providers.ts'
import { startProviderRoutinePeer } from './provider-routine-peer.ts'
import { ms } from './budget.ts'

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function write<T>(request: APIRequestContext, path: string, data: unknown, method = 'POST'): Promise<T> {
  const response = await request.fetch(`/api/v1${path}`, {
    method, data, headers: { 'idempotency-key': randomUUID() },
  })
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

test('a crossed pending acknowledgement cannot strand the completed private reply draft', async ({ browser, baseURL }) => {
  test.setTimeout(ms(60_000))
  expect(baseURL).toBeTruthy()
  const owner = await browser.newContext({ baseURL })
  const requester = await browser.newContext({ baseURL })
  const peer = await startProviderRoutinePeer('anthropic', randomUUID())
  const acknowledgement = gate(), completionReads = gate()
  const page = await owner.newPage()
  try {
    const identities: Identity[] = []
    for (const [index, context] of [owner, requester].entries()) {
      identities.push(await write<Identity>(context.request, '/auth/signup', {
        name: `Draft freshness ${index}`, email: `${randomUUID()}@request-freshness.test`, password: `password-${randomUUID()}`,
      }))
    }
    const provider = await write<ModelProvider>(owner.request, '/providers', {
      label: `Local freshness ${randomUUID()}`, modelFamily: 'claude', kind: 'endpoint', effortLevels: [],
      config: { baseURL: peer.baseURL, model: peer.modelId, protocol: 'anthropic-messages' },
    })
    const agents: Agent[] = []
    for (const [index, context] of [owner, requester].entries()) {
      const providers = await context.request.get('/api/v1/providers')
      expect(providers.ok()).toBe(true)
      const defaultProvider = (await providers.json() as ModelProvider[]).find(provider => provider.id === DEFAULT_PROVIDER_ID)
      expect(defaultProvider).toBeTruthy()
      const prompt = await write<{ id: string }>(context.request, '/system-prompts', {
        label: 'Private request freshness', targetFamily: 'claude', body: 'Answer briefly without tools.',
      })
      agents.push(await write<Agent>(context.request, '/agents', {
        label: `Freshness Agent ${index}`, systemPromptId: prompt.id, tools: [],
        providerId: index === 0 ? provider.id : defaultProvider.id,
      }))
    }
    await write(owner.request, `/agents/${agents[0].id}`, { published: true, expectedRevision: agents[0].revision }, 'PATCH')
    const row = await write<AgentRequestView>(requester.request, '/agent-requests', {
      fromAgentId: agents[1].id, toAgentId: agents[0].id, task: 'Suggest one private reply. Do not run any tools.',
    })
    const path = `/api/v1/agent-requests/${row.id}`
    await page.addInitScript(() => {
      const observed: Array<{ type: string; requestId?: string }> = []
      ;(window as any).__draftEvents = observed
      const Native = window.EventSource
      window.EventSource = class extends Native {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init)
          this.addEventListener('message', event => { observed.push(JSON.parse(event.data)) })
        }
      }
    })
    await page.clock.install()
    await page.goto(`/agents/requests/${row.id}`)
    await expect(page.getByTestId('account-chip')).toContainText(identities[0].user.name)
    await expect.poll(() => page.evaluate(() => (window as any).__draftEvents.some((event: any) => event.type === 'hello'))).toBe(true)
    await page.getByRole('button', { name: 'Draft a reply…', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Optional reply draft', exact: true })
    await expect(panel.getByRole('button', { name: 'Draft reply', exact: true })).toBeEnabled()
    const changesBefore = await page.evaluate(id => (window as any).__draftEvents.filter((event: any) =>
      event.type === 'agent-request.changed' && event.requestId === id).length, row.id)

    let pending: AgentRequestView | undefined, completed: AgentRequestView | undefined, heldReads = 0, posts = 0, holdCompleted = true
    await page.route(`**${path}`, async route => {
      const response = await route.fetch()
      const incoming = await response.json() as AgentRequestView
      if (incoming.replyDraft?.status === 'done' && holdCompleted) {
        completed = incoming
        heldReads++
        await completionReads.promise
      }
      await route.fulfill({ response })
    })
    await page.route(`**${path}/decision`, async route => {
      expect(route.request().postDataJSON().action).toBe('draft-reply')
      posts++
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      pending = await response.json() as AgentRequestView
      expect(pending.replyDraft?.status).toBe('pending')
      await acknowledgement.promise
      await route.fulfill({ response })
    })
    await panel.getByRole('button', { name: 'Draft reply', exact: true }).click()
    await expect.poll(() => pending?.replyDraft?.status).toBe('pending')
    await expect.poll(() => heldReads, { message: 'a real completion event has started a newer detail read' }).toBeGreaterThan(0)
    expect(completed!.revision).toBeGreaterThan(pending!.revision)
    // Admission, recorded usage and terminal receipt each publish a real hint.
    await expect.poll(() => page.evaluate(id => (window as any).__draftEvents.filter((event: any) =>
      event.type === 'agent-request.changed' && event.requestId === id).length, row.id)).toBe(changesBefore + 3)
    // Freeze browser timers only after the real click and completion event. The
    // fallback poll must not conceal a lost event; HTTP and React still settle.
    await page.clock.pauseAt(new Date(Date.now() + 1_000))
    await expect(page.getByText('Sending this exact decision…', { exact: true })).toBeVisible()
    holdCompleted = false
    acknowledgement.release()
    await expect(page.getByText('Sending this exact decision…', { exact: true })).toHaveCount(0)
    completionReads.release()
    await expect(panel.getByText('Suggested reply · private to you', { exact: true })).toBeVisible()
    await expect(panel.getByRole('region', { name: 'Suggested reply', exact: true })).toHaveText(peer.reply)
    await expect(panel.getByRole('button', { name: 'Use reply draft', exact: true })).toBeEnabled()
    await expect(page.getByLabel('Reply', { exact: true })).toHaveValue('')
    expect(posts, 'read recovery never replays the decision').toBe(1)
    expect(peer.generationRequests(), 'read recovery never generates again').toHaveLength(1)
    const privateRead = await requester.request.get(path)
    expect(privateRead.status()).toBe(200)
    expect((await privateRead.json()).replyDraft).toBeUndefined()
  } finally {
    acknowledgement.release(); completionReads.release()
    await page.unrouteAll({ behavior: 'wait' })
    await owner.close(); await requester.close(); await peer.close()
  }
})
