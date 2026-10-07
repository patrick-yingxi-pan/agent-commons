/** The saved structured body renderer is conditional and may fail locally. */
import { test, expect, type Page } from '@playwright/test'
import type { ArtifactItem, ArtifactContentLibrary } from '../contract/index.ts'
import { ms } from './budget.ts'

const BODY_MODULE = /\/src\/components\/StructuredArtifactView\.tsx(?:\?.*)?$/u
const EDITOR_MODULE = /\/src\/components\/StructuredArtifactEditor\.tsx(?:\?.*)?$/u

async function createEditorFixture(page: Page, stamp: string) {
  const name = `structured-editor-load-${stamp}.xlsx`
  const body = { type: 'sheet' as const, columns: ['Metric', 'Value'], rows: [['Revenue', '00042']], note: 'Saved note remains unchanged.' }
  const response = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'sheet', meta: 'Sheet', body } } },
    headers: { 'Idempotency-Key': `structured-editor-load-${stamp}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find(candidate => candidate.name === name)
  expect(artifact, 'the saved sheet exists before its editor is loaded').toBeTruthy()
  const id = artifact!.id
  const contents = async () => await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const original = (await contents())[id]
  expect(original).toEqual({ ...body, revision: 0 })
  return { id, name, body, original, contents }
}

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

test('lazy structured editor cancellation closes the held draft before its blocked module resolves', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const { id, name, original, contents } = await createEditorFixture(page, Date.now().toString(36))
  let editorRequests = 0
  let writes = 0
  let release!: () => void
  let fetchedSource!: () => void
  let routeFinished!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const sourceReady = new Promise<void>(resolve => { fetchedSource = resolve })
  const requestFinished = new Promise<void>(resolve => { routeFinished = resolve })
  await page.on('request', request => {
    if (EDITOR_MODULE.test(new URL(request.url()).pathname)) editorRequests += 1
    if (new URL(request.url()).pathname === `/api/v1/artifacts/${id}/content` && request.method() === 'PATCH') writes += 1
  })
  await page.route(EDITOR_MODULE, async route => {
    try {
      const response = await route.fetch()
      fetchedSource()
      await gate
      await route.fulfill({ response })
    } finally {
      routeFinished()
    }
  })

  try {
    await page.goto(`/artifacts/${id}`)
    const detail = page.locator(`[data-artifact-page="${id}"]`)
    await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(detail.getByRole('region', { name: 'Sheet preview', exact: true })).toContainText('00042')
    expect(editorRequests, 'viewing the saved body does not fetch the editor module').toBe(0)
    const edit = detail.getByRole('button', { name: 'Edit sheet', exact: true })
    await edit.click()
    const loading = detail.locator('[data-structured-editor-load="loading"]')
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('Loading artifact editor…')
    await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    await sourceReady
    expect(editorRequests, 'Edit requested the actual deferred editor module').toBe(1)

    await loading.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(loading).toHaveCount(0)
    await expect(detail.getByRole('region', { name: 'Sheet preview', exact: true })).toContainText('00042')
    expect(await contents().then(library => library[id])).toEqual(original)
    expect(writes, 'opening and cancelling an editor draft never writes content').toBe(0)

    release()
    await requestFinished
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)
    await expect(edit).toBeVisible()
    await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
    expect(await contents().then(library => library[id])).toEqual(original)
    expect(writes).toBe(0)
  } finally {
    release()
    await page.unroute(EDITOR_MODULE)
  }
})

test('lazy editor rejection stays local, can be cancelled, and explicit reload restores the saved body', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const { id, name, body, original, contents } = await createEditorFixture(page, Date.now().toString(36))
  let fail = true
  let editorRequests = 0
  let writes = 0
  await page.on('request', request => {
    if (EDITOR_MODULE.test(new URL(request.url()).pathname)) editorRequests += 1
    if (new URL(request.url()).pathname === `/api/v1/artifacts/${id}/content` && request.method() === 'PATCH') writes += 1
  })
  await page.route(EDITOR_MODULE, async route => {
    if (fail) {
      await route.abort('failed')
    } else {
      await route.continue()
    }
  })

  await page.goto(`/artifacts/${id}`)
  const detail = page.locator(`[data-artifact-page="${id}"]`)
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  expect(editorRequests, 'the read-only page has not requested the edit module yet').toBe(0)
  await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
  const failed = detail.locator('[data-structured-editor-load="error"]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed).toHaveAttribute('role', 'alert')
  await expect(failed).toContainText('Couldn’t load artifact editor. Your draft is still held. Copy any unsaved workspace text before reloading.')
  await expect(failed.getByRole('button', { name: 'Reload editor', exact: true })).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  expect(editorRequests).toBe(1)
  expect(await contents().then(library => library[id])).toEqual(original)
  expect(writes, 'an editor import rejection is local and never submits a draft').toBe(0)

  await failed.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(detail.getByRole('region', { name: 'Sheet preview', exact: true })).toContainText('00042')
  expect(await contents().then(library => library[id])).toEqual(original)
  expect(writes).toBe(0)

  // A rejected import is recovered only by the explicit full reload control.
  await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
  const reopenedFailure = detail.locator('[data-structured-editor-load="error"]')
  await expect(reopenedFailure).toBeVisible({ timeout: ms(20_000) })
  await expect(reopenedFailure).toContainText('Your draft is still held.')
  fail = false
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    reopenedFailure.getByRole('button', { name: 'Reload editor', exact: true }).click(),
  ])
  await expect(page.locator(`[data-artifact-page="${id}"]`).getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.locator(`[data-artifact-page="${id}"]`).getByRole('region', { name: 'Sheet preview', exact: true })).toContainText('00042')
  expect(await contents().then(library => library[id])).toEqual(original)
  expect(writes).toBe(0)

  const recoveredDetail = page.locator(`[data-artifact-page="${id}"]`)
  await recoveredDetail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
  const editor = recoveredDetail.locator('[data-structured-artifact-editor="sheet"]')
  await expect(editor).toBeVisible({ timeout: ms(20_000) })
  await expect(editor.getByRole('textbox', { name: 'Sheet column 1', exact: true })).toHaveValue(body.columns[0]!)
  await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue(body.rows[0]![0]!)
  await expect(editor.getByRole('textbox', { name: 'Sheet note', exact: true })).toHaveValue(body.note!)
  expect(await contents().then(library => library[id])).toEqual(original)
  expect(writes).toBe(0)
})
