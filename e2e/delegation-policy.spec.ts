/** Rendered owner policy versioning, UTC expiry, and exact-write recovery. */
import { createServer, type Server } from 'node:http'
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import type { Agent, Contribution, CreateProjectResponse, Delegation, ModelProvider, Project, SystemPromptEntry } from '../contract/index.ts'
import { DEFAULT_PROVIDER_ID } from '../contract/providers.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { tierFor } from '../src/lib/viewport.ts'
import { ms } from './budget.ts'
import { splitPane } from './pane-actions.ts'
import { newUser } from './social-helpers.ts'

const API = '/api/v1'
const viewports = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

interface PolicyJudgmentFixture {
  server: Server
  baseURL: string
  close(): Promise<void>
}
const activePolicyFixtures = new Set<PolicyJudgmentFixture>()
test.afterEach(async () => {
  await Promise.all([...activePolicyFixtures].map((fixture) => fixture.close()))
})

async function startPolicyJudgmentFixture(): Promise<PolicyJudgmentFixture> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any> : {}
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'policy-hold-fixture-model', display_name: 'Policy hold fixture' }] }))
      return
    }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'msg-policy-hold-fixture', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text: JSON.stringify({ decision: 'approve', summary: 'The configured fixture is ready.' }) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  expect(address && typeof address === 'object').toBeTruthy()
  const fixture: PolicyJudgmentFixture = {
    server,
    baseURL: `http://127.0.0.1:${(address as { port: number }).port}`,
    close: async () => {
      if (!activePolicyFixtures.has(fixture)) return
      activePolicyFixtures.delete(fixture)
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  activePolicyFixtures.add(fixture)
  return fixture
}

async function createConfiguredAgent(page: Page, label: string): Promise<{ agent: Agent; fixture: PolicyJudgmentFixture }> {
  const fixture = await startPolicyJudgmentFixture()
  const providerResponse = await page.request.post(`${API}/providers`, {
    data: {
      label: `Configured ${label}`,
      modelFamily: 'claude',
      effortLevels: ['Low'],
      models: [{ id: 'policy-hold-fixture-model', label: 'Policy hold fixture' }],
      config: { baseURL: fixture.baseURL, model: 'policy-hold-fixture-model' },
    },
    headers: { 'Idempotency-Key': `policy-provider-${Date.now()}-${Math.random()}` },
  })
  expect(providerResponse.ok(), 'local judgment provider configured').toBe(true)
  const provider = await providerResponse.json() as ModelProvider
  const promptsResponse = await page.request.get(`${API}/system-prompts`)
  expect(promptsResponse.ok()).toBe(true)
  const prompts = await promptsResponse.json() as SystemPromptEntry[]
  const agentResponse = await page.request.post(`${API}/agents`, {
    data: { label, providerId: provider.id, systemPromptId: prompts[0]!.id, tools: [] },
    headers: { 'Idempotency-Key': `policy-agent-${Date.now()}-${Math.random()}` },
  })
  expect(agentResponse.ok(), 'Agent uses the configured judgment provider').toBe(true)
  const agent = await agentResponse.json() as Agent
  const providersResponse = await page.request.get(`${API}/providers`)
  expect(providersResponse.ok()).toBe(true)
  const savedProvider = (await providersResponse.json() as ModelProvider[]).find((candidate) => candidate.id === provider.id)
  expect(savedProvider?.execution).toBe('configured')
  return { agent, fixture }
}

async function createProject(page: Page, name: string): Promise<Project> {
  const response = await page.request.post(`${API}/projects`, {
    data: { name, description: 'A test-owned Project for versioned Delegation policy.' },
  })
  expect(response.ok(), 'test-owned Project created').toBe(true)
  return ((await response.json()) as CreateProjectResponse).project
}

async function createAgent(page: Page, label: string): Promise<Agent> {
  const response = await page.request.post(`${API}/agents`, {
    data: { label, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID },
    headers: { 'Idempotency-Key': `policy-agent-${Date.now()}-${Math.random()}` },
  })
  expect(response.ok(), 'test-owned Agent created').toBe(true)
  return response.json() as Promise<Agent>
}

async function createDelegation(page: Page, project: Project, agent: Agent, actKind: 'land' | 'approve-envelope' = 'land'): Promise<Delegation> {
  const response = await page.request.post(`${API}/projects/${encodeURIComponent(project.id)}/delegations`, {
    data: {
      agentId: agent.id,
      actKind,
      policy: 'Original owner-reviewed policy.',
      escalation: ['unreviewed'],
      mode: 'draft',
    },
    headers: { 'Idempotency-Key': `delegation-${Date.now()}-${Math.random()}` },
  })
  expect(response.ok(), 'test-owned Delegation created').toBe(true)
  return response.json() as Promise<Delegation>
}

async function createContribution(page: Page, project: Project, stamp: string): Promise<Contribution> {
  const response = await page.request.post(`${API}/projects/${encodeURIComponent(project.id)}/contributions`, {
    data: { title: `Policy gate ${stamp}`, summary: 'A pending Contribution used to expose Ask.' },
    headers: { 'Idempotency-Key': `policy-contribution-${stamp}` },
  })
  expect(response.ok(), 'test-owned Contribution created').toBe(true)
  return response.json() as Promise<Contribution>
}

async function openDelegationSection(page: Page, project: Project) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  await expandDelegationSection(main)
  return main
}

