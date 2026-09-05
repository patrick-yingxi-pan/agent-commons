/** Rendered acknowledgement recovery for handing Project judgment to an Agent. */
import { test, expect, type Page } from '@playwright/test'
import { DEFAULT_PROVIDER_ID, type Agent, type CreateProjectResponse, type Delegation, type Identity, type Project } from '../contract/index.ts'
import { delegationCreationId } from '../server/delegationCreationIdentity.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function createProject(page: Page, name: string): Promise<Project> {
  const response = await page.request.post('/api/v1/projects', {
    data: { name, description: 'A test-owned Project for Delegation recovery.' },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as CreateProjectResponse).project
}

async function createAgent(page: Page, label: string): Promise<Agent> {
  const response = await page.request.post('/api/v1/agents', {
    data: { label, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Agent>
}

async function openDelegationForm(page: Page, project: Project, agent: Agent) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Delegation\b/ })
  await section.click()
  const trigger = main.getByRole('button', { name: 'Delegate judgment', exact: true })
  await trigger.click()
  const form = main.locator('[data-delegation-creation-form]')
  await form.getByLabel('Delegate agent').selectOption(agent.id)
  return { main, section, trigger, form }
}

async function roster(page: Page, projectId: string): Promise<Delegation[]> {
  const response = await page.request.get(`/api/v1/projects/${encodeURIComponent(projectId)}/delegations`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Delegation[]>
}

async function createDelegation(page: Page, project: Project, agent: Agent): Promise<Delegation> {
  const response = await page.request.post(`/api/v1/projects/${encodeURIComponent(project.id)}/delegations`, {
    data: {
      agentId: agent.id,
      actKind: 'approve-envelope',
      policy: 'Recommend approval only for reviewed monotonic work.',
      mode: 'draft',
    },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Delegation>
}

async function openDelegationRoster(page: Page, project: Project) {
  await page.goto(`/projects/${encodeURIComponent(project.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: project.name, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  await main.getByRole('button', { name: /^Delegation\b/ }).click()
  return main
}

test('Delegation intent stays visible and Retry preserves one authority grant', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Held Delegation ${stamp}`)
  const agent = await createAgent(page, `Policy Agent ${stamp}`)
  const policy = 'Recommend approval only after an adversarial review.'
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(`**/api/v1/projects/${project.id}/delegations`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  const { main, section, trigger, form } = await openDelegationForm(page, project, agent)
  await form.getByLabel('Delegated act').selectOption('approve-envelope')
  await form.getByLabel('Autonomy rung').selectOption('draft')
  await form.getByLabel('Delegation policy').fill(policy)
  await form.getByRole('checkbox', { name: 'No adversarial review' }).click()
  await form.getByRole('button', { name: 'Delegate', exact: true }).click()

  const failed = page.locator('[data-delegation-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this Delegation was established')
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Delegate agent')).toBeDisabled()
  await expect(form.getByLabel('Delegated act')).toBeDisabled()
  await expect(form.getByLabel('Autonomy rung')).toBeDisabled()
  await expect(form.getByLabel('Delegation policy')).toBeDisabled()
  await expect(form.getByLabel('Delegation policy')).toHaveValue(policy)
  await expect(form.getByRole('checkbox', { name: 'No adversarial review' })).toBeDisabled()
  await expect(trigger).toBeDisabled()
  await expect(section).toHaveAttribute('aria-disabled', 'true')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(main.getByText(`${agent.label} · approves envelopes`, { exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toMatchObject({
    agentId: agent.id,
    actKind: 'approve-envelope',
    mode: 'draft',
    policy,
    escalation: ['unreviewed'],
  })
  const expectedId = delegationCreationId(await tenantId(page), project.id, keys[0]!)
  expect((await roster(page, project.id)).filter((delegation) => delegation.id === expectedId)).toHaveLength(1)
})

test('a committed Delegation with a lost response keeps its form until exact reconciliation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Recovered Delegation ${stamp}`)
  const agent = await createAgent(page, `Recovery Agent ${stamp}`)
  const policy = 'Land only reviewed work with a complete changeset.'
  const keys: string[] = []
  let attempts = 0
  let releaseReads!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve })
  await page.route(`**/api/v1/projects/${project.id}/delegations`, async (route) => {
    if (route.request().method() === 'POST') {
      attempts += 1
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (attempts > 0 && route.request().method() === 'GET') {
      markReadStarted()
      await readsReleased
    }
    await route.continue()
  })

  const { main, form } = await openDelegationForm(page, project, agent)
  await form.getByLabel('Delegated act').selectOption('land')
  await form.getByLabel('Autonomy rung').selectOption('decide')
  await form.getByLabel('Delegation policy').fill(policy)
  await form.getByRole('button', { name: 'Delegate', exact: true }).click()
  await readStarted
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.getByLabel('Delegation policy')).toHaveValue(policy)

  releaseReads()
  await expect(form).toHaveCount(0)
  await expect(main.getByText(`${agent.label} · lands`, { exact: true })).toBeVisible()
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = delegationCreationId(await tenantId(page), project.id, keys[0]!)
  const stored = await roster(page, project.id)
  expect(stored.filter((delegation) => delegation.id === expectedId)).toHaveLength(1)
  expect(stored.find((delegation) => delegation.id === expectedId)?.policy).toBe(policy)
  await expect(page.locator('[data-delegation-creation="failed"]')).toHaveCount(0)
})

test('one-tap Delegation revocation holds the exact row and retries with one key', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Held Revocation ${stamp}`)
  const agent = await createAgent(page, `Revocation Agent ${stamp}`)
  const delegation = await createDelegation(page, project, agent)
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(`**/api/v1/projects/${project.id}/delegations/${delegation.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  const main = await openDelegationRoster(page, project)
  const row = main.locator(`[data-delegation-id="${delegation.id}"]`)
  await row.getByRole('button', { name: `Revoke ${agent.label}'s delegation`, exact: true }).click()

  const failed = page.locator('[data-delegation-revocation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm revocation')
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByRole('button', { name: `Revoking ${agent.label}'s delegation`, exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(bodies[0]).toEqual({ expectedCreatedAt: delegation.createdAt })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  expect((await roster(page, project.id)).some((candidate) => candidate.id === delegation.id)).toBe(false)
})

test('a committed revocation remains visible until exact absence reconciles', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const project = await createProject(page, `Recovered Revocation ${stamp}`)
  const agent = await createAgent(page, `Revocation Recovery ${stamp}`)
  const delegation = await createDelegation(page, project, agent)
  let attempts = 0
  let releaseReads!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve })
  await page.route(`**/api/v1/projects/${project.id}/delegations/${delegation.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
    })
  })
  await page.route(`**/api/v1/projects/${project.id}/delegations`, async (route) => {
    if (attempts > 0 && route.request().method() === 'GET') {
      markReadStarted()
      await readsReleased
    }
    await route.continue()
  })

  const main = await openDelegationRoster(page, project)
  const row = main.locator(`[data-delegation-id="${delegation.id}"]`)
  await row.getByRole('button', { name: `Revoke ${agent.label}'s delegation`, exact: true }).click()
  await readStarted

  await expect(row).toHaveAttribute('data-delegation-revocation', 'true')
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('[data-delegation-revocation="pending"]')).toBeVisible()
  expect((await roster(page, project.id)).some((candidate) => candidate.id === delegation.id)).toBe(false)

  releaseReads()
  await expect(row).toHaveCount(0)
  await expect(page.locator('[data-delegation-revocation]')).toHaveCount(0)
  expect(attempts).toBe(1)
})
