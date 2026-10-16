/** PD67: the deferred workspace artifact chunk fails locally without taking
 * the conversation down, and a fresh app load can recover it. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a failed workspace preview chunk keeps the conversation usable and reload recovers', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })

  let fail = true
  let intercepted = false
  await page.route(/\/panels\/ArtifactPanel\.tsx(?:\?.*)?$/, async (route) => {
    intercepted = true
    if (fail) await route.abort('failed')
    else await route.continue()
  })

  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Workspace preview loading fixture' } })
  expect(created.ok()).toBe(true)
  const session = await created.json() as { id: string }
  const workspace = { workspaces: [{ id: 'ws-preview', label: 'preview/', artifacts: [{
    id: 'preview-artifact', name: 'insights-onepager.md', kind: 'doc', meta: 'fixture',
    source: { id: 'ui-host::preview-folder', label: 'preview/' },
    localSnapshot: { text: 'Imported body must win over the same-name demo library.' },
  }] }], repos: [], connectors: [], attachments: [] }
  const attached = await page.request.patch(`/api/v1/sessions/${session.id}/context-state`, { data: { operations: [], workspace } })
  expect(attached.ok(), 'the fixture workspace is persisted before navigation').toBe(true)
  await page.goto(`/s/${encodeURIComponent(session.id)}`)

  const workspaceChip = page.getByRole('button', { name: 'preview/', exact: true })
  await expect(workspaceChip).toBeVisible()
  // The restored workspace opens by default; toggling its chip here would
  // close the very panel whose failed load this test is meant to inspect.
  await expect.poll(() => intercepted, { timeout: ms(20_000) }).toBe(true)

  const failed = page.locator('[data-workspace-load-failed]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed).toHaveAttribute('role', 'alert')
  await expect(failed).toContainText('The workspace preview could not load')
  await expect(failed).toContainText('attached snapshots have not been removed')
  await expect(failed.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  expect(intercepted, 'the test failed the real deferred ArtifactPanel request').toBe(true)

  fail = false
  await failed.getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(page.locator('[data-workspace-load-failed]')).toHaveCount(0)
  await expect(page.locator('[data-folder-snapshot-preview]')).toContainText('Imported body must win over the same-name demo library.', { timeout: ms(20_000) })
  const restored = await page.request.get(`/api/v1/sessions/${session.id}`)
  expect((await restored.json()).workspace).toEqual(workspace)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
})