async function expandDelegationSection(main: import('@playwright/test').Locator) {
  const header = main.getByRole('button', { name: /^Delegation\b/ })
  if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

async function openEditor(page: Page, project: Project, delegation: Delegation, agent: Agent) {
  const main = await openDelegationSection(page, project)
  const row = main.locator(`[data-delegation-id="${delegation.id}"]`)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: `Edit ${agent.label}'s delegation policy`, exact: true }).click()
  const editor = row.locator('[data-delegation-policy-editor]')
  await expect(editor).toBeVisible()
  return { main, row, editor }
}

async function roster(page: Page, projectId: string): Promise<Delegation[]> {
  const response = await page.request.get(`${API}/projects/${encodeURIComponent(projectId)}/delegations`)
  expect(response.ok(), 'Delegation roster is readable').toBe(true)
  return response.json() as Promise<Delegation[]>
}

function patchUrl(projectId: string, delegationId: string): string {
  return `**${API}/projects/${encodeURIComponent(projectId)}/delegations/${encodeURIComponent(delegationId)}`
}

async function createSharedProject(page: Page, project: Project) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
  })
  expect(response.ok(), 'Project shared for the reader projection').toBe(true)
}

async function assertContained(page: Page, element: import('@playwright/test').Locator, viewport: { width: number; height: number }) {
  // Resize changes rail posture asynchronously. A box can fit while the old
  // rail still covers it, so prove the collapsed narrow shell before capture.
  await expect.poll(() => page.evaluate(({ width, narrow }) => {
    const rail = document.querySelector('aside')?.closest('[inert]')
    return innerWidth === width && (!narrow || !!rail && rail.getBoundingClientRect().width === 0)
  }, { width: viewport.width, narrow: tierFor(viewport.width) === 'narrow' })).toBe(true)
  await element.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(() => element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  const box = await element.boundingBox()
  expect(box, 'visible Delegation surface has a rendered box').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
}

async function assertStableDelegationLoading(browser: Browser, testInfo: TestInfo, outcome: 'loaded' | 'unavailable') {
  const owner = await newUser(browser)
  const proposer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const project = await createProject(owner.page, `Stable policy section ${Date.now()}`)
  const shared = await owner.page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'project', id: project.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'propose' },
  })
  expect(shared.ok()).toBe(true)
  const offered = await proposer.page.request.post(`${API}/proposals`, {
    data: { subject: { kind: 'project', id: project.id }, delta: { kind: 'suggestion', text: 'A neighboring reviewed change.' }, rationale: 'Ready for the owner.' },
  })
  expect(offered.ok()).toBe(true)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await owner.page.route('**/src/components/DelegationPanel.tsx*', async (route) => {
    await held
    if (outcome === 'loaded') await route.continue()
    else await route.abort()
  })
  try {
    await owner.page.goto(`/projects/${project.id}`)
    await expect(owner.page.getByText('Loading Delegation controls…', { exact: true })).toBeVisible()
    const section = owner.page.locator('[data-resource-section="Delegation"]')
    for (const viewport of viewports) {
      await owner.page.setViewportSize(viewport)
      await assertContained(owner.page, section, viewport)
      await owner.page.screenshot({ path: testInfo.outputPath(`policy-loading-${viewport.width}x${viewport.height}.png`) })
    }
    const land = owner.page.getByRole('button', { name: 'Land', exact: true })
    await land.scrollIntoViewIfNeeded()
    const before = await land.boundingBox()
    expect(before).not.toBeNull()
    await owner.page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2)
    await owner.page.mouse.down()
    release()
    if (outcome === 'loaded') {
      await expect(owner.page.getByRole('button', { name: 'Delegate judgment', exact: true })).toBeAttached()
    } else {
      await expect(owner.page.getByRole('alert')).toHaveText('Couldn’t load Delegation controls. Open for recovery.')
    }
    const after = await land.boundingBox()
    expect(after).not.toBeNull()
    expect(after!.y, 'the folded section keeps the pending pointer target in place').toBeCloseTo(before!.y, 0)
    await owner.page.mouse.up()
    await expect(owner.page.getByText('L1', { exact: true })).toBeVisible()
    if (outcome === 'unavailable') {
      await section.getByRole('button', { name: /^Delegation\b/ }).click()
      await expect(owner.page.getByRole('alert')).toContainText('Reloading clears unsent drafts and in-memory recovery')
      const reload = section.getByRole('button', { name: 'Reload app', exact: true })
      await expect(reload).toBeVisible()
      for (const viewport of viewports) {
        await owner.page.setViewportSize(viewport)
        await assertContained(owner.page, section, viewport)
        await assertContained(owner.page, reload, viewport)
        await owner.page.screenshot({ path: testInfo.outputPath(`policy-load-failure-${viewport.width}x${viewport.height}.png`) })
      }
    }
  } finally {
    release()
    await owner.page.mouse.up()
    await owner.page.unrouteAll({ behavior: 'wait' })
    await proposer.context.close()
    await owner.context.close()
  }
}

