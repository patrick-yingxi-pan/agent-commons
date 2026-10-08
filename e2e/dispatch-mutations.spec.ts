/** Rendered acknowledgement, retained form, and lost-response reconciliation
 * for one-off Dispatch creation. */
import { test, expect } from '@playwright/test'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type DispatchBinding,
  type DispatchRun,
  type Identity,
  type ModelProvider,
} from '../contract/index.ts'
import { manualDispatchRunId } from '../server/dispatchIdentity.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

// Model-turn coverage owns its usage partition independently of shard order.
test.use({ extraHTTPHeaders: { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-real-dispatch-e2e' } })

async function readDispatch(page: import('@playwright/test').Page): Promise<DispatchRun[]> {
  const response = await page.request.get('/api/v1/dispatch')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<DispatchRun[]>
}

async function tenantId(page: import('@playwright/test').Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function dispatchBinding(page: import('@playwright/test').Page) {
  const [agentsResponse, providersResponse] = await Promise.all([
    page.request.get('/api/v1/agents'), page.request.get('/api/v1/providers'),
  ])
  expect(agentsResponse.ok()).toBe(true)
  expect(providersResponse.ok()).toBe(true)
  const agents = await agentsResponse.json() as Agent[]
  const providers = await providersResponse.json() as ModelProvider[]
  const provider = providers.find((candidate) => candidate.id === DEFAULT_PROVIDER_ID &&
    candidate.kind !== 'session' && candidate.execution !== 'unconfigured' && (candidate.models?.length ?? 0) > 0)
  const choice = provider && { provider, agent: agents.find((candidate) => candidate.providerId === provider.id) }
  expect(choice?.agent, 'the API fixture exposes a compatible Agent and configured model connection').toBeTruthy()
  return {
    binding: { agentId: choice!.agent!.id, providerId: choice!.provider.id, modelId: choice!.provider.models![0]!.id } satisfies DispatchBinding,
  }
}

async function openDispatchForm(page: import('@playwright/test').Page, title: string, detail: string) {
  const selection = await dispatchBinding(page)
  await page.goto('/dispatch')
  await page.getByRole('button', { name: 'New dispatch', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New dispatch' })
  await dialog.getByRole('textbox', { name: 'Task' }).fill(title)
  await dialog.getByRole('textbox', { name: 'Detail' }).fill(detail)
  await dialog.getByRole("combobox", { name: "Agent", exact: true }).selectOption(selection.binding.agentId)
  await dialog.getByRole("combobox", { name: "Model connection", exact: true }).selectOption(selection.binding.providerId)
  await dialog.getByRole("combobox", { name: "Model", exact: true }).selectOption(selection.binding.modelId)
  return { dialog, ...selection }
}

test('Dispatch retains its form and same logical key until Retry is acknowledged', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const title = `Retryable dispatch ${Date.now().toString(36)}`
  const detail = 'Keep this exact authored task through uncertainty.'
  const unrelatedTitle = `Unrelated dispatch ${Date.now().toString(36)}`
  const keys: string[] = []
  const payloads: unknown[] = []
  let attempts = 0

  await page.route('**/api/v1/dispatch', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    payloads.push(route.request().postDataJSON())
    if (attempts === 1) {
      const unrelated = await page.request.post('/api/v1/dispatch', { data: { title: unrelatedTitle } })
      expect(unrelated.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporary transport failure' }),
      })
      return
    }
    await route.continue()
  })

  const { dialog, binding } = await openDispatchForm(page, title, detail)
  await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()

  const failed = page.locator('[data-dispatch-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the dispatch started')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Task' })).toHaveValue(title)
  await expect(dialog.getByRole('textbox', { name: 'Detail' })).toHaveValue(detail)
  await expect(dialog.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue(binding.agentId)
  await expect(dialog.getByRole("combobox", { name: "Model connection", exact: true })).toHaveValue(binding.providerId)
  await expect(dialog.getByRole("combobox", { name: "Model", exact: true })).toHaveValue(binding.modelId)
  await expect(dialog.getByRole('textbox', { name: 'Task' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
  expect(attempts).toBe(1)

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(payloads[1]).toEqual(payloads[0])
  expect(payloads[0]).toEqual({ title, detail, execution: binding })

  const runs = await readDispatch(page)
  const expectedId = manualDispatchRunId(await tenantId(page), keys[0]!)
  expect(runs.filter((run) => run.id === expectedId)).toHaveLength(1)
  expect(runs.find((run) => run.id === expectedId)?.title).toBe(title)
  expect(runs.find((run) => run.id === expectedId)?.execution).toMatchObject(binding)
  expect(runs.some((run) => run.title === unrelatedTitle)).toBe(true)
  await waitForTerminalDispatch(page, expectedId)
})

test('a committed Dispatch with a lost response reconciles and closes without duplication', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const title = `Lost Dispatch acknowledgement ${Date.now().toString(36)}`
  const keys: string[] = []
  const payloads: unknown[] = []
  let attempts = 0

  await page.route('**/api/v1/dispatch', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    payloads.push(route.request().postDataJSON())
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'acknowledgement lost after commit' }),
    })
  })

  const { dialog, binding } = await openDispatchForm(page, title, 'Reconcile exact server truth.')
  await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-dispatch-creation]')).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  expect(payloads[0]).toEqual({ title, detail: 'Reconcile exact server truth.', execution: binding })
  const expectedId = manualDispatchRunId(await tenantId(page), keys[0]!)
  await expect.poll(async () => (await readDispatch(page)).filter((run) => run.id === expectedId).length).toBe(1)
  expect((await readDispatch(page)).find((run) => run.id === expectedId)?.execution).toMatchObject(binding)
  await waitForTerminalDispatch(page, expectedId)
})

