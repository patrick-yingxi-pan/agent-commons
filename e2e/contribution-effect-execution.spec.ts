/** Rendered acknowledgement recovery for approved Contribution effects. */
import { test, expect, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Project } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena { project: Project; contribution: Contribution; lineId: string }

async function arena(page: Page, stamp: string): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Effect recovery ${stamp}`, description: 'A test-owned approved effect Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Run exactly once ${stamp}`, summary: 'The approved envelope row is the substantive act surface.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  const contribution = await contributionResponse.json() as Contribution
  const changeset = await page.request.post(`/api/v1/projects/${project.id}/contributions/${contribution.id}/changeset`, {
    data: { entries: [{ kind: 'note', target: 'effect receipt', before: 'Pending', after: 'Recorded' }] },
  })
  expect(changeset.ok()).toBe(true)
  const envelope = await page.request.post(`/api/v1/projects/${project.id}/contributions/${contribution.id}/envelope`, {
    data: { lines: [{ type: 'connector.write', target: 'release channel', cardinality: 2, harness: 'draft-escrow' }] },
  })
  expect(envelope.ok()).toBe(true)
  const approved = await page.request.post(`/api/v1/projects/${project.id}/contributions/${contribution.id}/envelope/approve`)
  expect(approved.ok()).toBe(true)
  const approvedContribution = await approved.json() as Contribution
  return { project, contribution: approvedContribution, lineId: approvedContribution.envelope!.lines[0].id }
}

async function openContribution(page: Page, context: Arena) {
  await page.goto(`/projects/${encodeURIComponent(context.project.id)}/changes/${encodeURIComponent(context.contribution.id)}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible({ timeout: ms(20_000) })
  return main
}

async function currentContribution(page: Page, context: Arena): Promise<Contribution> {
  const response = await page.request.get(`/api/v1/projects/${context.project.id}/contributions`)
  expect(response.ok()).toBe(true)
  const contributions = await response.json() as Contribution[]
  return contributions.find((contribution) => contribution.id === context.contribution.id)!
}

test('approved effect stays held across navigation and Retry reuses one logical receipt', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/effects`
  const keys: string[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated effect outage.' } }) })
      return
    }
    await route.continue()
  })

  let main = await openContribution(page, context)
  await expect(main.getByRole('button', { name: 'Revise', exact: true })).toBeEnabled()
  await expect(main.getByRole('button', { name: 'Amend', exact: true })).toBeEnabled()
  await main.getByRole('button', { name: 'Run', exact: true }).click()
  const failed = page.locator('[data-contribution-effect="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this approved effect ran')
  await expect(main.getByRole('button', { name: 'Running…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Revise', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Amend', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.getByRole('heading', { name: context.contribution.title, exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Running…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-effect]')).toHaveCount(0)
  await expect(main.getByText('1/2 used', { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const contribution = await currentContribution(page, context)
  expect(contribution.events.filter((event) => event.kind === 'effect-executed' && event.lineId === context.lineId)).toHaveLength(1)
})

test('a lost effect response survives stale reconciliation and replays without consuming twice', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp)
  const staleLedger = [context.contribution]
  const keys: string[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.contribution.id}/effects`)) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      if (!committed) {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        committed = true
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }) })
        return
      }
      await route.continue()
      return
    }
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Run', exact: true }).click()
  const failed = page.locator('[data-contribution-effect="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this approved effect ran')
  allowFreshReads = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-effect]')).toHaveCount(0)
  await expect(main.getByText('1/2 used', { exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const contribution = await currentContribution(page, context)
  expect(contribution.envelope!.lines[0].used).toBe(1)
  expect(contribution.events.filter((event) => event.kind === 'effect-executed' && event.lineId === context.lineId)).toHaveLength(1)
})