test('loaded Delegation controls cannot move a neighboring Land action during a pointer press', async ({ browser }, testInfo) => {
  await assertStableDelegationLoading(browser, testInfo, 'loaded')
})

test('unavailable Delegation controls cannot move a neighboring Land action during a pointer press', async ({ browser }, testInfo) => {
  await assertStableDelegationLoading(browser, testInfo, 'unavailable')
})

test('owner writes a complete UTC policy version and private history while shared readers see governance only', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const stamp = Date.now().toString(36)
  const project = await createProject(owner.page, `Versioned policy ${stamp}`)
  const agent = await createAgent(owner.page, `Policy Agent ${stamp}`)
  const delegation = await createDelegation(owner.page, project, agent)
  const policy = `Updated owner-only criteria ${stamp}`
  const localExpiry = '2035-06-07T08:09'
  const expectedExpiry = await owner.page.evaluate((value) => new Date(value).getTime(), localExpiry)
  const { main, row, editor } = await openEditor(owner.page, project, delegation, agent)
  await editor.getByLabel('Delegation policy').fill(policy)
  await editor.getByLabel('Delegation autonomy').selectOption('decide')
  await editor.getByRole('checkbox', { name: 'Outside contributor', exact: true }).click()
  await editor.getByLabel('Delegation expiry').fill(localExpiry)
  const initialHistory = row.getByText('Version history (1)', { exact: true })
  await expect(initialHistory).toBeVisible()
  await initialHistory.click()
  for (const viewport of viewports) {
    await owner.page.setViewportSize(viewport)
    await assertContained(owner.page, editor, viewport)
    await assertContained(owner.page, row, viewport)
    await owner.page.screenshot({ path: testInfo.outputPath(`delegation-policy-editor-history-${viewport.width}x${viewport.height}.png`) })
  }
  await editor.getByRole('button', { name: 'Save policy version', exact: true }).click()

  await expect(editor).toHaveCount(0)
  const history = row.locator('details')
  await expect(history.locator('summary')).toHaveText('Version history (2)')
  if (!(await history.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await history.locator('summary').click()
  }
  await expect(row.locator('[data-delegation-policy-version="0"]')).toContainText('Policy version 0')
  await expect(row.locator('[data-delegation-policy-version="1"]')).toContainText('Policy version 1')
  await expect(row).toContainText(policy)
  await expect(row).toContainText('decides within policy')

  const saved = (await roster(owner.page, project.id)).find((candidate) => candidate.id === delegation.id)
  expect(saved?.revision).toBe(1)
  expect(saved?.policy).toBe(policy)
  expect(saved?.mode).toBe('decide')
  expect(saved?.escalation).toEqual(['effectful', 'unreviewed', 'stranger'])
  expect(saved?.expiresAt).toBe(expectedExpiry)
  expect(saved?.versions?.map((version) => version.revision)).toEqual([0, 1])

  await createSharedProject(owner.page, project)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  for (const viewport of viewports) {
    await reader.page.setViewportSize(viewport)
    const sharedMain = await openDelegationSection(reader.page, project)
    const sharedRow = sharedMain.locator(`[data-delegation-id="${delegation.id}"]`)
    await expect(sharedRow).toBeVisible()
    await expect(sharedRow).toContainText('decides within policy')
    await expect(sharedRow).toContainText('Expires')
    await expect(sharedMain.getByRole('button', { name: 'Delegate judgment', exact: true })).toHaveCount(0)
    await expect(sharedRow).not.toContainText(policy)
    await expect(sharedRow.getByRole('button', { name: /Edit .* delegation policy/ })).toHaveCount(0)
    await expect(sharedRow.getByText(/Version history/)).toHaveCount(0)
    await assertContained(reader.page, sharedRow, viewport)
    await reader.page.screenshot({ path: testInfo.outputPath(`delegation-policy-shared-${viewport.width}x${viewport.height}.png`) })
  }

  await reader.context.close()
  await owner.context.close()
})