test('a real Dispatch opens its private conversation and remains an ordinary continuable Session', async ({ page, browser }) => {
  test.setTimeout(ms(60_000))
  const title = `Private Dispatch conversation ${Date.now().toString(36)}`
  const detail = 'Review the exact authored instructions and summarize the outcome.'
  const { dialog, binding } = await openDispatchForm(page, title, detail)
  const prompt = `${title}\n\n${detail}`
  await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await expect.poll(async () => {
    const candidate = (await readDispatch(page)).find((entry) => entry.title === title && entry.execution)
    return candidate?.execution?.state
  }, 'the configured fixture model replies in the private Session').toBe('replied')
  const savedRun = (await readDispatch(page)).find((entry) => entry.title === title && entry.execution)!
  expect(savedRun.execution).toMatchObject(binding)

  await page.goto('/dispatch')
  const row = page.locator('[data-resource-synopsis-row]')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
  await row.getByRole('button', { name: title, exact: true }).click()
  await expect(page.locator('[data-session-title-bar]')).toContainText(title)
  const sessionId = savedRun.execution!.sessionId
  const sessionPath = `/api/v1/sessions/${encodeURIComponent(sessionId)}`
  const sessionResponse = await page.request.get(sessionPath)
  expect(sessionResponse.ok()).toBe(true)
  const session = await sessionResponse.json() as { messages: Array<{ role: string; content: string }> }
  expect(session.messages[0]).toMatchObject({ role: 'user', content: prompt })
  expect(session.messages.some((message) => message.role === 'assistant')).toBe(true)

  const continuation = 'Continue from the saved Dispatch result and note the next step.'
  const composer = page.locator('[data-conversation-pane]').last().locator('textarea')
  await composer.fill(continuation)
  await composer.press('Enter')
  await expect(page.locator('[data-turn]').filter({ hasText: continuation })).toBeVisible()
  await expect.poll(async () => {
    const response = await page.request.get(sessionPath)
    const current = await response.json() as { messages: Array<{ role: string; content: string }> }
    return current.messages.some((message) => message.role === 'user' && message.content === continuation) &&
      current.messages.at(-1)?.role === 'assistant'
  }, 'ordinary conversation continuation appends a new user and assistant turn').toBe(true)

  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    for (const guest of [grace, maya]) {
      await guest.page.goto('/dispatch')
      await expect(guest.page.getByRole('heading', { level: 1, name: 'Dispatch' })).toBeVisible()
      const privateRow = guest.page.locator('[data-resource-synopsis-row]')
        .filter({ has: guest.page.getByRole('button', { name: title, exact: true }) })
      await expect(privateRow).toHaveCount(0)

      const privatePath = `/s/${encodeURIComponent(sessionId)}`
      const hiddenRead = guest.page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v1/sessions/${encodeURIComponent(sessionId)}` &&
        response.request().method() === 'GET')
      await guest.page.goto(privatePath)
      expect((await hiddenRead).status()).toBe(404)
      // An unreadable conversation is pruned from the pane tree; the last
      // readable location remains, without exposing the hidden subject's title.
      await expect(guest.page).toHaveURL(/\/dispatch$/)
      await expect(guest.page.getByRole('heading', { level: 1, name: 'Dispatch' })).toBeVisible()
      await expect(guest.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
      await expect(guest.page.getByText(prompt, { exact: true })).toHaveCount(0)
    }
  } finally {
    await Promise.allSettled([grace.context.close(), maya.context.close()])
  }
})

async function waitForTerminalDispatch(page: import('@playwright/test').Page, id: string): Promise<void> {
  await expect.poll(async () => {
    const run = (await readDispatch(page)).find((candidate) => candidate.id === id)
    return run?.execution?.state
  }, { timeout: ms(20_000) }, 'the real Dispatch turn releases its Agent capacity').toMatch(/^(replied|failed|interrupted|cancelled)$/)
}
