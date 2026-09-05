/** Rendered acknowledgement recovery for exercising delegated judgment. */
import { test, expect, type Page } from '@playwright/test'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type Contribution,
  type CreateProjectResponse,
  type Delegation,
  type Identity,
  type Project,
} from '../contract/index.ts'
import { delegatedJudgmentId } from '../server/delegatedJudgmentIdentity.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

interface Arena {
  project: Project
  contribution: Contribution
  delegation: Delegation
  tenantId: string
}

async function arena(page: Page, stamp: string, actKind: 'land' | 'approve-envelope', mode: 'draft' | 'decide'): Promise<Arena> {
  const meResponse = await page.request.get('/api/v1/me')
  expect(meResponse.ok()).toBe(true)
  const tenantId = ((await meResponse.json()) as Identity).tenant.id
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Delegated judgment recovery ${stamp}`, description: 'A test-owned exact-judgment Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const agentResponse = await page.request.post('/api/v1/agents', {
    data: { label: `Judgment Agent ${stamp}`, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID },
  })
  expect(agentResponse.ok()).toBe(true)
  const agent = await agentResponse.json() as Agent
  const delegationResponse = await page.request.post(`/api/v1/projects/${project.id}/delegations`, {
    data: {
      agentId: agent.id,
      actKind,
      policy: 'Handle this exact routine judgment.',
      mode,
    },
  })
  expect(delegationResponse.ok()).toBe(true)
  const delegation = await delegationResponse.json() as Delegation
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Ask exactly once ${stamp}`, summary: 'The visible Contribution is the judgment surface.' },
  })
  expect(contributionResponse.ok()).toBe(true)
  let contribution = await contributionResponse.json() as Contribution
  if (actKind === 'approve-envelope') {
    const envelopeResponse = await page.request.post(
      `/api/v1/projects/${project.id}/contributions/${contribution.id}/envelope`,
      { data: { lines: [{ type: 'connector.read', target: 'linear:delegated' }] } },
    )
    expect(envelopeResponse.ok()).toBe(true)
    contribution = await envelopeResponse.json() as Contribution
  }
  return { project, contribution, delegation, tenantId }
}

async function openContribution(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true }))
    .toBeVisible({ timeout: ms(20_000) })
  return main
}

async function currentContribution(page: Page, context: Arena): Promise<Contribution> {
  const response = await page.request.get(`/api/v1/projects/${context.project.id}/contributions`)
  expect(response.ok()).toBe(true)
  const rows = await response.json() as Contribution[]
  return rows.find((candidate) => candidate.id === context.contribution.id)!
}

test('a failed Ask holds its exact delegate through navigation and Retry records one draft', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const context = await arena(page, Date.now().toString(36), 'land', 'draft')
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/delegated/${context.delegation.id}`
  const keys: string[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated judgment outage.' } }),
      })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  const ask = main.getByRole('button', { name: `Ask ${context.delegation.agentLabel}`, exact: true })
  await ask.evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-delegated-judgment="failed"]')
  await expect(failed).toContainText('Couldn’t confirm what the delegate decided')
  await expect(main.getByRole('button', { name: `Asking ${context.delegation.agentLabel}…`, exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Require review', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('button', { name: `Asking ${context.delegation.agentLabel}…`, exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-delegated-judgment]')).toHaveCount(0)
  await expect(main).toContainText('policy satisfied (mock) — would land')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const expectedId = delegatedJudgmentId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    context.delegation.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
  expect(contribution.events.find((event) => event.id === expectedId)?.kind).toBe('delegated-draft')
})

test('a lost delegated approval response reconciles one receipt after revocation and later history', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const context = await arena(page, `${Date.now().toString(36)}-lost`, 'approve-envelope', 'decide')
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().url().endsWith(`/delegated/${context.delegation.id}`)
    ) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = true
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
      })
      return
    }
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: `Ask ${context.delegation.agentLabel}`, exact: true }).click()
  const failed = page.locator('[data-delegated-judgment="failed"]')
  await expect(failed).toContainText('Couldn’t confirm what the delegate decided')
  await expect(main.getByRole('button', { name: `Asking ${context.delegation.agentLabel}…`, exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)

  const revoke = await page.request.delete(
    `/api/v1/projects/${context.project.id}/delegations/${context.delegation.id}`,
  )
  expect(revoke.ok()).toBe(true)
  const aftermath = 'History after the delegated approval response was lost.'
  const note = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`,
    { data: { body: aftermath } },
  )
  expect(note.ok()).toBe(true)
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('[data-delegated-judgment]')).toHaveCount(0)
  await expect(main).toContainText(aftermath)
  await expect(main).toContainText('Approved by')
  expect(keys).toHaveLength(1)

  const expectedId = delegatedJudgmentId(
    context.tenantId,
    context.project.id,
    context.contribution.id,
    context.delegation.id,
    keys[0]!,
  )
  const contribution = await currentContribution(page, context)
  expect(contribution.envelope?.status).toBe('approved')
  expect(contribution.events.filter((event) => event.id === expectedId)).toHaveLength(1)
  expect(contribution.events.filter((event) => event.kind === 'envelope-approved')).toHaveLength(1)
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
})
