/** Ordinary packaged-process acceptance for explicit real Dispatch.
 * The packaged executable, UI, API, SQLite, auth and restart recovery remain
 * real. Only the selected model's Messages endpoint is a bounded local fixture;
 * no Agent tools or MCP effects are granted, and no public provider is contacted.
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { DISPATCH_SMOKE_MODEL, startDispatchSmokeFixture } from './dispatchSmokeFixture.mjs'

const TIMEOUT_MS = 30_000
const PASSWORD = 'isolated-dispatch-smoke-password'
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

async function request(page, path, body, { key, status } = {}) {
  const result = await page.evaluate(async ({ path, body, key, status }) => {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body, key, status })
  if (status !== undefined) assert.equal(result.status, status, `Packaged Dispatch ${path} returned unexpected status.`)
  else assert.ok(result.status >= 200 && result.status < 300, `Packaged Dispatch ${path} returned HTTP ${result.status}.`)
  return result.body
}

function storedEntity(profile, slice, id) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get(slice, id)
    return row ? JSON.parse(row.json) : undefined
  } finally { database.close() }
}

async function readDispatch(page) {
  return request(page, '/dispatch')
}

async function openDispatchForm(page, origin, title, detail, binding) {
  await page.goto(`${origin}/dispatch`)
  await page.getByRole('button', { name: 'New dispatch', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New dispatch' })
  await dialog.getByRole('textbox', { name: 'Task' }).fill(title)
  await dialog.getByRole('textbox', { name: 'Detail' }).fill(detail)
  await dialog.getByRole("combobox", { name: "Agent", exact: true }).selectOption(binding.agentId)
  await dialog.getByRole("combobox", { name: "Model connection", exact: true }).selectOption(binding.providerId)
  await dialog.getByRole("combobox", { name: "Model", exact: true }).selectOption(binding.modelId)
  return dialog
}

async function signupAndConfigure(page, fixture) {
  const identity = await request(page, '/auth/signup', {
    name: 'Packaged Dispatch Owner',
    email: `packaged-dispatch-${Date.now().toString(36)}@example.test`,
    password: PASSWORD,
  })
  await page.reload()
  const provider = await request(page, '/providers', {
    label: 'Packaged Dispatch local model',
    modelFamily: 'claude',
    effortLevels: ['Low', 'Medium', 'High'],
    models: [{ id: DISPATCH_SMOKE_MODEL, label: 'Dispatch smoke fixture' }],
    config: { baseURL: fixture.origin, model: DISPATCH_SMOKE_MODEL },
  }, { key: 'packaged-dispatch-provider' })
  const prompt = await request(page, '/system-prompts', {
    label: 'Packaged Dispatch instructions',
    body: 'Answer the exact task clearly and briefly.',
    targetFamily: 'claude',
  }, { key: 'packaged-dispatch-prompt' })
  const agent = await request(page, '/agents', {
    label: 'Packaged Dispatch Agent',
    providerId: provider.id,
    systemPromptId: prompt.id,
    tools: [],
    instructions: 'Return a concise response. This smoke grants no tools.',
  }, { key: 'packaged-dispatch-agent' })
  return {
    identity,
    binding: { agentId: agent.id, providerId: provider.id, modelId: DISPATCH_SMOKE_MODEL },
  }
}

async function openDispatchConversation(page, origin, title) {
  await page.goto(`${origin}/dispatch`)
  const row = page.locator('[data-resource-synopsis-row]')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
  await row.getByRole('button', { name: title, exact: true }).click()
  await expect(page.locator('[data-session-title-bar]')).toContainText(title)
}

/** Run only from the ordinary packaged smoke, with its production artifact and
 * isolated OS user-data profile. `launch`/`close` are the real executable host. */
