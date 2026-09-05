/** Rendered recovery and full-envelope authoring for effect proposals. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { Contribution, CreateProjectResponse, Project, ProposeEnvelopeRequest } from '../contract/index.ts'
import { ms } from './budget.ts'

interface Arena { project: Project; contribution: Contribution }

async function arena(
  page: Page,
  stamp: string,
  initialLines?: ProposeEnvelopeRequest['lines'],
): Promise<Arena> {
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: `Envelope proposal recovery ${stamp}`, description: 'A test-owned full-envelope Project.' },
  })
  expect(projectResponse.ok()).toBe(true)
  const project = ((await projectResponse.json()) as CreateProjectResponse).project
  const shareResponse = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
  })
  expect(shareResponse.ok()).toBe(true)
  const contributionResponse = await page.request.post(`/api/v1/projects/${project.id}/contributions`, {
    data: { title: `Propose exactly once ${stamp}`, summary: 'The complete envelope is one authored authorization.' },
    headers: { 'Idempotency-Key': `contribution-${stamp}` },
  })
  expect(contributionResponse.ok()).toBe(true)
  let contribution = await contributionResponse.json() as Contribution
  if (initialLines) {
    const envelopeResponse = await page.request.post(
      `/api/v1/projects/${project.id}/contributions/${contribution.id}/envelope`,
      { data: { lines: initialLines, expectedVersion: 0 } },
    )
    expect(envelopeResponse.ok()).toBe(true)
    contribution = await envelopeResponse.json() as Contribution
  }
  return { project, contribution }
}

async function visitorPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' },
  })
  return { page: await context.newPage(), close: () => context.close() }
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

test('a failed proposal holds its complete draft through navigation and Retry creates one version', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const context = await arena(page, stamp)
  const endpoint = `**/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/envelope`
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let fail = true
  await page.route(endpoint, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Simulated proposal outage.' } }) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Declare effects', exact: true }).click()
  await main.getByLabel('Effect target 1').fill(`gmail:${stamp}`)
  await main.getByLabel('Max acts 1').fill('3')
  await main.getByLabel('Safety harness 1').selectOption('cooling-window')
  await main.getByLabel('Scope note 1').fill('Draft only; owner reviews recipients.')
  await main.getByRole('button', { name: 'Add act', exact: true }).click()
  await main.getByLabel('Effect type 2').selectOption('charge')
  await main.getByLabel('Effect target 2').fill(`budget:${stamp}`)
  await main.getByLabel('Safety harness 2').selectOption('dry-run')
  await main.getByRole('button', { name: 'Propose v1', exact: true }).click()

  const failed = page.locator('[data-contribution-envelope-proposal="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this envelope was proposed')
  const heldDraft = main.locator('[data-contribution-envelope-proposal-draft]')
  await expect(heldDraft).toContainText(`gmail:${stamp}`)
  await expect(heldDraft).toContainText(`budget:${stamp}`)
  await expect(heldDraft).toContainText('Draft only; owner reviews recipients.')
  await expect(main.getByRole('button', { name: 'Proposing…', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Crystallize', exact: true })).toBeDisabled()
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()
  await expect(main.getByRole('textbox', { name: `Comment on ${context.contribution.title}` })).toBeEnabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')
  expect(bodies[0]).toMatchObject({ expectedVersion: 0 })

  await main.getByRole('button', { name: context.project.name, exact: true }).click()
  await expect(main.getByRole('heading', { name: context.project.name, exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await main.getByRole('button', { name: context.contribution.title, exact: true }).first().click()
  await expect(main.locator('[data-contribution-envelope-proposal-draft]')).toContainText(`gmail:${stamp}`)

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-contribution-envelope-proposal]')).toHaveCount(0)
  await expect(main).toContainText('Effect envelope · v1')
  await expect(main).toContainText(`gmail:${stamp}`)
  await expect(main).toContainText(`budget:${stamp}`)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])
  const contribution = await currentContribution(page, context)
  expect(contribution.envelope?.version).toBe(1)
  expect(contribution.envelope?.lines).toHaveLength(2)
  expect(contribution.events.filter((event) => event.kind === 'envelope-proposed')).toHaveLength(1)
})

test('a lost full amendment is healed without restoring it over a later counter-proposal', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await arena(page, stamp, [
    { type: 'connector.write', target: `gmail:${stamp}`, cardinality: 2, harness: 'draft-escrow', note: 'old mail act' },
    { type: 'charge', target: `budget:${stamp}`, cardinality: 1, harness: 'dry-run', note: 'keep then edit' },
  ])
  const staleLedger = [context.contribution]
  const keys: string[] = []
  const bodies: ProposeEnvelopeRequest[] = []
  let committed = false
  let allowFreshReads = false
  await page.route(`**/api/v1/projects/${context.project.id}/contributions**`, async (route) => {
    if (route.request().method() === 'POST' && route.request().url().endsWith(`/${context.contribution.id}/envelope`)) {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      bodies.push(route.request().postDataJSON() as ProposeEnvelopeRequest)
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }) })
      return
    }
    if (committed && route.request().method() === 'GET' && !allowFreshReads) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleLedger) })
      return
    }
    await route.continue()
  })

  const main = await openContribution(page, context)
  await main.getByRole('button', { name: 'Amend', exact: true }).click()
  await main.getByRole('button', { name: 'Remove effect 1', exact: true }).click()
  await main.getByLabel('Effect target 1').fill(`budget:edited-${stamp}`)
  await main.getByLabel('Max acts 1').fill('4')
  await main.getByLabel('Safety harness 1').selectOption('canary')
  await main.getByLabel('Scope note 1').fill('Edited complete-envelope draft')
  await main.getByRole('button', { name: 'Propose v2', exact: true }).click()
  const failed = page.locator('[data-contribution-envelope-proposal="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this envelope was proposed')
  expect(keys).toHaveLength(1)
  expect(bodies[0]?.expectedVersion).toBe(1)
  expect(bodies[0]?.lines).toHaveLength(1)
  expect(bodies[0]?.lines[0]).toMatchObject({
    target: `budget:edited-${stamp}`,
    cardinality: 4,
    harness: 'canary',
    note: 'Edited complete-envelope draft',
  })

  const later = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/envelope`,
    { data: { expectedVersion: 2, lines: [{ type: 'connector.read', target: `calendar:${stamp}`, harness: 'dry-run' }] } },
  )
  expect(later.ok()).toBe(true)
  const aftermath = 'History added after the proposal response was lost.'
  const note = await page.request.post(
    `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/comments`,
    { data: { body: aftermath } },
  )
  expect(note.ok()).toBe(true)

  allowFreshReads = true
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('[data-contribution-envelope-proposal]')).toHaveCount(0)
  const currentEnvelope = main.locator('[data-contribution-envelope-version="3"]')
  await expect(currentEnvelope).toContainText('Effect envelope · v3')
  await expect(currentEnvelope).toContainText(`calendar:${stamp}`)
  await expect(currentEnvelope).not.toContainText(`budget:edited-${stamp}`)
  await expect(main).toContainText(aftermath)
  expect(keys).toHaveLength(1)
  const contribution = await currentContribution(page, context)
  expect(contribution.envelope?.version).toBe(3)
  expect(contribution.envelope?.lines[0]?.target).toBe(`calendar:${stamp}`)
  expect(contribution.events.filter((event) => event.kind === 'envelope-proposed')).toHaveLength(3)
  expect(contribution.events.at(-1)?.body).toBe(aftermath)
})

