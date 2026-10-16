/** Rendered confirmation, dependency recovery, stale-consent recovery, and
 * early-absence retention for Agent removal. */
import { test, expect, type Page } from '@playwright/test'
import {
  DEFAULT_PROVIDER_ID,
  type Agent,
  type Commission,
} from '../contract/index.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { ms } from './budget.ts'

async function createAgent(page: Page, label: string): Promise<Agent> {
  const response = await page.request.post('/api/v1/agents', {
    data: {
      label,
      providerId: DEFAULT_PROVIDER_ID,
      systemPromptId: SP_DEFAULT_ID,
      tools: [],
    },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Agent>
}

function agentRow(page: Page, label: string) {
  return page.locator('main [data-resource-synopsis-row]').filter({
    hasText: label,
    has: page.getByRole('button', { name: 'Delete', exact: true }),
  })
}

async function confirmRemoval(page: Page, label: string) {
  const row = agentRow(page, label)
  await expect(row).toBeVisible({ timeout: ms(20_000) })
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Remove ${label}?`, exact: true })
  await expect(dialog).toContainText('proposal history')
  await expect(dialog).toContainText('Project delegations')
  await expect(dialog).toContainText('Existing conversations, prior replies, and contributions stay')
  await expect(dialog).toContainText('New replies require choosing an available Agent in Model and effort → Conversation Agent')
  await expect(dialog).not.toContainText('Conversations fall back to the default Agent')
  return { row, dialog }
}

test('Agent removal confirms scope, holds the row, and retries stale reviewed truth', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const agent = await createAgent(page, `Removal Agent ${Date.now().toString(36)}`)
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  let attempts = 0
  await page.route(`**/api/v1/agents/${agent.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const changed = await page.request.patch(`/api/v1/agents/${agent.id}`, {
        data: { published: true, expectedRevision: 0 },
      })
      expect(changed.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto('/agents')
  let { dialog } = await confirmRemoval(page, agent.label)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  ;({ dialog } = await confirmRemoval(page, agent.label))
  await dialog.getByRole('button', { name: 'Remove Agent', exact: true }).click()

  const failed = page.locator('[data-agent-deletion="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  const heldRow = agentRow(page, agent.label)
  await expect(heldRow).toHaveAttribute('aria-busy', 'true')
  await expect(heldRow).toContainText('Published · v1')
  await expect(heldRow.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled()
  await expect(heldRow.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(bodies[0]).toMatchObject({ expectedRevision: 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(agentRow(page, agent.label)).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ expectedRevision: 1 })
  expect((await page.request.get(`/api/v1/agents/${agent.id}`)).status()).toBe(404)
})

test('a commissioned Agent stays held until its assignment is removed and Retry succeeds', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const agent = await createAgent(page, `Assigned Agent ${Date.now().toString(36)}`)
  const commissionResponse = await page.request.post('/api/v1/commissions', {
    data: { agentId: agent.id, projectId: 'p-insights', role: 'writer' },
  })
  expect(commissionResponse.ok()).toBe(true)
  const commission = await commissionResponse.json() as Commission
  const bodies: Record<string, unknown>[] = []
  const keys: string[] = []
  await page.route(`**/api/v1/agents/${agent.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>)
      keys.push(route.request().headers()['idempotency-key'] ?? '')
    }
    await route.continue()
  })

  await page.goto('/agents')
  const { dialog } = await confirmRemoval(page, agent.label)
  await dialog.getByRole('button', { name: 'Remove Agent', exact: true }).click()
  const failed = page.locator('[data-agent-deletion="failed"]')
  await expect(failed).toContainText('still a Contributor')
  await expect(failed).toContainText('Remove its Project assignments, then Retry')
  await expect(agentRow(page, agent.label)).toHaveAttribute('aria-busy', 'true')

  const uncommission = await page.request.delete(`/api/v1/commissions/${commission.id}`, {
    data: { expectedRevision: commission.configurationRevision ?? 0 },
  })
  expect(uncommission.ok()).toBe(true)
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(agentRow(page, agent.label)).toHaveCount(0)
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toMatchObject({ expectedRevision: 0 })
  expect(bodies[1]).toMatchObject({ expectedRevision: 0 })
  expect(keys[1]).toBe(keys[0])
})

test('a committed Agent removal stays visible while its lost response is reconciled', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const agent = await createAgent(page, `Lost Agent removal ${Date.now().toString(36)}`)
  let attempts = 0
  let releaseReconciliation!: () => void
  let markReconciliationStarted!: () => void
  const reconciliationStarted = new Promise<void>((resolve) => { markReconciliationStarted = resolve })
  const reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve })

  await page.route(`**/api/v1/agents/${agent.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      attempts += 1
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
      })
      return
    }
    if (route.request().method() === 'GET') {
      markReconciliationStarted()
      await reconciliationRelease
    }
    await route.continue()
  })

  await page.goto('/agents')
  const { dialog } = await confirmRemoval(page, agent.label)
  await dialog.getByRole('button', { name: 'Remove Agent', exact: true }).click()
  await reconciliationStarted

  const heldRow = agentRow(page, agent.label)
  await expect(heldRow).toHaveAttribute('aria-busy', 'true')
  await expect(heldRow).toContainText('Removing Agent…')
  await expect(page.locator('[data-agent-deletion="pending"]')).toBeVisible()
  const authoritative = await (await page.request.get('/api/v1/agents')).json() as Agent[]
  expect(authoritative.some((candidate) => candidate.id === agent.id)).toBe(false)

  releaseReconciliation()
  await expect(agentRow(page, agent.label)).toHaveCount(0)
  await expect(page.locator('[data-agent-deletion]')).toHaveCount(0)
  expect(attempts).toBe(1)
})
