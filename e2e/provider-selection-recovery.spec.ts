/** A real deleted personal choice remains explicit until its owner selects the
 * sole remaining provider. Only unrelated shared seeds are hidden by the read
 * fixture; preferences, deletion, grants and repairs use their normal routes. */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { DEFAULT_PROVIDER_ID, type ModelProvider, type ViewerModelPreferences, type ScheduledTask, type ScheduleTemplate } from '../contract/index.ts'
import { newUser, openSection } from './social-helpers.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function preference(page: Page): Promise<ViewerModelPreferences> {
  const response = await page.request.get(`${API}/viewer-preferences/model`)
  expect(response.ok(), await response.text()).toBe(true)
  return response.json()
}

async function saveChoice(page: Page, providerId: string) {
  const before = await preference(page)
  const response = await page.request.patch(`${API}/viewer-preferences/model`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      expectedTenantId: before.tenantId, expectedUserId: before.userId,
      expectedRevision: before.revision,
      preferences: { ...before.preferences, providerId, modelId: 'deleted-provider-model' },
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function createProvider(page: Page, label: string): Promise<ModelProvider> {
  const response = await page.request.post(`${API}/providers`, {
    data: {
      label, modelFamily: 'claude', effortLevels: [],
      models: [{ id: 'deleted-provider-model', label: 'Deleted provider model' }],
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const provider = await response.json() as ModelProvider
  expect(provider.models).toContainEqual(expect.objectContaining({ id: 'deleted-provider-model', label: 'Deleted provider model' }))
  return provider
}

async function deleteProvider(page: Page, provider: ModelProvider) {
  const response = await page.request.delete(`${API}/providers/${provider.id}`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      expectedDefinitionRevision: provider.definitionRevision ?? 0,
      expectedConnectionRevision: provider.connectionRevision ?? 0,
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const registry = await (await page.request.get(`${API}/providers`)).json() as ModelProvider[]
  expect(registry.some(row => row.id === provider.id)).toBe(false)
}

async function isolatedRegistry(page: Page, allowed: string[]) {
  const response = await page.request.get(`${API}/providers`)
  expect(response.ok(), await response.text()).toBe(true)
  const rows = await response.json() as ModelProvider[]
  expect(rows.some(row => row.id === DEFAULT_PROVIDER_ID)).toBe(true)
  for (const id of allowed) expect(rows.some(row => row.id === id)).toBe(true)
  await page.route('**/api/v1/providers', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const rows = await response.json() as ModelProvider[]
    const kept = rows.filter(row => row.id === DEFAULT_PROVIDER_ID || allowed.includes(row.id))
    expect(kept.some(row => row.id === DEFAULT_PROVIDER_ID)).toBe(true)
    await route.fulfill({ response, json: kept })
  })
}

async function customizePicker(page: Page) {
  await page.goto('/customize')
  await openSection(page, 'Default model')
  const section = page.locator('section.group\\/section').filter({
    has: page.locator('[data-section-title]', { hasText: /^Default model$/ }),
  })
  await section.locator('button[aria-haspopup="dialog"]').click()
  return page.getByRole('dialog', { name: 'Default model and effort', exact: true })
}

async function inspectRecovery(page: Page, picker: Locator, label: string, defaultLabel: string) {
  // This first assertion also fails against the old implementation without
  // depending on the new data/ARIA review handles.
  const choice = picker.getByRole('button').filter({ hasText: defaultLabel }).first()
  await expect(choice).toBeVisible()
  await expect(choice).toHaveAttribute('data-provider-choice', DEFAULT_PROVIDER_ID)
  await expect(picker.locator('[data-provider-choice]')).toHaveCount(1)
  await expect(choice).toHaveAttribute('aria-pressed', 'false')
  await expect(choice.locator('svg')).toHaveCount(0)
  await expect(picker.getByText(/declares no effort levels/)).toHaveCount(0)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledNarrowRail(page)
    await choice.scrollIntoViewIfNeeded()
    await expect.poll(async () => {
      const box = await picker.boundingBox()
      return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7
        && box.y + box.height <= viewport.height - 7
        && await picker.evaluate(element => element.scrollWidth <= element.clientWidth)
    }, { message: `${label} ${viewport.width}x${viewport.height} bounded recovery picker` }).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await choice.click({ trial: true })
    await settledOpaquePaint(picker)
    await assertWcag22Aa(page, `${label} provider recovery ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/provider-selection-recovery-review/${label}-${viewport.width}x${viewport.height}.png` })
  }
  return choice
}

test('deleted personal provider can be explicitly repaired from Customize and a fresh draft without changing another person', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 10)
  const tenantId = `tenant-provider-recovery-${stamp}`
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': tenantId })
  const other = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': tenantId })
  // Grants address actual registered audiences. This reader never writes
  // preferences; all preference-changing actors use the isolated test tenant.
  const readerTenant = 'tenant-growthworks'
  const reader = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': readerTenant })
  try {
    const removed = await createProvider(owner.page, `Deleted provider ${stamp}`)
    for (const user of [owner, other]) {
      await saveChoice(user.page, removed.id)
      await isolatedRegistry(user.page, [removed.id])
    }
    const ownerBefore = await preference(owner.page)
    const otherBefore = await preference(other.page)
    expect(ownerBefore).toMatchObject({ userId: 'user-ada', tenantId })
    expect(otherBefore).toMatchObject({ userId: 'user-grace', tenantId })
    expect(ownerBefore.userId).not.toBe(otherBefore.userId)
    await isolatedRegistry(reader.page, [])
    const registry = await (await owner.page.request.get(`${API}/providers`)).json() as ModelProvider[]
    const defaultLabel = registry.find(row => row.id === DEFAULT_PROVIDER_ID)!.label
    await deleteProvider(owner.page, removed)
    expect((await preference(owner.page)).preferences.providerId).toBe(removed.id)

    const customize = await customizePicker(owner.page)
    const customizeChoice = await inspectRecovery(owner.page, customize, 'customize', defaultLabel)
    expect((await preference(owner.page)).preferences.providerId).toBe(removed.id)
    await customizeChoice.click()
    await expect.poll(async () => (await preference(owner.page)).preferences.providerId).toBeUndefined()
    expect((await preference(owner.page)).preferences.modelId).toBeUndefined()
    expect(await preference(other.page)).toEqual(otherBefore)
    await owner.page.reload()
    const repaired = await customizePicker(owner.page)
    await expect(repaired.locator('button[data-model-choice][aria-pressed="true"]:has(> span.min-w-0)')).not.toHaveCount(0)
    await expect(repaired.locator('[data-provider-choice]')).toHaveCount(0)
    await expect(repaired.getByText('Choose a provider to see its model choices.', { exact: true })).toHaveCount(0)

    await other.page.goto('/')
    await expect(other.page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    await other.page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const draft = other.page.getByRole('dialog', { name: 'Model and effort', exact: true })
    const draftChoice = await inspectRecovery(other.page, draft, 'draft', defaultLabel)
    expect(await preference(other.page)).toEqual(otherBefore)
    await draftChoice.click()
    await expect.poll(async () => (await preference(other.page)).preferences.providerId).toBeUndefined()
    expect((await preference(other.page)).preferences.modelId).toBeUndefined()
    await other.page.reload()
    await expect(other.page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    await other.page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const reloaded = other.page.getByRole('dialog', { name: 'Model and effort', exact: true })
    await expect(reloaded.locator('[data-model-choice][aria-pressed="true"]')).not.toHaveCount(0)
    await expect(reloaded.locator('[data-provider-choice]')).toHaveCount(0)

    // Shared read-only conversations supply no selection callbacks. A viewer
    // keeps that read-only posture even when the registry has only one provider.
    const created = await owner.page.request.post(`${API}/sessions`, {
      data: { firstMessage: `Read-only provider recovery ${stamp}`, persistFirstMessage: true },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const session = await created.json() as { id: string }
    const hidden = await reader.page.request.get(`${API}/sessions/${session.id}`)
    expect(hidden.status()).toBe(404)
    const readerBefore = await preference(reader.page)
    const grant = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: readerTenant }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBe(true)
    await reader.page.goto(`/s/${session.id}`)
    await expect(reader.page.locator('[data-turn]').filter({ hasText: `Read-only provider recovery ${stamp}` })).toBeVisible()
    await expect(reader.page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
    await reader.page.getByRole('button', { name: 'Model and effort', exact: true }).click()
    const readonly = reader.page.getByRole('dialog', { name: 'Model and effort', exact: true })
    // Effort remains a personal preference even in a read-only conversation;
    // provider/model routing rows alone require the conversation write callback.
    const modelRows = readonly.locator('button[data-model-choice]:has(> span.min-w-0)')
    await expect(modelRows.first()).toBeVisible()
    await expect(readonly.locator('[data-provider-choice]')).toHaveCount(0)
    for (const row of await modelRows.all()) await expect(row).toBeDisabled()
    expect(await preference(reader.page)).toEqual(readerBefore)
  } finally {
    await Promise.allSettled([owner.context.close(), other.context.close(), reader.context.close()])
  }
})

test('Routine endpoint-only picker explicitly repairs a deleted provider while excluding Session providers', async ({ browser }) => {
  test.setTimeout(ms(75_000))
  const stamp = randomUUID().slice(0, 10)
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-routine-provider-recovery-${stamp}` })
  const { page } = owner
  try {
    const removed = await createProvider(page, `Routine removed provider ${stamp}`)
    const relayResponse = await page.request.post(`${API}/providers`, {
      data: { label: `Excluded Session provider ${stamp}`, kind: 'session', modelFamily: 'claude', effortLevels: [] },
    })
    expect(relayResponse.ok(), await relayResponse.text()).toBe(true)
    const relay = await relayResponse.json() as ModelProvider
    await isolatedRegistry(page, [removed.id, relay.id])
    const templatesResponse = await page.request.get(`${API}/schedule-templates`)
    expect(templatesResponse.ok()).toBe(true)
    const [template] = await templatesResponse.json() as ScheduleTemplate[]
    expect(template).toBeTruthy()
    const created = await page.request.post(`${API}/schedules`, {
      data: { seed: { ...template!.seed, name: `Routine provider repair ${stamp}`, enabled: false, providerId: removed.id, modelId: 'deleted-provider-model', runs: [] } },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const routine = await created.json() as ScheduledTask
    expect(routine.providerId).toBe(removed.id)
    await deleteProvider(page, removed)
    await page.goto(`/scheduled/${routine.id}`)
    await openSection(page, 'Agent & model')
    const binding = page.locator('[data-resource-section="Agent & model"]')
    await binding.getByTitle('Change Agent, model & effort').click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    await expect(picker.getByLabel('Routine agent')).not.toHaveValue('')
    const registry = await (await page.request.get(`${API}/providers`)).json() as ModelProvider[]
    const choice = await inspectRecovery(page, picker, 'routine', registry.find(row => row.id === DEFAULT_PROVIDER_ID)!.label)
    await expect(picker.getByText(relay.label, { exact: true })).toHaveCount(0)
    await choice.click()
    await expect(picker.locator('[data-provider-choice]')).toHaveCount(0)
    await expect(picker.locator('button[data-model-choice][aria-pressed="true"]:has(> span.min-w-0)')).not.toHaveCount(0)
    const beforeApply = await (await page.request.get(`${API}/schedules`)).json() as ScheduledTask[]
    expect(beforeApply.find(row => row.id === routine.id)?.providerId).toBe(removed.id)
    await picker.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(picker).toHaveCount(0)
    const afterApply = await (await page.request.get(`${API}/schedules`)).json() as ScheduledTask[]
    expect(afterApply.find(row => row.id === routine.id)).toMatchObject({ providerId: DEFAULT_PROVIDER_ID })
    expect(afterApply.find(row => row.id === routine.id)?.modelId).toBeUndefined()
  } finally {
    await owner.context.close()
  }
})
