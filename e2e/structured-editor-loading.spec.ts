/** The saved structured body renderer is conditional and may fail locally. */
import { test, expect } from '@playwright/test'
import type { ArtifactItem, ArtifactContentLibrary } from '../contract/index.ts'
import { ms } from './budget.ts'

const BODY_MODULE = /\/src\/components\/StructuredArtifactView\.tsx(?:\?.*)?$/u

test('a blocked structured body stays local and reload restores exact workbook tabs', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const name = `structured-body-load-${stamp}.xlsx`
  const body = {
    type: 'workbook' as const,
    sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Revenue', '00042']] },
      { id: 'forecast', name: 'Forecast Q4', columns: ['Metric', 'Value'], rows: [['Costs', '00017']] },
    ],
  }
  const created = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'sheet', meta: 'Sheet', body } } },
    headers: { 'Idempotency-Key': `structured-body-load-${stamp}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const graph = await created.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find(candidate => candidate.name === name)
  expect(artifact, 'the saved workbook fixture exists before the body renderer is held').toBeTruthy()
  const id = artifact!.id

  const contents = async () => await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const savedBefore = (await contents())[id]
  expect(savedBefore?.type).toBe('workbook')
  if (!savedBefore || savedBefore.type !== 'workbook') throw new Error('fixture must expose the saved workbook')
  const expectedSheets = savedBefore.sheets

  let fail = true
  let intercepted = 0
  let release!: () => void
  let routeFinished!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const firstRouteFinished = new Promise<void>(resolve => { routeFinished = resolve })
  await page.route(BODY_MODULE, async route => {
    intercepted += 1
    if (fail && intercepted === 1) {
      try {
        await gate
        await route.abort('failed')
      } finally {
        routeFinished()
      }
      return
    }
    await route.continue()
  })

  let writes = 0
  await page.on('request', request => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/v1/artifacts/${id}/content`) writes += 1
  })

  await page.goto(`/artifacts/${id}`)
  const detail = page.locator(`[data-artifact-page="${id}"]`)
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const loading = detail.locator('[data-structured-body-loading]')
  await expect(loading).toBeVisible({ timeout: ms(20_000) })
  await expect(loading).toHaveAttribute('role', 'status')
  await expect(loading).toContainText('Loading artifact content')
  await expect(detail.getByRole('button', { name: 'Download XLSX', exact: true })).toBeVisible()
  expect(intercepted, 'the saved workbook body requested the deferred renderer').toBe(1)
  expect(await contents().then(library => library[id])).toEqual(savedBefore, 'loading a body renderer cannot mutate the saved workbook')
  expect(writes).toBe(0)

  fail = false
  release()
  await firstRouteFinished
  const failed = detail.locator('[data-structured-body-load-error]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed).toHaveAttribute('role', 'alert')
  await expect(failed).toContainText('Couldn’t load artifact content. Reload to review it; unsaved workspace text will be lost.')
  await expect(failed.getByRole('button', { name: 'Reload content', exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  expect(await contents().then(library => library[id])).toEqual(savedBefore, 'a rendering failure cannot mutate the saved body')
  expect(writes, 'rendering and recovery notices never submit a body edit').toBe(0)

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    failed.getByRole('button', { name: 'Reload content', exact: true }).click(),
  ])
  await expect(page.locator(`[data-artifact-page="${id}"]`).getByRole('tablist', { name: 'Worksheets', exact: true }).getByRole('tab')).toHaveText(expectedSheets.map(sheet => sheet.name), { timeout: ms(20_000) })
  const recovered = page.locator(`[data-artifact-page="${id}"]`)
  const tabs = recovered.getByRole('tablist', { name: 'Worksheets', exact: true })
  await expect(tabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(recovered.locator('table tbody td')).toHaveText(['Revenue', '00042'])
  await tabs.getByRole('tab', { name: 'Forecast Q4', exact: true }).click()
  await expect(recovered.locator('table tbody td')).toHaveText(['Costs', '00017'])
  expect(await contents().then(library => library[id])).toEqual(savedBefore)
  expect(writes).toBe(0)
})