test('a project viewer may deliberate until approval but cannot revoke approved authority', async ({ page, browser }) => {
  test.setTimeout(ms(60_000))
  const stamp = `${Date.now().toString(36)}-viewer`
  const context = await arena(page, stamp)
  const visitor = await visitorPage(browser)
  try {
    const main = await openContribution(visitor.page, context)
    await expect(main.getByRole('button', { name: 'Declare effects', exact: true })).toBeVisible()
    await main.getByRole('button', { name: 'Declare effects', exact: true }).click()
    await expect(main.locator('[data-contribution-envelope-editor]')).toBeVisible()
    await main.getByRole('button', { name: 'Cancel', exact: true }).click()

    const proposed = await page.request.post(
      `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/envelope`,
      { data: { expectedVersion: 0, lines: [{ type: 'charge', target: `budget:${stamp}`, harness: 'dry-run' }] } },
    )
    expect(proposed.ok()).toBe(true)
    const approved = await page.request.post(
      `/api/v1/projects/${context.project.id}/contributions/${context.contribution.id}/envelope/approve`,
      { data: { expectedVersion: 1 } },
    )
    expect(approved.ok()).toBe(true)

    await visitor.page.reload()
    await expect(main.locator('[data-contribution-envelope-version="1"]')).toContainText('Approved by')
    await expect(main.getByRole('button', { name: 'Amend', exact: true })).toHaveCount(0)
  } finally {
    await visitor.close()
  }
})
