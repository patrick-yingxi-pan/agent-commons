import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { API, newUser } from './social-helpers.ts'

test('proposal verdicts retain one decision through failure and expose outdated reviewed changes', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const stamp = Date.now().toString(36)
  const projectId = `p-verdict-${stamp}`
  const projectName = `Verdict recovery ${stamp}`
  const change = `Keep one logical verdict ${stamp}`

  // Build the test subject through the same product routes; this walk owns the
  // rendered verdict/recovery boundary, not another copy of project creation.
  const created = await ada.page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'create-project', projectId, projectName, projectDescription: '' } },
  })
  expect(created.ok()).toBeTruthy()
  const shared = await ada.page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'propose' },
  })
  expect(shared.ok()).toBeTruthy()
  const offered = await grace.page.request.post(`${API}/proposals`, {
    data: { subject: { kind: 'project', id: projectId }, delta: { kind: 'suggestion', text: change }, rationale: 'This is ready.' },
  })
  expect(offered.ok()).toBeTruthy()

  await ada.page.goto(`/projects/${projectId}`)
  await expect(ada.page.getByText(change, { exact: true })).toBeVisible({ timeout: ms(20_000) })
  const row = ada.page.locator('[data-proposal-verdict]').first()
  await expect(row).toHaveAttribute('data-proposal-verdict', 'ready', { timeout: ms(20_000) })

  // Drop the first request before it reaches the backend. The row stays pending,
  // the shell owns recovery, and Retry must retransmit the same logical key.
  const pattern = '**/api/v1/proposals/*/land'
  const keys: string[] = []
  await ada.page.route(pattern, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    await route.abort('failed')
  })
  await row.getByRole('button', { name: 'Land', exact: true }).click()
  const failed = ada.page.locator('[data-proposal-verdict-mutation="failed"]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(row).toHaveAttribute('data-proposal-verdict', 'pending')
  await expect(row.getByRole('button', { name: 'Land', exact: true })).toBeDisabled()

  await ada.page.unroute(pattern)
  await ada.page.route(pattern, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    await route.continue()
  })
  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(ada.page.getByText(/^L\d+$/).first()).toBeVisible({ timeout: ms(20_000) })
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  await ada.page.unroute(pattern)

  // An applying proposal is consent to a reviewed base. Move a routine after
  // Grace offers its cadence change; the owner sees an explicit stale state,
  // no Land affordance, and can still close it with Decline.
  // Create this walk's routine through the product route instead of mutating a
  // shared seed: the social-sharing shard exercises that seed concurrently, and
  // two definition revisions would invalidate each other's reviewed base.
  const templates = await ada.page.request.get(`${API}/schedule-templates`)
  expect(templates.ok()).toBeTruthy()
  const template = ((await templates.json()) as Array<{ seed: Record<string, unknown> }>)[0]
  expect(template).toBeTruthy()
  const createdRoutine = await ada.page.request.post(`${API}/schedules`, {
    data: { seed: { ...template.seed, name: `Verdict routine ${stamp}` } },
  })
  expect(createdRoutine.ok()).toBeTruthy()
  const scheduleId = ((await createdRoutine.json()) as { id: string }).id
  const cadence = 'Every hour'
  const routineGrant = await ada.page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'schedule', id: scheduleId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'propose' },
  })
  expect(routineGrant.ok()).toBeTruthy()
  const routineOffer = await grace.page.request.post(`${API}/proposals`, {
    data: {
      subject: { kind: 'schedule', id: scheduleId },
      delta: { kind: 'schedule-patch', patch: { cadence } },
      rationale: 'A reviewed schedule change.',
    },
  })
  expect(routineOffer.ok()).toBeTruthy()
  await ada.page.goto(`/scheduled/${scheduleId}`)
  const routineRow = ada.page.locator('li').filter({ hasText: `cadence → “${cadence}”` })
  await expect(routineRow).toHaveCount(1, { timeout: ms(20_000) })

  const schedules = await (await ada.page.request.get(`${API}/schedules`)).json() as Array<{
    id: string
    revision?: number
    notifyOnFailure: boolean
  }>
  const routine = schedules.find((candidate) => candidate.id === scheduleId)!
  const moved = await ada.page.request.patch(`${API}/schedules/${scheduleId}`, {
    data: { notifyOnFailure: !routine.notifyOnFailure, expectedRevision: routine.revision ?? 0 },
  })
  expect(moved.ok()).toBeTruthy()

  await expect(routineRow.getByText('Needs revision', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(routineRow.getByRole('button', { name: 'Land', exact: true })).toHaveCount(0)
  await routineRow.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(routineRow.getByText('no', { exact: true })).toBeVisible({ timeout: ms(20_000) })

  await ada.context.close()
  await grace.context.close()
})
