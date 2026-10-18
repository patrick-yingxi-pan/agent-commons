/** Ordinary sparse edits must remain saveable when untouched budgets inherit
 * omitted parent windows. No budget editor, model call or credential is added. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { Agent, Budget, Commission, ModelProvider, SystemPromptEntry } from '../contract/index.ts'
import type { UsageSnapshot } from '../contract/usage.ts'
import { newUser, openSection } from './social-helpers.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const FIVE_HOUR = '5-hour limit'
const WEEKLY = 'Weekly · all models'
const VIEWPORTS = [{ width: 320, height: 700 }, { width: 1280, height: 800 }] as const
const sparse = (label: string, ceiling: number): Budget => ({ windows: [{ label, ceiling }] })
const full = (fiveHour: number, weekly: number): Budget => ({ windows: [
  { label: FIVE_HOUR, ceiling: fiveHour }, { label: WEEKLY, ceiling: weekly },
] })

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`)
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(`${API}${path}`, { data })
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

async function fixture(browser: Browser, kind: string, budget: Budget) {
  const stamp = randomUUID().slice(0, 10)
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-budget-editors-${kind}-${stamp}` })
  const { page } = owner
  // No endpoint/credential config means registration does not probe any model.
  const provider = await post<ModelProvider>(page, '/providers', {
    label: `Sparse parent ${kind} ${stamp}`, modelFamily: 'claude', effortLevels: [], plan: full(1_000, 10_000),
  })
  const prompt = await post<SystemPromptEntry>(page, '/system-prompts', {
    label: `Sparse prompt ${kind} ${stamp}`, targetFamily: 'claude', body: 'Keep the existing budget configuration.',
  })
  const agent = await post<Agent>(page, '/agents', {
    label: `Sparse ${kind} Agent ${stamp}`, providerId: provider.id, systemPromptId: prompt.id,
    instructions: 'No model work is requested by this configuration edit.', tools: [], budget,
  })
  expect(agent.budget).toEqual(budget)
  const modelDoors: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && (
      /\/sessions\/[^/]+\/(messages|compact)$/.test(path)
      || /\/schedules\/[^/]+\/run$/.test(path)
      || /\/system-prompts\/[^/]+\/probe$/.test(path)
      || path === `${API}/dispatch`
    )) modelDoors.push(path)
  })
  return { ...owner, provider, agent, modelDoors }
}

async function inspectEditor(page: Page, info: TestInfo, dialog: Locator, label: string) {
  const panel = dialog.locator('[data-bounded-dialog="resource-form"]')
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledNarrowRail(page)
    await expect(save).toBeEnabled()
    await expect(save).toBeInViewport()
    await settledOpaquePaint(panel)
    await expect.poll(async () => {
      const box = await panel.boundingBox()
      return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7
        && box.y + box.height <= viewport.height - 7
        && await panel.evaluate(element => element.scrollWidth <= element.clientWidth)
    }).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await save.click({ trial: true })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
  }
}

async function noModelWork(page: Page, doors: string[]) {
  expect(doors, 'ordinary configuration edits never enter a model execution/probe door').toEqual([])
  const usage = await read<UsageSnapshot>(page, '/usage')
  expect(usage.limits.every(window => window.usedTokens === 0), 'configuration edits spend no tokens').toBe(true)
}

test('ordinary Agent rename saves its untouched sparse weekly cap after provider windows become partial', async ({ browser }, info) => {
  test.setTimeout(ms(75_000))
  const weeklyBudget = sparse(WEEKLY, 5_000)
  const f = await fixture(browser, 'rename', weeklyBudget)
  const { page } = f
  try {
    const parent = await page.request.patch(`${API}/providers/${f.provider.id}`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { expectedRevision: f.provider.definitionRevision ?? 0, plan: sparse(FIVE_HOUR, 1_000) },
    })
    expect(parent.ok(), await parent.text()).toBe(true)
    const before = await read<Agent>(page, `/agents/${f.agent.id}`)
    expect(before.budget).toEqual(weeklyBudget)
    expect(before.revision).toBe(f.agent.revision)
    await page.goto(`/agents/${f.agent.id}`)
    await expect(page.getByRole('heading', { name: f.agent.label, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit agent', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit agent', exact: true })
    const renamed = `${f.agent.label} renamed`
    await dialog.getByLabel('Name', { exact: true }).fill(renamed)
    await inspectEditor(page, info, dialog, 'sparse-agent-rename')
    const submitted = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `${API}/agents/${f.agent.id}`)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await submitted
    expect(response.status(), 'a rename revalidates the untouched weekly cap against the inherited account window').toBe(200)
    expect(response.request().postDataJSON()).toEqual({ label: renamed, expectedRevision: before.revision ?? 0 })
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible()
    const saved = await read<Agent>(page, `/agents/${f.agent.id}`)
    expect(saved).toMatchObject({ label: renamed, budget: weeklyBudget, revision: (before.revision ?? 0) + 1 })
    expect(saved.budget?.windows).toHaveLength(1)
    expect((await read<ModelProvider>(page, `/providers/${f.provider.id}`)).plan).toEqual(sparse(FIVE_HOUR, 1_000))
    await page.reload()
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible()
    expect((await read<Agent>(page, `/agents/${f.agent.id}`)).budget).toEqual(weeklyBudget)
    await noModelWork(page, f.modelDoors)
  } finally {
    await f.context.close()
  }
})

test('ordinary contributor role edit preserves its weekly grant after its Agent budget becomes partial', async ({ browser }, info) => {
  test.setTimeout(ms(75_000))
  const f = await fixture(browser, 'contributor', full(500, 10_000))
  const { page } = f
  try {
    const { project } = await post<{ project: { id: string; name: string } }>(page, '/projects', {
      name: `Sparse contributor Project ${randomUUID().slice(0, 10)}`,
    })
    const weeklyGrant = sparse(WEEKLY, 5_000)
    const contributor = await post<Commission>(page, '/commissions', {
      agentId: f.agent.id, projectId: project.id, role: 'writer', grant: weeklyGrant, standing: false,
    })
    const narrowed = await page.request.patch(`${API}/agents/${f.agent.id}`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { expectedRevision: f.agent.revision ?? 0, budget: sparse(FIVE_HOUR, 500) },
    })
    expect(narrowed.ok(), await narrowed.text()).toBe(true)
    const before = await read<Commission>(page, `/commissions/${contributor.id}`)
    expect(before.grant).toEqual(weeklyGrant)
    expect(before.configurationRevision).toBe(contributor.configurationRevision)
    await page.goto(`/projects/${project.id}`)
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible()
    await openSection(page, 'Contributors')
    const row = page.locator(`[data-contributor-row="${contributor.id}"]`)
    await expect(row).toContainText(f.agent.label)
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit contributor', exact: true })
    await expect(dialog.getByLabel('Project role')).toHaveValue('writer')
    await dialog.getByLabel('Project role').selectOption('reader')
    await inspectEditor(page, info, dialog, 'sparse-contributor-role')
    const submitted = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `${API}/commissions/${contributor.id}`)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await submitted
    expect(response.status(), 'a role-only edit revalidates the unchanged grant against the inherited provider weekly cap').toBe(200)
    expect(response.request().postDataJSON()).toEqual({ role: 'reader', expectedRevision: before.configurationRevision ?? 0 })
    await expect(dialog).toHaveCount(0)
    await expect(row.getByText('reader', { exact: true })).toBeVisible()
    const saved = await read<Commission>(page, `/commissions/${contributor.id}`)
    expect(saved).toMatchObject({ role: 'reader', grant: weeklyGrant,
      configurationRevision: (before.configurationRevision ?? 0) + 1 })
    expect(saved.grant?.windows).toHaveLength(1)
    expect((await read<Agent>(page, `/agents/${f.agent.id}`)).budget).toEqual(sparse(FIVE_HOUR, 500))
    await page.reload()
    await openSection(page, 'Contributors')
    await expect(row.getByText('reader', { exact: true })).toBeVisible()
    expect((await read<Commission>(page, `/commissions/${contributor.id}`)).grant).toEqual(weeklyGrant)
    await noModelWork(page, f.modelDoors)
  } finally {
    await f.context.close()
  }
})