test('a pre-commit policy outage holds its exact draft and pauses a configured Delegated judgment', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Held policy ${stamp}`)
  const { agent } = await createConfiguredAgent(page, `Held Agent ${stamp}`)
  const delegation = await createDelegation(page, project, agent, 'land')
  const contribution = await createContribution(page, project, stamp)
  const changesetResponse = await page.request.post(`${API}/projects/${encodeURIComponent(project.id)}/contributions/${encodeURIComponent(contribution.id)}/changeset`, {
    data: { entries: [{ kind: 'note', target: 'policy hold check', after: 'A stable judgment input.' }] },
    headers: { 'Idempotency-Key': `policy-hold-changeset-${stamp}` },
  })
  expect(changesetResponse.ok()).toBe(true)
  const policy = `Keep exact pending policy ${stamp}`
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(patchUrl(project.id, delegation.id), async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit outage.' } }) })
      return
    }
    await route.continue()
  })

  await page.goto(`/projects/${encodeURIComponent(project.id)}/changes/${encodeURIComponent(contribution.id)}`)
  const initialMain = page.locator('main')
  const initialPanel = initialMain.getByRole('region', { name: 'Delegated judgments', exact: true })
  await expect(initialPanel).toBeVisible()
  await initialPanel.getByRole('combobox', { name: 'Current Delegation', exact: true }).selectOption(delegation.id)
  await expect(initialPanel.getByRole('button', { name: 'Run judgment · uses budget', exact: true })).toBeEnabled()
  await initialMain.getByRole('button', { name: project.name, exact: true }).click()

  const { main: projectMain, editor } = await openEditor(page, project, delegation, agent)
  await editor.getByLabel('Delegation policy').fill(policy)
  await editor.getByLabel('Delegation autonomy').selectOption('decide')
  await editor.getByRole('checkbox', { name: 'Outside contributor', exact: true }).click()
  await editor.getByRole('button', { name: 'Save policy version', exact: true }).click()
  const failed = page.locator('[data-delegation-policy-mutation="failed"]')
  await expect(failed).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Retry exact edit', exact: true })).toBeVisible()
  await expect(editor.getByLabel('Delegation policy')).toHaveValue(policy)
  await expect(editor.getByLabel('Delegation policy')).toBeDisabled()

  await projectMain.getByRole('button', { name: contribution.title, exact: true }).first().click()
  const contributionMain = page.locator('main')
  await expect(contributionMain.getByRole('heading', { name: contribution.title, exact: true })).toBeVisible()
  const heldPanel = contributionMain.getByRole('region', { name: 'Delegated judgments', exact: true })
  await expect(heldPanel.locator(`option[value="${delegation.id}"]`)).toHaveAttribute('disabled', '')
  await expect(heldPanel.locator(`option[value="${delegation.id}"]`)).toContainText('policy update pending')
  await expect(heldPanel.getByRole('button', { name: 'Run judgment · uses budget', exact: true })).toBeDisabled()
  await expect(page.locator('[data-delegation-policy-mutation="failed"]')).toBeVisible()

  await contributionMain.getByRole('button', { name: project.name, exact: true }).click()
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true })).toBeVisible()
  await expect(page.locator('[data-delegation-policy-mutation="failed"]')).toBeVisible()
  await expandDelegationSection(main)
  const row = main.locator(`[data-delegation-id="${delegation.id}"]`)
  const revoke = row.getByRole('button', { name: `Revoke ${agent.label}'s delegation`, exact: true })
  await expect(revoke).toBeDisabled()
  await page.locator('[data-delegation-policy-mutation="failed"]')
    .getByRole('button', { name: 'Retry exact edit', exact: true }).click()
  await expect(row.locator('[data-delegation-policy-editor]')).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toEqual({
    expectedRevision: 0,
    policy,
    escalation: ['effectful', 'unreviewed', 'stranger'],
    mode: 'decide',
    expiresAt: null,
  })
  const saved = (await roster(page, project.id)).find((candidate) => candidate.id === delegation.id)
  expect(saved?.revision).toBe(1)
  expect(saved?.policy).toBe(policy)
  await main.getByRole('button', { name: contribution.title, exact: true }).first().click()
  const recoveredPanel = page.getByRole('region', { name: 'Delegated judgments', exact: true })
  await expect(recoveredPanel).toBeVisible()
  await recoveredPanel.getByRole('combobox', { name: 'Current Delegation', exact: true }).selectOption(delegation.id)
  await expect(recoveredPanel.getByRole('button', { name: 'Run judgment · uses budget', exact: true })).toBeEnabled()
})

