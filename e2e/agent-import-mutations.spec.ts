/** Rendered acknowledgement recovery for importing a remote Agent Card. */
import { test, expect, type Page } from '@playwright/test'
import type { Agent, Identity } from '../contract/index.ts'
import { agentImportCreationId } from '../server/agentCreationIdentity.ts'
import { agentBindings } from './agent-bindings.ts'
import { ms } from './budget.ts'

async function publishedCard(page: Page, label: string): Promise<{ source: Agent; cardUrl: string }> {
  const created = await page.request.post('/api/v1/agents', {
    data: { label, ...(await agentBindings(page)), tools: [], instructions: 'Remote definition.' },
  })
  expect(created.ok()).toBe(true)
  const source = await created.json() as Agent
  const published = await page.request.patch(`/api/v1/agents/${source.id}`, {
    data: { published: true, expectedRevision: source.revision },
  })
  expect(published.ok()).toBe(true)
  return {
    source: await published.json() as Agent,
    cardUrl: new URL(`/api/v1/a2a/agents/${encodeURIComponent(source.id)}/card`, published.url()).toString(),
  }
}

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function openImport(page: Page, cardUrl: string) {
  await page.goto('/agents/discover')
  const field = page.getByLabel('Agent Card URL')
  await expect(field).toBeVisible({ timeout: ms(20_000) })
  await field.fill(cardUrl)
  return {
    field,
    action: page.getByRole('button', { name: 'Import', exact: true }),
  }
}

async function agent(page: Page, id: string): Promise<Agent> {
  const response = await page.request.get(`/api/v1/agents/${id}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Agent>
}

test('failed Agent Card import retains its URL and Retry creates one exact private Agent', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const { source, cardUrl } = await publishedCard(page, `Held import source ${Date.now().toString(36)}`)
  const keys: string[] = []
  let fail = true
  await page.route('**/api/v1/agents/import-card', async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary import outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const { field, action } = await openImport(page, cardUrl)
  await action.evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-agent-import="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the Agent Card was imported')
  await expect(field).toHaveValue(cardUrl)
  await expect(field).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Importing…', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  const expectedId = agentImportCreationId(await tenantId(page), keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/agents/${expectedId}$`), { timeout: ms(20_000) })
  expect(keys).toHaveLength(2)
  expect(new Set(keys)).toEqual(new Set([keys[0]!]))
  const imported = await agent(page, expectedId)
  expect(imported.importedFrom).toEqual({ url: cardUrl, name: source.label })
  expect(imported.providerId).toBeUndefined()
  expect(imported.authority).toBeUndefined()
  expect(imported.budget).toBeUndefined()
  expect(imported.published).not.toBe(true)
  const rows = await (await page.request.get('/api/v1/agents')).json() as Agent[]
  expect(rows.filter((row) => row.id === expectedId)).toHaveLength(1)
})

test('a lost Agent Card import acknowledgement reconciles without another POST or fetch intent', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const { source, cardUrl } = await publishedCard(page, `Recovered import source ${Date.now().toString(36)}`)
  const keys: string[] = []
  await page.route('**/api/v1/agents/import-card', async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Import acknowledgement lost.' } }),
    })
  })

  const { action } = await openImport(page, cardUrl)
  await action.click()
  await expect.poll(() => keys.length).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = agentImportCreationId(await tenantId(page), keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/agents/${expectedId}$`), { timeout: ms(20_000) })
  expect(keys).toHaveLength(1)
  expect((await agent(page, expectedId)).importedFrom).toEqual({ url: cardUrl, name: source.label })
  await expect(page.locator('[data-agent-import]')).toHaveCount(0)
})
