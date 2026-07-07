import { test, expect } from '@playwright/test'

/** Surface-audit S3 — a work item is a LIFECYCLE (posted → done/retracted) carrying
 *  prose to help a taker decide, not a bare status word. Locks, through the rendered
 *  UI, that WorkItemRow reveals the item's `note` and carries WHEN on the status line
 *  (a `relativeTime` stamp). The native post form doesn't collect a note today
 *  (A2A/seeded items do), so the item is posted via the API — exercising exactly the
 *  carried field the row now surfaces. */
test('a work item reveals its note and a lifecycle timestamp (S3)', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout: 2_500 }).catch(() => {})

  // Create a project — the work item's home.
  const NAME = `S3 work-item project ${Date.now().toString(36)}`
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByPlaceholder('e.g. Insights dashboard').fill(NAME)
  await page.getByRole('button', { name: 'Create project' }).click()

  // Share it — the Open-work backlog (where WorkItemRow lives) renders on a GUARDED
  // project, and sharing assigns the guardian.
  const share = page.getByTestId('share-toggle')
  await share.click()
  await expect(share).toHaveAttribute('aria-pressed', 'true')

  // Resolve its id from the graph, then post an item WITH a note via the API.
  const graph = await request.get('/api/v1/relations').then((r) => r.json())
  const proj = (graph.extraProjects ?? []).find((p: { name: string }) => p.name === NAME)
  expect(proj, 'the created project resolves in the graph').toBeTruthy()
  const NOTE = `Prefer the metric-first framing ${Date.now().toString(36)}`
  const posted = await page.request.post(`/api/v1/projects/${proj.id}/open-subgoals`, {
    data: { subGoal: 'Draft the launch note', type: 'charge', target: 'budget:demo', note: NOTE },
  })
  expect(posted.ok()).toBeTruthy()

  // Re-open the project page so the Open-work list fetches the API-posted item.
  await page.reload()
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout: 2_500 }).catch(() => {})
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByText(NAME).first().click()

  // The row reveals the note (S3) …
  await expect(page.getByText(NOTE)).toBeVisible()
  // … and carries WHEN — a fresh post reads "just now" on the status line.
  await expect(page.getByText(/just now — awaiting a taker/)).toBeVisible()

  // S13 — the poster byline is a DOOR to that workspace's profile, like every other
  // byline. The bare OwnerLink's accessible name is exactly the poster's display name
  // (the header byline reads "by X (you)", so exact-match targets the poster).
  const me = (await page.request.get('/api/v1/me').then((r) => r.json())) as { tenant: { name: string } }
  await page.getByRole('button', { name: me.tenant.name, exact: true }).first().click()
  await expect(page.getByText('Recent public activity')).toBeVisible() // a profile-page section
})
