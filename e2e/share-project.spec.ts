import { test, expect } from '@playwright/test'

/** P8 Phase 3 — the share-project UI, end to end through the rendered app.
 *
 *  Locks the by-hand cross-tenant share affordance the store/route suites can't reach:
 *  a created Project's owner flips it Shared → the `share-project` relation op lands →
 *  the toggle reflects Shared and the backend records `shared:true` + a `guardianId`
 *  (the Phase 2a bridge that makes it cooperable). Un-sharing reverses it.
 *
 *  The cross-tenant COOPERATION itself (a *different* tenant commissioning onto the
 *  shared Project) is exhaustively locked at the store + route layer
 *  (tests/cross-tenant-runtime.test.ts, tests/capability-remote.test.ts); driving it
 *  through the UI needs a dev tenant-switcher (a follow-on — see the test plan). */
test('an owner shares a created project and the toggle + backend reflect it (and un-share reverses)', async ({ page, request }) => {
  await page.goto('/')

  // Dismiss the intro dialog if present.
  const explore = page.getByRole('button', { name: 'Explore on my own' })
  if (await explore.isVisible().catch(() => false)) await explore.click()

  // Go to Projects and create one (only CREATED projects are shareable).
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByPlaceholder('e.g. Insights dashboard').fill('E2E shared project')
  await page.getByRole('button', { name: 'Create project' }).click()

  // The project detail opens with the Contributors panel's share toggle — private by default.
  const toggle = page.getByTestId('share-toggle')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toContainText('Private to this workspace')

  // Share it: the toggle flips to Shared…
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toContainText('Shared across workspaces')

  // …and the backend recorded shared:true + a guardianId (the Phase 2a cooperation bridge).
  await expect
    .poll(async () => {
      const graph = await request.get('/api/v1/relations').then((r) => r.json())
      const proj = (graph.extraProjects ?? []).find((p: { name: string }) => p.name === 'E2E shared project')
      return proj ? { shared: proj.shared === true, guarded: typeof proj.guardianId === 'string' } : null
    })
    .toEqual({ shared: true, guarded: true })

  // Un-share reverses it (owner can make it private again).
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toContainText('Private to this workspace')
})
