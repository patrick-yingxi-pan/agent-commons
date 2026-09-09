/** A real scheduled run writes and refreshes one live, shareable document. */
import { test, expect, type Page } from '@playwright/test'
import { runSessionId, type ArtifactItem, type ScheduledRun, type ScheduledTask } from '../contract/index.ts'
import { createServer, type Server } from 'node:http'
import { API, newUser, openSection } from './social-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

function sse(res: import('node:http').ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** A test-owned Messages boundary whose two replies are deliberately distinct. */
async function startMessagesFixture() {
  let call = 0
  const replies: string[] = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean } : {}
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'e2e-schedule-model', display_name: 'Schedule artifact fixture' }] }))
      return
    }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    call += 1
    const reply = `Report ${call}: the release review is complete. Verified result ${Date.now().toString(36)}.`
    replies.push(reply)
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: `schedule_fixture_${call}`, type: 'message', role: 'assistant', model: 'e2e-schedule-model', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    const id = `schedule_fixture_${call}`
    sse(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'e2e-schedule-model', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    sse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, url: `http://127.0.0.1:${port}`, replies }
}

async function waitForRun(page: Page, id: string, runId: string): Promise<ScheduledRun> {
  let settled: ScheduledRun | undefined
  await expect.poll(async () => {
    const response = await page.request.get(`${API}/schedules`)
    const task = (await response.json() as ScheduledTask[]).find((candidate) => candidate.id === id)
    settled = task?.runs.find((run) => run.id === runId)
    return settled?.status ?? 'missing'
  }, { timeout: ms(30_000) }).toBe('ok')
  return settled!
}

async function applyRelation(page: Page, op: Record<string, unknown>) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op },
    headers: { 'Idempotency-Key': `schedule-artifact-${Date.now()}-${Math.random()}` },
  })
  expect(response.ok()).toBeTruthy()
}

async function artifactContent(page: Page): Promise<Record<string, { blocks?: Array<{ p?: string }> }>> {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<Record<string, { blocks?: Array<{ p?: string }> }>>
}

