/** Rendered authored formulas: edit/reload, immutable model snapshot, and safe values-only export. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { artifactContextId, artifactSnapshotText } from '../contract/artifactSnapshot.ts'
import type { ArtifactItem, Grant } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function createSheet(page: Page, name: string) {
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Sheet' })
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Input')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('2')
  for (const [column, label, value] of [[2, 'Multiplier', '3'], [3, 'Total', ''], [4, 'Broken', ''], [5, 'Literal formula text', '=SUM(A1:B1)']] as const) {
    await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
    await dialog.getByLabel(`Sheet column ${column}`, { exact: true }).fill(label)
    if (value) await dialog.getByLabel(`Sheet row 1 value ${column}`, { exact: true }).fill(value)
  }
  const total = dialog.getByLabel('Sheet row 1 value 3', { exact: true })
  await total.focus()
  await dialog.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
  await dialog.getByLabel('Formula source C1', { exact: true }).fill('=SUM(A1:B1)')
  const broken = dialog.getByLabel('Sheet row 1 value 4', { exact: true })
  await broken.focus()
  await dialog.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
  await dialog.getByLabel('Formula source D1', { exact: true }).fill('=A1/0')
  await dialog.getByRole('button', { name: 'Add row', exact: true }).click()
  await dialog.getByLabel('Sheet row 2 value 1', { exact: true }).fill('11')
  await dialog.getByLabel('Sheet row 2 value 2', { exact: true }).fill('13')
  const dependent = dialog.getByLabel('Sheet row 2 value 3', { exact: true })
  await dependent.focus()
  await dialog.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
  await dialog.getByLabel('Formula source C2', { exact: true }).fill('=B2')
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const artifactsResponse = await page.request.get(`${API}/artifacts`)
  expect(artifactsResponse.ok()).toBe(true)
  const artifacts = await artifactsResponse.json() as ArtifactItem[]
  const artifact = artifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  const body = {
    type: 'sheet', columns: ['Input', 'Multiplier', 'Total', 'Broken', 'Literal formula text'],
    rows: [['2', '3', { formula: '=SUM(A1:B1)' }, { formula: '=A1/0' }, '=SUM(A1:B1)'], ['11', '13', { formula: '=B2' }, '', '']],
  }
  return { artifact: artifact!, body }
}

async function readBody(page: Page, id: string) {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as Record<string, any>)[id]
}

async function grantReader(page: Page, id: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return await response.json() as Grant
}

async function pasteFromClipboard(page: Page, cell: ReturnType<Page['getByRole']>, value: string) {
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), value)
  await cell.focus()
  await cell.press('ControlOrMeta+V')
}

async function sharedTexts(base64: string) {
  const zip = new ZipReader(new Uint8ArrayReader(Buffer.from(base64, 'base64')))
  try {
    const entries = await zip.getEntries()
    const files: Record<string, string> = {}
    for (const entry of entries) if (!entry.directory) files[entry.filename] = await entry.getData!(new TextWriter())
    return files
  } finally { await zip.close() }
}

test('owner authors, edits, reloads, snapshots and exports formulas with shared/foreign walls', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  try {
    const stamp = randomUUID()
    const name = `formula-${stamp}.xlsx`
    const { artifact, body: original } = await createSheet(owner.page, name)
    expect(await readBody(owner.page, artifact.id)).toEqual({ ...original, revision: 0 })
    const grant = await grantReader(owner.page, artifact.id)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await expect(detail).toBeVisible({ timeout: ms(20_000) })
    const preview = detail.locator('[data-structured-artifact-body="sheet"]')
    await expect(preview).toBeVisible()
    const firstTotal = preview.locator('tbody tr').nth(0).locator('td').nth(2)
    const secondTotal = preview.locator('tbody tr').nth(1).locator('td').nth(2)
    await expect(firstTotal.locator('span').first()).toHaveText('5')
    await expect(firstTotal.getByLabel('Formula source C1')).toHaveText('=SUM(A1:B1)')
    await expect(secondTotal.locator('span').first()).toHaveText('13')
    await expect(secondTotal.getByLabel('Formula source C2')).toHaveText('=B2')
    await expect(preview.locator('tbody tr').nth(0).locator('td').nth(3)).toContainText('#DIV/0!')

    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const editor = detail.locator('[data-structured-artifact-editor="sheet"]')
    await expect(editor).toBeVisible()
    const sourceCell = editor.getByRole('textbox', { name: 'Sheet row 1 value 3', exact: true })
    await sourceCell.focus()
    await expect(editor.getByRole('combobox', { name: 'Cell mode', exact: true })).toHaveValue('Formula')
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue('=SUM(A1:B1)')
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 5')
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue('=SUM(A1:B1)')
      await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 5')
      await owner.page.screenshot({ path: testInfo.outputPath(`formula-editor-${viewport.width}x${viewport.height}.png`) })
    }

    // Formula/text conversion is explicit and preserves the visible source.
    await editor.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Text')
    await expect(editor.getByRole('combobox', { name: 'Cell mode', exact: true })).toHaveValue('Text')
    await expect(editor.getByRole('textbox', { name: 'Text value C1', exact: true })).toHaveValue('=SUM(A1:B1)')
    await editor.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
    await expect(editor.getByRole('combobox', { name: 'Cell mode', exact: true })).toHaveValue('Formula')
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue('=SUM(A1:B1)')

    await editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true }).fill('4')
    await expect(editor.locator('[data-sheet-cell-coordinate]')).toHaveText('A1')
    await expect(editor.locator('[data-sheet-cell-preview]').filter({ hasText: '7' })).toHaveCount(1)
    await sourceCell.focus()
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 7')

    // Row and column removal rewrite surviving references; Undo restores the exact source.
    const secondFormula = editor.getByRole('textbox', { name: 'Sheet row 2 value 3', exact: true })
    await secondFormula.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source C2', exact: true })).toHaveValue('=B2')
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 13')
    await editor.getByRole('button', { name: 'Remove sheet row 1', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 3', exact: true })).toHaveValue('=B1')
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue('=B1')
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 13')
    await detail.locator('[data-artifact-draft-history]').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 3', exact: true })).toHaveValue('=B2')

    await secondFormula.focus()
    await editor.getByRole('button', { name: 'Remove sheet column 1', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('=A2')
    await expect(editor.locator('[data-sheet-cell-coordinate]')).toHaveText('B2')
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 13')
    await detail.locator('[data-artifact-draft-history]').getByRole('button', { name: 'Undo', exact: true }).click()
    await secondFormula.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source C2', exact: true })).toHaveValue('=B2')

    // Actual clipboard paste is a literal range operation, even over formula cells.
    await pasteFromClipboard(owner.page, sourceCell, '=8+9\tliteral')
    await expect(editor.getByText('Pasted 1 × 2 cells into this draft. Replaced 2 formulas with literal text.', { exact: true })).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 3', exact: true })).toHaveValue('=8+9')
    await expect(editor.getByRole('combobox', { name: 'Cell mode', exact: true })).toHaveValue('Text')
    await detail.locator('[data-artifact-draft-history]').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue('=SUM(A1:B1)')

    await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Sheet row 2 value 5', exact: true }), 'first\t=10+1\nsecond\t=12+2')
    await expect(editor.getByText('Pasted 2 × 2 cells into this draft.', { exact: true })).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 6', exact: true })).toHaveValue('=10+1')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 6', exact: true })).toHaveValue('=12+2')
    await detail.locator('[data-artifact-draft-history]').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Sheet column 6', exact: true })).toHaveCount(0)
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 1', exact: true })).toHaveCount(0)

    // The selected-cell toolbar is the same paste entry point as the grid.
    await sourceCell.focus()
    await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Formula source C1', exact: true }), '21\t22')
    await expect(sourceCell).toHaveValue('21')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 4', exact: true })).toHaveValue('22')
    await expect(editor.getByText('Pasted 1 × 2 cells into this draft. Replaced 2 formulas with literal text.', { exact: true })).toBeVisible()
    await detail.locator('[data-artifact-draft-history]').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(sourceCell).toHaveValue('=SUM(A1:B1)')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 4', exact: true })).toHaveValue('=A1/0')

    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)
    const saved = await readBody(owner.page, artifact.id)
    expect(saved.revision).toBe(1)
    expect(saved.rows).toEqual([['4', '3', { formula: '=SUM(A1:B1)' }, { formula: '=A1/0' }, '=SUM(A1:B1)'], ['11', '13', { formula: '=B2' }, '', '']])

    await owner.page.reload()
    await expect(detail).toBeVisible()
    const reloadedPreview = detail.locator('[data-structured-artifact-body="sheet"]')
    await expect(reloadedPreview.locator('tbody tr').nth(0).locator('td').nth(2).locator('span').first()).toHaveText('7')
    await expect(reloadedPreview.locator('tbody tr').nth(0).locator('td').nth(2).getByLabel('Formula source C1')).toHaveText('=SUM(A1:B1)')
    await expect(reloadedPreview.locator('tbody tr').nth(0).locator('td').nth(3)).toContainText('#DIV/0!')
    await expect(reloadedPreview.locator('tbody tr').nth(1).locator('td').nth(2).locator('span').first()).toHaveText('13')

    const sessionResponse = await owner.page.request.post(`${API}/sessions`, { data: { firstMessage: `Use the current budget ${stamp}` } })
    expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
    const sessionId = (await sessionResponse.json() as { id: string }).id
    const attachResponse = await owner.page.request.patch(`${API}/sessions/${sessionId}/context-state`, {
      data: { operations: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [{
        id: artifactContextId(artifact.id), kind: 'artifact', label: name, artifactCaptureId: randomUUID(),
      }] } },
    })
    expect(attachResponse.ok(), await attachResponse.text()).toBe(true)
    const attached = await attachResponse.json() as any
    const snapshot = attached.workspace.attachments[0].artifactSnapshot
    expect(snapshot).toMatchObject({ artifactId: artifact.id, title: name, revision: 1 })
    const { revision: _bodyRevision, ...authoredBody } = saved
    expect(snapshot.body).toEqual(authoredBody)
    expect(Object.hasOwn(snapshot, 'calculation')).toBe(false)
    expect(JSON.parse(artifactSnapshotText(snapshot))).toEqual({
      title: name, artifactKind: 'sheet', revision: 1, body: snapshot.body,
      calculation: { version: 1, sheets: [{ id: 'sheet-1', rows: [['4', '3', '7', '#DIV/0!', '=SUM(A1:B1)'], ['11', '13', '13', '', '']] }] },
    })

    const exportResponse = await owner.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)
    expect(exportResponse.ok(), await exportResponse.text()).toBe(true)
    const descriptor = await exportResponse.json() as { content: string; revision: number }
    expect(descriptor.revision).toBe(1)
    const files = await sharedTexts(descriptor.content)
    expect(files['xl/sharedStrings.xml']).toContain('7')
    expect(files['xl/sharedStrings.xml']).toContain('#DIV/0!')
    expect(files['xl/sharedStrings.xml']).toContain('=SUM(A1:B1)')
    expect(Object.values(files).join('\n')).not.toMatch(/<f(?:\s|>)/)

    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const view = detail.locator('[data-structured-artifact-body="sheet"]')
      await expect(view.locator('tbody tr').nth(0).locator('td').nth(2).locator('span').first()).toHaveText('7')
      await expect(view.locator('tbody tr').nth(0).locator('td').nth(2).getByLabel('Formula source C1')).toHaveText('=SUM(A1:B1)')
      await expect(view.locator('tbody tr').nth(0).locator('td').nth(3)).toContainText('#DIV/0!')
      await owner.page.screenshot({ path: testInfo.outputPath(`formula-${viewport.width}x${viewport.height}.png`) })
    }

    await reader.page.goto(`/artifacts/${artifact.id}`)
    const readerDetail = reader.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(readerDetail).toBeVisible()
    await expect(readerDetail.getByRole('button', { name: 'Edit sheet', exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await reader.page.setViewportSize(viewport)
      await settleArtifactPageRail(reader.page)
      await expect.poll(() => reader.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const view = readerDetail.locator('[data-structured-artifact-body="sheet"]')
      await expect(view.locator('tbody tr').nth(0).locator('td').nth(2).locator('span').first()).toHaveText('7')
      await expect(view.locator('tbody tr').nth(0).locator('td').nth(2).getByLabel('Formula source C1')).toHaveText('=SUM(A1:B1)')
      await expect(view.locator('tbody tr').nth(1).locator('td').nth(2).locator('span').first()).toHaveText('13')
      await reader.page.screenshot({ path: testInfo.outputPath(`formula-reader-${viewport.width}x${viewport.height}.png`) })
    }
    const readerExport = await reader.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)
    expect(readerExport.ok()).toBe(true)
    expect((await readerExport.json()).content).toBe(descriptor.content)

    await foreign.page.goto(`/artifacts/${artifact.id}`)
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[4]]) {
      await foreign.page.setViewportSize(viewport)
      await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
      await expect(foreign.page.getByRole('button', { name: 'Edit sheet', exact: true })).toHaveCount(0)
      await expect.poll(() => foreign.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
    expect((await foreign.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)).status()).toBe(404)
    expect((await foreign.page.request.get(`${API}/artifact-content`)).ok()).toBe(true)
    expect(await readBody(foreign.page, artifact.id)).toBeUndefined()
    expect(original.rows[0][2]).toEqual({ formula: '=SUM(A1:B1)' })
    expect(grant.id).toBeTruthy()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('workbook second-tab formulas use only that tab and survive save, reload, snapshot and XLSX export', async ({ browser }: { browser: Browser }) => {
  const owner = await newUser(browser)
  try {
    const stamp = randomUUID()
    const { artifact } = await createSheet(owner.page, `formula-workbook-${stamp}.xlsx`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const sheetEditor = detail.locator('[data-structured-artifact-editor="sheet"]')
    await expect(sheetEditor).toBeVisible()
    await sheetEditor.getByRole('button', { name: 'Add worksheet', exact: true }).click()
    const editor = detail.locator('[data-structured-artifact-editor="workbook"]')
    await expect(editor).toBeVisible()
    await editor.getByLabel('Worksheet name', { exact: true }).fill('Isolated')
    await editor.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true }).fill('6')
    await editor.getByRole('button', { name: 'Add column', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true }).focus()
    await editor.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
    await editor.getByRole('textbox', { name: 'Formula source B1', exact: true }).fill('=A1*2')
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 12')
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)

    const saved = await readBody(owner.page, artifact.id)
    expect(saved.type).toBe('workbook')
    expect(saved.sheets).toHaveLength(2)
    expect(saved.sheets[0].id).toBe('sheet-1')
    expect(saved.sheets[1].id).not.toBe('sheet-1')
    expect(saved.sheets[1].name).toBe('Isolated')
    expect(saved.sheets[1].rows).toEqual([['6', { formula: '=A1*2' }]])

    await owner.page.reload()
    await expect(detail).toBeVisible()
    await detail.getByRole('tab', { name: 'Isolated', exact: true }).click()
    const secondSheet = detail.locator('[data-structured-artifact-body="sheet"]')
    await expect(secondSheet.locator('tbody tr').nth(0).locator('td').nth(0).locator('span').first()).toHaveText('6')
    await expect(secondSheet.locator('tbody tr').nth(0).locator('td').nth(1).locator('span').first()).toHaveText('12')
    await expect(secondSheet.getByLabel('Formula source B1')).toHaveText('=A1*2')
    const firstSheet = detail.getByRole('tab', { name: 'Sheet', exact: true })
    await firstSheet.click()
    const firstView = detail.locator('[data-structured-artifact-body="sheet"]')
    await expect(firstView.locator('tbody tr').nth(0).locator('td').nth(0).locator('span').first()).toHaveText('2')

    const sessionResponse = await owner.page.request.post(`${API}/sessions`, { data: { firstMessage: `Second worksheet ${stamp}` } })
    expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
    const sessionId = (await sessionResponse.json() as { id: string }).id
    const attachResponse = await owner.page.request.patch(`${API}/sessions/${sessionId}/context-state`, {
      data: { operations: [], workspace: { workspaces: [], repos: [], connectors: [], attachments: [{
        id: artifactContextId(artifact.id), kind: 'artifact', label: artifact.name, artifactCaptureId: randomUUID(),
      }] } },
    })
    expect(attachResponse.ok(), await attachResponse.text()).toBe(true)
    const attached = await attachResponse.json() as any
    const snapshot = attached.workspace.attachments[0].artifactSnapshot
    expect(snapshot.body).toEqual({ type: saved.type, sheets: saved.sheets })
    const model = JSON.parse(artifactSnapshotText(snapshot))
    expect(model.calculation.sheets.map((sheet: any) => sheet.id)).toEqual(saved.sheets.map((sheet: any) => sheet.id))
    expect(model.calculation.sheets[0].rows[0][0]).toBe('2')
    expect(model.calculation.sheets[1].rows).toEqual([['6', '12']])

    const exportResponse = await owner.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)
    expect(exportResponse.ok(), await exportResponse.text()).toBe(true)
    const descriptor = await exportResponse.json() as { content: string }
    const files = await sharedTexts(descriptor.content)
    expect(files['xl/workbook.xml']).toContain('sheet name="Isolated"')
    expect(files['xl/worksheets/sheet2.xml']).toContain('t="s"')
    expect(files['xl/sharedStrings.xml']).toContain('12')
    expect(Object.values(files).join('\n')).not.toMatch(/<f(?:\s|>)/)
  } finally {
    await owner.context.close()
  }
})