test('a lost policy acknowledgement heals from the exact immutable version without another PATCH', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Lost policy ack ${stamp}`)
  const agent = await createAgent(page, `Ack Agent ${stamp}`)
  const delegation = await createDelegation(page, project, agent)
  const policy = `Exact recovered policy ${stamp}`
  const keys: string[] = []
  let attempts = 0
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readsReleased = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(patchUrl(project.id, delegation.id), async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }) })
  })
  await page.route(`**${API}/projects/${encodeURIComponent(project.id)}/delegations`, async (route) => {
    if (attempts > 0 && route.request().method() === 'GET') {
      markReadStarted()
      await readsReleased
    }
    await route.continue()
  })

  const { row, editor } = await openEditor(page, project, delegation, agent)
  await editor.getByLabel('Delegation policy').fill(policy)
  await editor.getByRole('button', { name: 'Save policy version', exact: true }).click()
  await readStarted
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Delegation policy')).toHaveValue(policy)
  await expect(editor.getByLabel('Delegation policy')).toBeDisabled()
  releaseRead()
  await expect(editor).toHaveCount(0)
  await expect(row).toContainText(policy)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const stored = (await roster(page, project.id)).find((candidate) => candidate.id === delegation.id)
  expect(stored?.versions?.some((version) => version.revision === 1 && version.policy === policy)).toBe(true)
})

test('a stale policy edit leaves the owner draft visible beside current server truth', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Stale policy ${stamp}`)
  const agent = await createAgent(page, `Stale Agent ${stamp}`)
  const delegation = await createDelegation(page, project, agent)
  const draft = `Owner draft survives conflict ${stamp}`
  const { row, editor } = await openEditor(page, project, delegation, agent)
  await editor.getByLabel('Delegation policy').fill(draft)

  const concurrent = await page.request.patch(`${API}/projects/${encodeURIComponent(project.id)}/delegations/${encodeURIComponent(delegation.id)}`, {
    data: {
      expectedRevision: 0,
      policy: `Concurrent server policy ${stamp}`,
      escalation: ['effectful', 'unreviewed'],
      mode: 'draft',
      expiresAt: null,
    },
    headers: { 'Idempotency-Key': `concurrent-policy-${stamp}` },
  })
  expect(concurrent.ok(), 'independent owner edit advances current policy revision').toBe(true)
  const submitted: Record<string, unknown>[] = []
  const keys: string[] = []
  await page.route(patchUrl(project.id, delegation.id), async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    submitted.push(route.request().postDataJSON() as Record<string, unknown>)
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    await route.continue()
  })

  await editor.getByRole('button', { name: 'Save policy version', exact: true }).click()
  const failed = page.locator('[data-delegation-policy-mutation="failed"]')
  await expect(failed).toBeVisible()
  await expect(editor.getByLabel('Delegation policy')).toHaveValue(draft)
  await expect(editor.getByLabel('Delegation policy')).toBeDisabled()
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toMatchObject({ expectedRevision: 0, policy: draft })
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(failed).toHaveCount(0)
  const conflict = editor.getByRole('alert')
  await expect(conflict).toContainText('Review the current policy before saving again. Your draft is kept below.')
  await expect(conflict).toContainText(`Concurrent server policy ${stamp}`)
  await expect(editor.getByLabel('Delegation policy')).toHaveValue(draft)
  await editor.getByRole('button', { name: 'Review current version and keep my draft', exact: true }).click()
  await expect(row).toContainText('reviewing version 1')
  await expect(editor.getByLabel('Delegation policy')).toHaveValue(draft)
  await expect(editor.getByLabel('Delegation policy')).toBeEnabled()
  await editor.getByRole('button', { name: 'Save policy version', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(submitted).toHaveLength(2)
  expect(submitted[1]).toEqual({
    expectedRevision: 1,
    policy: draft,
    escalation: ['effectful', 'unreviewed'],
    mode: 'draft',
    expiresAt: null,
  })
  expect(keys.every((key) => key.length > 0)).toBe(true)
  expect(keys[1]).not.toBe(keys[0], 'rebasing after an explicit stale-intent dismissal mints a new logical edit')
  await expect(row).toContainText(draft)
  await expect(row.locator('details summary')).toHaveText('Version history (3)')
  const saved = (await roster(page, project.id)).find((candidate) => candidate.id === delegation.id)
  expect(saved?.revision).toBe(2)
  expect(saved?.policy).toBe(draft)
  expect(saved?.versions?.map((version) => version.revision)).toEqual([0, 1, 2])
})