export async function smokePackagedDispatch({ executable, launch, close }) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-dispatch-smoke-'))
  const fixture = await startDispatchSmokeFixture()
  const evidenceDirectory = join(ROOT, '.data', 'desktop-dispatch-smoke')
  let run
  let stage = 'startup'
  try {
    await mkdir(evidenceDirectory, { recursive: true })
    run = await launch(executable, profile)
    let { page, origin } = run
    const { identity, binding } = await signupAndConfigure(page, fixture)
    const capabilities = await request(page, '/capabilities')
    assert.equal(capabilities.features?.dispatchExecution, true, 'ordinary packaged runtime exposes the separate real Dispatch capability')

    stage = 'rendered-first-dispatch'
    const title = 'Packaged Dispatch exact task'
    const detail = 'Summarize this task and preserve its exact user instructions.'
    const prompt = `${title}\n\n${detail}`
    let firstRequest
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/dispatch') {
        firstRequest = { body: request.postDataJSON(), key: request.headers()['idempotency-key'] }
      }
    })
    const dialog = await openDispatchForm(page, origin, title, detail, binding)
    await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => {
      const runRow = (await readDispatch(page)).find((candidate) => candidate.title === title && candidate.execution)
      return runRow?.execution?.state
    }, 'the selected local model returns a saved private reply').toBe('replied', { timeout: TIMEOUT_MS })
    assert.ok(firstRequest?.key, 'the rendered first Dispatch records its exact idempotency key')
    assert.deepEqual(firstRequest.body, { title, detail, execution: binding })
    const completed = (await readDispatch(page)).find((candidate) => candidate.title === title && candidate.execution)
    assert.equal(completed?.status, 'done')
    assert.equal(fixture.requests.length, 1)
    const firstModelRequest = fixture.requests[0]
    assert.equal(firstModelRequest.model, DISPATCH_SMOKE_MODEL)
    assert.ok(firstModelRequest.tools?.length > 0, 'ordinary conversation tools remain available')
    assert.ok(firstModelRequest.tools.every((tool) => tool.name.startsWith('api__')),
      'empty curated grants and no attached contexts expose only workspace reads and consent-gated API proposals, never external MCP tools')
    const firstUserMessage = firstModelRequest.messages.find((message) => message.role === 'user')
    const inputText = (message) => typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
        : ''
    assert.equal(inputText(firstUserMessage ?? { content: '' }), prompt,
    'the local fixture receives exactly the authored task and detail')
    assert.equal(completed?.execution?.agentId, binding.agentId)
    assert.equal(completed?.execution?.providerId, binding.providerId)
    assert.equal(completed?.execution?.modelId, binding.modelId)
    const firstSessionId = completed?.execution?.sessionId
    assert.ok(firstSessionId, 'the successful Dispatch owns its private conversation')
    const firstSession = await request(page, `/sessions/${encodeURIComponent(firstSessionId)}`)
    assert.equal(firstSession.tenantId, identity.tenant.id)
    assert.equal(firstSession.messages[0].content, prompt)
    assert.ok(firstSession.messages.some((message) => message.role === 'assistant' && message.content.includes('Local Dispatch fixture reply')))

    stage = 'ordinary-continuation'
    await openDispatchConversation(page, origin, title)
    const continuation = 'Continue the saved Dispatch conversation with one next step.'
    const composer = page.locator('[data-conversation-pane]').last().locator('textarea')
    await composer.fill(continuation)
    await composer.press('Enter')
    await expect.poll(async () => {
      const session = await request(page, `/sessions/${encodeURIComponent(firstSessionId)}`)
      return session.messages.some((message) => message.role === 'user' && message.content === continuation) &&
        session.messages.at(-1)?.role === 'assistant'
    }, 'a Dispatch result remains an ordinary continuable Session').toBe(true, { timeout: TIMEOUT_MS })
    assert.equal(fixture.requests.length, 2)

    stage = 'durable-pending-before-quit'
    const heldTitle = 'Packaged Dispatch interrupted task'
    const heldDetail = 'Leave this exact call held until the native app exits.'
    fixture.setMode('hold')
    let interruptedRequest
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/dispatch') {
        const body = request.postDataJSON()
        if (body?.title === heldTitle) interruptedRequest = { body, key: request.headers()['idempotency-key'] }
      }
    })
    const heldDialog = await openDispatchForm(page, origin, heldTitle, heldDetail, binding)
    await heldDialog.getByRole('button', { name: 'Dispatch', exact: true }).click()
    await expect.poll(() => fixture.requests.length).toBe(3)
    await expect.poll(() => fixture.heldCount).toBe(1)
    assert.ok(interruptedRequest?.key, 'the held rendered action retains its exact replay key')
    assert.deepEqual(interruptedRequest.body, { title: heldTitle, detail: heldDetail, execution: binding })
    const running = (await readDispatch(page)).find((candidate) => candidate.title === heldTitle && candidate.execution)
    assert.ok(running?.execution)
    assert.equal(running.status, 'running')
    assert.equal(running.execution.state, 'running')
    const sessionId = running.execution.sessionId
    const pendingBeforeQuit = storedEntity(profile, 'sessions', sessionId)
    const dispatchBeforeQuit = storedEntity(profile, 'dispatch', running.id)
    assert.equal(dispatchBeforeQuit?.status, 'running', 'SQLite has the running row before the model response is released')
    assert.equal(pendingBeforeQuit?.messages?.length, 1)
    assert.equal(pendingBeforeQuit.messages[0].content, `${heldTitle}\n\n${heldDetail}`)
    assert.equal(pendingBeforeQuit.messages[0].role, 'user')
    assert.equal(pendingBeforeQuit.tenantId, identity.tenant.id)

    const oldOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }),
      'the original packaged backend exits before restart recovery')
    await expect.poll(() => fixture.heldCount).toBe(0)
    assert.equal(fixture.requests.length, 3)
    const diskAtExit = storedEntity(profile, 'dispatch', running.id)
    assert.equal(diskAtExit?.status, 'running', 'process exit does not fabricate a model completion')

    stage = 'relaunch-and-exact-replay'
    fixture.setMode('reply')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    const reopenedIdentity = await request(page, '/me')
    assert.equal(reopenedIdentity.user.id, identity.user.id, 'ordinary OS-backed sign-in survives relaunch')
    const recoveredFeed = await readDispatch(page)
    const recovered = recoveredFeed.find((candidate) => candidate.id === running.id)
    assert.equal(recovered?.status, 'failed')
    assert.equal(recovered?.execution?.state, 'interrupted')
    assert.deepEqual(storedEntity(profile, 'dispatch', running.id), recovered,
      'the interrupted receipt is committed to SQLite before a follow-up mutation')
    await page.goto(`${origin}/dispatch`)
    const interruptedRow = page.locator('[data-resource-synopsis-row]')
      .filter({ has: page.getByRole('button', { name: heldTitle, exact: true }) })
    await expect(interruptedRow).toContainText('Interrupted')
    await expect(page.getByText('Interrupted runs are never restarted automatically.', { exact: false })).toBeVisible()
    await page.screenshot({ path: join(evidenceDirectory, 'interrupted-after-relaunch.png') })
    const recoveredSession = await request(page, `/sessions/${encodeURIComponent(sessionId)}`)
    assert.equal(recoveredSession.messages.length, 1, 'recovery never invents an assistant reply')
    assert.equal(recoveredSession.messages[0].content, `${heldTitle}\n\n${heldDetail}`)
    const replay = await request(page, '/dispatch', interruptedRequest.body, { key: interruptedRequest.key })
    assert.equal(replay.id, running.id, 'same-key recovery returns the original durable Dispatch')
    assert.equal(replay.execution.sessionId, sessionId, 'the exact original private Session identity remains bound')
    assert.equal(fixture.requests.length, 3, 'startup recovery and exact Retry never redispatch the model call')
    assert.equal(fixture.heldCount, 0)
    stage = 'project-work-draft-review'
    const { project } = await request(page, '/projects', { name: 'Packaged draft Project', description: 'Frozen packaged Project description.' }, { key: 'packaged-draft-project' })
    const item = await request(page, `/projects/${project.id}/open-subgoals`, {
      subGoal: 'Prepare the next release response', type: 'charge', target: 'release-budget', note: 'Do not perform the requested effect.',
    }, { key: 'packaged-draft-item' })
    const commission = await request(page, '/commissions', { agentId: binding.agentId, projectId: project.id, role: 'reader', standing: false }, { key: 'packaged-draft-commission' })
    await page.goto(`${origin}/projects/${project.id}/work/${item.id}`)
    await page.getByRole('button', { name: 'Draft a response', exact: true }).click()
    const draftPanel = page.locator('[data-project-work-draft]')
    await draftPanel.locator('[data-project-work-commission]').selectOption(commission.id)
    await draftPanel.locator('[data-project-work-provider]').selectOption(binding.providerId)
    await draftPanel.locator('[data-project-work-model]').selectOption(binding.modelId)
    await draftPanel.locator('[data-project-work-start]').click()
    await expect.poll(async () => (await readDispatch(page)).find(candidate => candidate.execution?.projectWork?.itemId === item.id)?.execution?.state).toBe('replied', { timeout: TIMEOUT_MS })
    const projectDraft = (await readDispatch(page)).find(candidate => candidate.execution?.projectWork?.itemId === item.id)
    assert.equal(fixture.requests.length, 4)
    assert.equal(fixture.requests[3].tools, undefined, 'Project drafting exposes no tools, including workspace API tools')
    assert.match(JSON.stringify(fixture.requests[3].messages), /Frozen packaged Project description/)
    assert.deepEqual(projectDraft.execution.projectWork, { projectId: project.id, itemId: item.id, commissionId: commission.id, expectedRevision: commission.configurationRevision ?? 0 })
    assert.equal(storedEntity(profile, 'dispatch', projectDraft.id).execution.projectWork.itemId, item.id)
    await draftPanel.getByRole('button', { name: 'Review for sharing', exact: true }).click()
    await expect(draftPanel.locator('[data-project-work-reply]')).toHaveValue(/Local Dispatch fixture reply/)
    const sharedText = 'Reviewed by the owner: here is the proposed release plan.'
    await draftPanel.locator('[data-project-work-reply]').fill(sharedText)
    await draftPanel.locator('[data-project-work-share]').click()
    await expect.poll(async () => (await request(page, `/projects/${project.id}/open-subgoals`)).find(row => row.id === item.id)?.comments?.some(comment => comment.body === sharedText)).toBe(true)
    const workAfterShare = (await request(page, `/projects/${project.id}/open-subgoals`)).find(row => row.id === item.id)
    assert.equal(workAfterShare.status, 'open', 'posting a response is not performing or completing Project work')
    assert.ok(!JSON.stringify(workAfterShare).includes(projectDraft.execution.sessionId), 'shared work never exposes the private conversation identity')
    await page.screenshot({ path: join(evidenceDirectory, 'project-draft-reviewed-and-shared.png') })

    stage = 'project-work-draft-relaunch'
    await close(run)
    run = undefined
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    const retainedDraft = (await readDispatch(page)).find(candidate => candidate.id === projectDraft.id)
    assert.deepEqual(retainedDraft, projectDraft)
    const retainedWork = (await request(page, `/projects/${project.id}/open-subgoals`)).find(row => row.id === item.id)
    assert.equal(retainedWork.status, 'open')
    assert.equal(retainedWork.comments.filter(comment => comment.body === sharedText).length, 1)
    assert.equal(fixture.requests.length, 4, 'relaunch retains the private draft and reviewed comment without another model call')
    console.log('[desktop-dispatch-smoke] ordinary packaged process · rendered explicit binding · private continuable Session · SQLite pending before quit · restart fails closed · same-key replay without redispatch')
    console.log('[desktop-project-draft-smoke] reader Commission · frozen source · tool-free private reply · reviewed comment only · open work and SQLite retained across relaunch')
  } catch (error) {
    throw new Error(`Packaged Dispatch smoke failed during ${stage}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await close(run)
    await fixture.close()
    await rm(profile, { recursive: true, force: true })
  }
}
