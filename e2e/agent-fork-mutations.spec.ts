/** Rendered acknowledgement recovery for copying a published Agent definition. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Agent, AgentDirectoryEntry, Identity } from '../contract/index.ts'
import { agentForkCreationId } from '../server/agentCreationIdentity.ts'
import { agentBindings } from './agent-bindings.ts'
import { ms } from './budget.ts'

const FORKER_TENANT = 'tenant-beta'

async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  return { context, page: await context.newPage() }
}

async function publishedSource(page: Page, label: string): Promise<Agent> {
  const created = await page.request.post('/api/v1/agents', {
    data: { label, ...(await agentBindings(page)), tools: [], instructions: 'Keep the useful shape.' },
  })
  expect(created.ok()).toBe(true)
  const source = await created.json() as Agent
  const published = await page.request.patch(`/api/v1/agents/${source.id}`, {
    data: { published: true, expectedRevision: source.revision },
  })
  expect(published.ok()).toBe(true)
  return published.json() as Promise<Agent>
}

async function openSource(page: Page, sourceId: string) {
  await page.goto(`/agents/${encodeURIComponent(sourceId)}`)
  const action = page.getByRole('button', { name: 'Fork agent', exact: true })
  await expect(action).toBeVisible({ timeout: ms(20_000) })
  return action
}

async function agent(page: Page, id: string): Promise<Agent> {
  const response = await page.request.get(`/api/v1/agents/${id}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Agent>
}

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function sourceForks(page: Page, id: string): Promise<number> {
  const response = await page.request.get('/api/v1/directory/agents')
  expect(response.ok()).toBe(true)
  const rows = await response.json() as AgentDirectoryEntry[]
  return rows.find((row) => row.id === id)?.forks ?? -1
}

test('failed Agent fork stays held and Retry preserves one exact private copy', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const forker = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': FORKER_TENANT })
  const source = await publishedSource(owner.page, `Held fork source ${Date.now().toString(36)}`)
  const keys: string[] = []
  let fail = true
  await forker.page.route(`**/api/v1/agents/${source.id}/fork`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary fork outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const action = await openSource(forker.page, source.id)
  await action.evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = forker.page.locator('[data-agent-fork="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the Agent was forked')
  await expect(forker.page.getByRole('button', { name: 'Forking…', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  const forkerTenant = await tenantId(forker.page)
  const expectedId = agentForkCreationId(forkerTenant, keys[0]!)
  await expect(forker.page).toHaveURL(new RegExp(`/agents/${expectedId}$`), { timeout: ms(20_000) })
  expect(keys).toHaveLength(2)
  expect(new Set(keys)).toEqual(new Set([keys[0]!]))
  const fork = await agent(forker.page, expectedId)
  expect(fork.forkedFrom?.agentId).toBe(source.id)
  expect(fork.tenantId).toBe(forkerTenant)
  expect(fork.published).not.toBe(true)
  const rows = await (await forker.page.request.get('/api/v1/agents')).json() as Agent[]
  expect(rows.filter((row) => row.id === expectedId)).toHaveLength(1)
  expect(await sourceForks(forker.page, source.id)).toBe(1)

  await owner.context.close()
  await forker.context.close()
})

test('a lost Agent-fork acknowledgement reconciles and opens the durable copy', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const forker = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': FORKER_TENANT })
  const source = await publishedSource(owner.page, `Recovered fork source ${Date.now().toString(36)}`)
  const keys: string[] = []
  await forker.page.route(`**/api/v1/agents/${source.id}/fork`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Fork acknowledgement lost.' } }),
    })
  })

  const action = await openSource(forker.page, source.id)
  await action.click()
  await expect.poll(() => keys.length).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = agentForkCreationId(await tenantId(forker.page), keys[0]!)
  await expect(forker.page).toHaveURL(new RegExp(`/agents/${expectedId}$`), { timeout: ms(20_000) })
  expect(keys).toHaveLength(1)
  expect((await agent(forker.page, expectedId)).forkedFrom?.agentId).toBe(source.id)
  expect(await sourceForks(forker.page, source.id)).toBe(1)
  await expect(forker.page.locator('[data-agent-fork]')).toHaveCount(0)

  await owner.context.close()
  await forker.context.close()
})