test('duplicate Project panes share one unsaved Delegation policy draft and close together on save', async ({ page }) => {
  test.setTimeout(ms(75_000))
  await page.setViewportSize({ width: 1280, height: 900 })
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Split policy draft ${stamp}`)
  const agent = await createAgent(page, `Split Agent ${stamp}`)
  const delegation = await createDelegation(page, project, agent)
  const firstDraft = `First pane draft ${stamp}`
  const finalDraft = `Second pane synchronized draft ${stamp}`
  const { editor } = await openEditor(page, project, delegation, agent)
  await editor.getByLabel('Delegation policy').fill(firstDraft)

  await splitPane(page, 'right')
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  const paneA = page.locator('[data-main-pane="a"]')
  const paneB = page.locator('[data-main-pane="b"]')
  const editorA = paneA.locator('[data-delegation-policy-editor]')
  const editorB = paneB.locator('[data-delegation-policy-editor]')
  await expect(editorA).toBeVisible()
  await expect(editorB).toBeVisible()
  const draftA = editorA.getByLabel('Delegation policy')
  const draftB = editorB.getByLabel('Delegation policy')
  await expect(draftA).toHaveValue(firstDraft)
  await expect(draftB).toHaveValue(firstDraft)
  await draftB.fill(finalDraft)
  await expect(draftA).toHaveValue(finalDraft)

  const bodies: Record<string, unknown>[] = []
  const keys: string[] = []
  let attempts = 0
  await page.route(patchUrl(project.id, delegation.id), async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    await route.continue()
  })
  await editorB.getByRole('button', { name: 'Save policy version', exact: true }).click()
  await expect(editorA).toHaveCount(0)
  await expect(editorB).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  expect(bodies[0]).toEqual({
    expectedRevision: 0,
    policy: finalDraft,
    escalation: ['effectful', 'unreviewed'],
    mode: 'draft',
    expiresAt: null,
  })
  const saved = (await roster(page, project.id)).find((candidate) => candidate.id === delegation.id)
  expect(saved?.revision).toBe(1)
  expect(saved?.policy).toBe(finalDraft)
})