test('scheduled runs persist one real artifact and refresh already-open owner and reader pages', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  for (const user of [owner, reader, foreign]) user.page.setDefaultTimeout(ms(15_000))
  const fixture = await startMessagesFixture()
  const stamp = Date.now().toString(36)
  const artifactName = `scheduled-output-${stamp}.md`
  const routineName = `Scheduled artifact ${stamp}`
  for (const user of [owner, reader]) {
    await user.page.addInitScript(() => {
      const Native = window.EventSource
      window.EventSource = class extends Native {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init)
          this.addEventListener('message', (event) => {
            if (JSON.parse(event.data).type === 'hello') {
              ;(window as Window & { __routineHello?: boolean }).__routineHello = true
            }
          })
        }
      }
    })
  }

  try {
    const providerResponse = await owner.page.request.post(`${API}/providers`, { data: {
      label: `Schedule fixture ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'],
      models: [{ id: 'e2e-schedule-model', label: 'Schedule artifact fixture' }],
      config: { baseURL: fixture.url, model: 'e2e-schedule-model' },
    } })
    expect(providerResponse.ok()).toBeTruthy()
    const provider = await providerResponse.json() as { id: string }
    fixture.replies.splice(0) // Registration probes are not routine output.
    const prompts = await (await owner.page.request.get(`${API}/system-prompts`)).json() as Array<{ id: string }>
    expect(prompts.length).toBeGreaterThan(0)
    const agentResponse = await owner.page.request.post(`${API}/agents`, {
      data: { label: `Schedule agent ${stamp}`, providerId: provider.id, systemPromptId: prompts[0]!.id, tools: [], instructions: '' },
    })
    expect(agentResponse.ok()).toBeTruthy()
    const agent = await agentResponse.json() as { id: string }
    const templates = await (await owner.page.request.get(`${API}/schedule-templates`)).json() as Array<{ seed: Omit<ScheduledTask, 'id'> }>
    expect(templates.length).toBeGreaterThan(0)
    const template = templates[0]!.seed
    const routineResponse = await owner.page.request.post(`${API}/schedules`, {
      data: { seed: { ...template, name: routineName, prompt: `Produce a concise result for ${artifactName}.`, steps: [],
        delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
        runs: [], agentId: agent.id, providerId: provider.id, modelId: 'e2e-schedule-model', effort: 'Default', model: 'Schedule artifact fixture · Default', enabled: false } },
    })
    expect(routineResponse.ok(), await routineResponse.text()).toBeTruthy()
    const task = await routineResponse.json() as ScheduledTask
    await applyRelation(owner.page, { kind: 'set-schedule-artifact', scheduleId: task.id, scheduleName: task.name, cadence: task.cadence, artifactName })

    const firstRunResponse = await owner.page.request.post(`${API}/schedules/${task.id}/run`, { headers: { 'Idempotency-Key': `schedule-artifact-run-${stamp}-1` } })
    expect(firstRunResponse.ok()).toBeTruthy()
    const firstRun = await firstRunResponse.json() as ScheduledRun
    await waitForRun(owner.page, task.id, firstRun.id)
    const firstArtifacts = await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
    const firstMatches = firstArtifacts.filter((artifact) => artifact.name === artifactName)
    expect(firstMatches).toHaveLength(1)
    const artifact = firstMatches[0]!
    const firstContent = await artifactContent(owner.page)
    expect(fixture.replies).toHaveLength(1)
    expect(firstContent[artifact.id]?.blocks).toEqual([{ p: fixture.replies[0] }])

    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok()).toBeTruthy()
    const artifactPage = `[data-artifact-page="${artifact.id}"]`
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await reader.page.goto(`/artifacts/${artifact.id}`)
    await expect(owner.page.locator(artifactPage)).toBeVisible()
    await expect(reader.page.locator(artifactPage)).toBeVisible()
    await expect(owner.page.locator(artifactPage).getByText(fixture.replies[0]!, { exact: false })).toBeVisible()
    await expect(reader.page.locator(artifactPage).getByText(fixture.replies[0]!, { exact: false })).toBeVisible()
    for (const user of [owner, reader]) {
      await user.page.waitForFunction(() => (window as Window & { __routineHello?: boolean }).__routineHello === true)
    }

    const secondRunResponse = await owner.page.request.post(`${API}/schedules/${task.id}/run`, { headers: { 'Idempotency-Key': `schedule-artifact-run-${stamp}-2` } })
    expect(secondRunResponse.ok()).toBeTruthy()
    const secondRun = await secondRunResponse.json() as ScheduledRun
    await waitForRun(owner.page, task.id, secondRun.id)
    await expect(owner.page.locator(artifactPage).getByText(fixture.replies[1]!, { exact: false })).toBeVisible()
    await expect(reader.page.locator(artifactPage).getByText(fixture.replies[1]!, { exact: false })).toBeVisible()
    const refreshed = (await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]).filter((candidate) => candidate.name === artifactName)
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]!.id).toBe(artifact.id)
    expect(refreshed[0]!.excerpt).toContain(fixture.replies[1]!)
    expect(fixture.replies).toHaveLength(2)
    expect(refreshed[0]!.sourceSessionId).toBe(runSessionId(task.id, secondRun.id))
    const secondContent = await artifactContent(owner.page)
    expect(secondContent[artifact.id]?.blocks).toEqual([{ p: fixture.replies[1] }])

    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.locator(artifactPage)).toHaveCount(0)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()

    for (const viewport of VIEWPORTS) {
      for (const [role, user] of [['owner', owner], ['reader', reader]] as const) {
        await user.page.setViewportSize(viewport)
        await settleArtifactPageRail(user.page)
        await expect(user.page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible()
        await user.page.locator(artifactPage).scrollIntoViewIfNeeded()
        await expect(user.page.locator(artifactPage).getByText(fixture.replies[1]!, { exact: false })).toBeVisible()
        expect(await user.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        await user.page.screenshot({ path: testInfo.outputPath(`schedule-artifact-${role}-${viewport.width}x${viewport.height}.png`) })
      }
    }
    // The stable source id must open the latest run, not the first report's
    // conversation or a same-named unrelated Session.
    await openSection(owner.page, 'Provenance')
    await owner.page.getByRole('button', { name: `From Scheduled run of ${routineName}`, exact: true }).click()
    await expect(owner.page).toHaveURL(new RegExp(`/s/${runSessionId(task.id, secondRun.id)}$`))
    await expect(owner.page.getByText(fixture.replies[1]!, { exact: true })).toBeVisible()

    // A granted reader may read the authored artifact, but must not receive a
    // navigation door into the owner's private routine run.
    await openSection(reader.page, 'Provenance')
    await expect(reader.page.getByRole('button', { name: `From Scheduled run of ${routineName}`, exact: true })).toHaveCount(0)
  } finally {
    fixture.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve()))
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
