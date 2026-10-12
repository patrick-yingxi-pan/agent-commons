/** Rendered acceptance for explicit, stable-name cross-worksheet formula references. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { artifactContextId, artifactSnapshotText } from '../contract/artifactSnapshot.ts'
import type { ArtifactItem, Grant } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'
import { splitPane } from './pane-actions.ts'

const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function createCrossSheetWorkbook(page: Page, name: string, testInfo: TestInfo) {
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Sheet' })
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Base')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('40')

  const worksheetName = dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })
  await worksheetName.fill('Summary')
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await expect(dialog.locator('[data-pending-sheet-renames]')).toContainText('Sheet')
  await page.setViewportSize(VIEWPORTS[0])
  await settleArtifactPageRail(page)
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('cross-sheet-creation-pending-320x700.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await dialog.getByRole('button', { name: 'Cancel rename', exact: true }).click()
  await expect(worksheetName).toHaveValue('Sheet')
  await worksheetName.fill('Summary')
  await dialog.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
  await expect(dialog.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
  await dialog.getByLabel('Sheet column 2', { exact: true }).fill('Carry')
  await dialog.getByLabel('Sheet row 1 value 2', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: 'Add row', exact: true }).click()
  await dialog.getByLabel('Sheet row 2 value 1', { exact: true }).fill('5')
  await dialog.getByLabel('Sheet row 2 value 2', { exact: true }).fill('9')

  await dialog.getByRole('button', { name: 'Add worksheet', exact: true }).click()
  const nameInput = dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })
  await nameInput.fill('Summary')
  await dialog.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
  await expect(dialog.locator('[data-sheet-rename-error]')).toContainText('unique')
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel rename', exact: true }).click()
  await expect(nameInput).toHaveValue('Sheet 2')
  await nameInput.fill('Detail')
  await dialog.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
  await expect(dialog.getByRole('tab', { name: 'Detail', exact: true })).toBeVisible()

  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
  const firstFormula = dialog.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })
  await firstFormula.focus()
  await dialog.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
  await dialog.getByRole('textbox', { name: 'Formula source B1', exact: true }).fill('=Summary!A2+A1')
  const secondFormula = dialog.getByRole('textbox', { name: 'Sheet row 1 value 3', exact: true })
  await secondFormula.focus()
  await dialog.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
  await dialog.getByRole('textbox', { name: 'Formula source C1', exact: true }).fill('=Summary!B2+A1')
  await expect(dialog.locator('[data-sheet-cell-result]')).toHaveText('Result: 11')

  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const response = await page.request.get(`${API}/artifacts`)
  expect(response.ok(), await response.text()).toBe(true)
  const artifacts = await response.json() as ArtifactItem[]
  const artifact = artifacts.find(row => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
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

async function sharedStrings(base64: string) {
  const zip = new ZipReader(new Uint8ArrayReader(Buffer.from(base64, 'base64')))
  try {
    const entries = await zip.getEntries()
    const files: Record<string, string> = {}
    for (const entry of entries) if (!entry.directory) files[entry.filename] = await entry.getData!(new TextWriter())
    return files
  } finally { await zip.close() }
}

async function assertNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

test('duplicate workbook panes share a pending worksheet rename and both gate Save', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  try {
    const name = `cross-sheet-rename-panes-${randomUUID()}.xlsx`
    const created = await owner.page.request.post(`${API}/artifacts`, {
      data: { name, kind: 'sheet', body: { type: 'workbook', sheets: [
        { id: '__proto__', name: 'Summary', columns: ['Value'], rows: [['40']] },
        { id: 'detail', name: 'Detail', columns: ['Local', 'Total'], rows: [['2', { formula: '=Summary!A1+A1' }]] },
      ] } },
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const artifact = (await created.json() as { artifact: ArtifactItem }).artifact
    const originalResponse = await owner.page.request.get(`${API}/artifact-content`)
    expect(originalResponse.ok(), await originalResponse.text()).toBe(true)
    const original = (await originalResponse.json() as Record<string, any>)[artifact.id]

    await owner.page.goto(`/artifacts/${artifact.id}`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    await splitPane(owner.page, 'right')
    const panes = owner.page.locator('[data-main-pane]')
    await expect(panes).toHaveCount(2)
    const paneA = panes.nth(0)
    const paneB = panes.nth(1)
    const editorA = paneA.locator('[data-structured-artifact-editor="workbook"]')
    const editorB = paneB.locator('[data-structured-artifact-editor="workbook"]')
    await expect(editorA).toBeVisible()
    await expect(editorB).toBeVisible()

    await editorA.getByRole('tab', { name: 'Summary', exact: true }).click()
    const cellA = editorA.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })
    const cellB = editorB.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })
    await cellA.fill('41')
    await expect(cellB).toHaveValue('41')
    const renameA = editorA.getByRole('textbox', { name: 'Worksheet name', exact: true })
    const renameB = editorB.getByRole('textbox', { name: 'Worksheet name', exact: true })
    await renameA.fill('Pending overview')
    await expect(editorA.locator('[data-pending-sheet-renames]')).toContainText('Summary')
    await expect(editorA.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await expect(renameB).toHaveValue('Pending overview')
    await expect(editorB.locator('[data-sheet-rename-error]')).toHaveCount(0)
    await expect(editorB.locator('[data-pending-sheet-renames]')).toContainText('Summary')
    await expect(editorB.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()

    await renameA.pressSequentially('!')
    await expect(renameB).toHaveValue('Pending overview!')
    await renameA.press('ControlOrMeta+z')
    await expect(renameA).toHaveValue('Pending overview')
    await expect(renameB).toHaveValue('Pending overview')
    await expect(cellA).toHaveValue('41')
    await expect(cellB).toHaveValue('41')

    await editorB.getByRole('button', { name: 'Cancel rename', exact: true }).click()
    await expect(renameA).toHaveValue('Summary')
    await expect(renameB).toHaveValue('Summary')
    await expect(editorA.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
    await expect(editorB.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
    const after = await owner.page.request.get(`${API}/artifact-content`)
    expect(after.ok()).toBe(true)
    expect((await after.json() as Record<string, unknown>)[artifact.id]).toEqual(original)
  } finally { await owner.context.close() }
})

test('creation preserves pending renames and scopes worksheet-removal Undo to the exact draft', async ({ browser }: { browser: Browser }, testInfo: TestInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  try {
    const page = owner.page
    await page.goto('/artifacts')
    await page.getByRole('button', { name: 'New artifact', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Name', { exact: true }).fill(`creation-reference-${randomUUID()}.xlsx`)
    await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Sheet' })
    await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Base')
    await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('40')

    const pendingName = dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })
    await pendingName.fill('Overview')
    await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
    await expect(dialog.locator('[data-pending-sheet-renames]')).toContainText('Sheet')
    await page.setViewportSize(VIEWPORTS[0])
    await settleArtifactPageRail(page)
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('cross-sheet-creation-pending-320x700.png') })

    const tabs = dialog.getByRole('tablist', { name: 'Worksheets', exact: true })
    await dialog.getByRole('button', { name: 'Add worksheet', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: 'Sheet 2', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator('[data-pending-sheet-renames]')).toContainText('Sheet')
    await tabs.getByRole('tab', { name: 'Sheet', exact: true }).click()
    await expect(pendingName).toHaveValue('Overview')
    await dialog.getByRole('button', { name: 'Cancel rename', exact: true }).click()
    await expect(pendingName).toHaveValue('Sheet')
    await page.setViewportSize({ width: 1280, height: 800 })

    await pendingName.fill('Overview')
    await dialog.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
    await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
    await dialog.getByLabel('Sheet column 2', { exact: true }).fill('Carry')
    await dialog.getByLabel('Sheet row 1 value 2', { exact: true }).fill('8')
    await dialog.getByRole('button', { name: 'Add row', exact: true }).click()
    await dialog.getByLabel('Sheet row 2 value 1', { exact: true }).fill('5')
    await dialog.getByLabel('Sheet row 2 value 2', { exact: true }).fill('9')
    await tabs.getByRole('tab', { name: 'Sheet 2', exact: true }).click()
    const secondName = dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })
    await secondName.fill('Detail')
    await dialog.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
    await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('2')
    await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
    const dependent = dialog.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })
    await dependent.focus()
    await dialog.getByRole('combobox', { name: 'Cell mode', exact: true }).selectOption('Formula')
    await dialog.getByRole('textbox', { name: 'Formula source B1', exact: true }).fill('=Overview!A2+A1')
    await expect(dialog.locator('[data-sheet-cell-result]')).toHaveText('Result: 7')

    await tabs.getByRole('tab', { name: 'Overview', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove worksheet', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Undo removal', exact: true })).toBeVisible()
    await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
    await dependent.focus()
    await expect(dialog.locator('[data-sheet-cell-result]')).toContainText('Error #REF!:')
    await dialog.getByRole('button', { name: 'Undo removal', exact: true }).click()
    await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
    await dependent.focus()
    await expect(dialog.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue('=Overview!A2+A1')
    await expect(dialog.locator('[data-sheet-cell-result]')).toHaveText('Result: 7')

    await tabs.getByRole('tab', { name: 'Overview', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove worksheet', exact: true }).click()
    await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
    await dependent.focus()
    await dialog.getByRole('textbox', { name: 'Formula source B1', exact: true }).fill('=1+1')
    await expect(dialog.getByRole('button', { name: 'Undo removal', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await owner.context.close()
  }
})

test('owner authors, renames, structurally edits, saves and shares cross-sheet formulas', async ({ browser }: { browser: Browser }, testInfo: TestInfo) => {
  test.setTimeout(ms(150_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  try {
    const stamp = randomUUID()
    const name = `cross-sheet-${stamp}.xlsx`
    const artifact = await createCrossSheetWorkbook(owner.page, name, testInfo)
    await grantReader(owner.page, artifact.id)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const editor = detail.locator('[data-structured-artifact-editor="workbook"]')
    await expect(editor).toBeVisible()
    const history = detail.locator('[data-artifact-draft-history]')

    // Renaming a referenced tab rewrites the source at both workbook edges. A failed duplicate can be canceled safely.
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    const detailName = editor.getByRole('textbox', { name: 'Worksheet name', exact: true })
    await detailName.fill('Pending detail name')
    await expect(editor.locator('[data-pending-sheet-renames]')).toContainText('Detail')
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      await assertNoHorizontalOverflow(owner.page)
      await expect(detailName).toHaveValue('Pending detail name')
      await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
      await owner.page.screenshot({ path: testInfo.outputPath(`cross-sheet-rename-pending-${viewport.width}x${viewport.height}.png`) })
    }
    await editor.getByRole('tab', { name: 'Summary', exact: true }).click()
    await expect(editor.locator('[data-pending-sheet-renames]')).toContainText('Detail')
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await expect(detailName).toHaveValue('Pending detail name')
    await editor.getByRole('button', { name: 'Cancel rename', exact: true }).click()
    await expect(detailName).toHaveValue('Detail')
    await detailName.fill('Summary')
    await editor.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
    await expect(editor.locator('[data-sheet-rename-error]')).toContainText('unique')
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      await assertNoHorizontalOverflow(owner.page)
      await expect(editor.locator('[data-sheet-rename-error]')).toContainText('unique')
      await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
      await owner.page.screenshot({ path: testInfo.outputPath(`cross-sheet-rename-invalid-${viewport.width}x${viewport.height}.png`) })
    }
    await editor.getByRole('button', { name: 'Cancel rename', exact: true }).click()
    await expect(detailName).toHaveValue('Detail')
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()

    await editor.getByRole('tab', { name: 'Summary', exact: true }).click()
    const summaryName = editor.getByRole('textbox', { name: 'Worksheet name', exact: true })
    await summaryName.fill("Team's Summary")
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await editor.getByRole('button', { name: 'Rename worksheet', exact: true }).click()
    await expect(editor.getByRole('tab', { name: "Team's Summary", exact: true })).toBeVisible()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    const firstFormulaCell = editor.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })
    await firstFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue("='Team''s Summary'!A2+A1")
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 7')
    const secondFormulaCell = editor.getByRole('textbox', { name: 'Sheet row 1 value 3', exact: true })
    await secondFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue("='Team''s Summary'!B2+A1")
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 11')

    // Each structural delete rewrites references on the other tab; History restores the exact prior whole body.
    await editor.getByRole('tab', { name: "Team's Summary", exact: true }).click()
    await editor.getByRole('button', { name: 'Remove sheet row 1', exact: true }).click()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await firstFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue("='Team''s Summary'!A1+A1")
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 7')
    await history.getByRole('button', { name: 'Undo', exact: true }).click()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await firstFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue("='Team''s Summary'!A2+A1")

    await editor.getByRole('tab', { name: "Team's Summary", exact: true }).click()
    await editor.getByRole('button', { name: 'Remove sheet column 1', exact: true }).click()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await firstFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue('=#REF!+A1')
    await expect(editor.locator('[data-sheet-cell-result]')).toContainText('Error #REF!:')
    await secondFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue("='Team''s Summary'!A2+A1")
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 11')
    await history.getByRole('button', { name: 'Undo', exact: true }).click()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await firstFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue("='Team''s Summary'!A2+A1")
    await secondFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source C1', exact: true })).toHaveValue("='Team''s Summary'!B2+A1")

    await editor.getByRole('tab', { name: "Team's Summary", exact: true }).click()
    await editor.getByRole('button', { name: 'Remove worksheet', exact: true }).click()
    await expect(editor.getByRole('tab', { name: "Team's Summary", exact: true })).toHaveCount(0)
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await firstFormulaCell.focus()
    await expect(editor.locator('[data-sheet-cell-result]')).toContainText('Error #REF!:')
    await history.getByRole('button', { name: 'Undo', exact: true }).click()
    await editor.getByRole('tab', { name: 'Detail', exact: true }).click()
    await firstFormulaCell.focus()
    await expect(editor.getByRole('textbox', { name: 'Formula source B1', exact: true })).toHaveValue("='Team''s Summary'!A2+A1")
    await secondFormulaCell.focus()
    await expect(editor.locator('[data-sheet-cell-result]')).toHaveText('Result: 11')

    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)
    const saved = await readBody(owner.page, artifact.id)
    expect(saved.revision).toBe(1)
    expect(saved.type).toBe('workbook')
    expect(saved.sheets.map((sheet: any) => sheet.name)).toEqual(["Team's Summary", 'Detail'])
    expect(saved.sheets[0].rows).toEqual([['40', '8'], ['5', '9']])
    expect(saved.sheets[1].rows).toEqual([['2', { formula: "='Team''s Summary'!A2+A1" }, { formula: "='Team''s Summary'!B2+A1" }]])

    await owner.page.reload()
    await expect(detail).toBeVisible()
    await detail.getByRole('tab', { name: 'Detail', exact: true }).click()
    const ownerView = detail.locator('[data-structured-artifact-body="sheet"]')
    await expect(ownerView.locator('tbody tr').nth(0).locator('td').nth(1).locator('span').first()).toHaveText('7')
    await expect(ownerView.locator('tbody tr').nth(0).locator('td').nth(1).getByLabel('Formula source B1')).toHaveText("='Team''s Summary'!A2+A1")
    await expect(ownerView.locator('tbody tr').nth(0).locator('td').nth(2).locator('span').first()).toHaveText('11')

    const sessionResponse = await owner.page.request.post(`${API}/sessions`, { data: { firstMessage: `Reconcile cross-tab values ${stamp}` } })
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
    const { revision: _revision, ...authoredBody } = saved
    expect(snapshot.body).toEqual(authoredBody)
    expect(JSON.parse(artifactSnapshotText(snapshot))).toEqual({
      title: name, artifactKind: 'sheet', revision: 1, body: snapshot.body,
      calculation: { version: 1, sheets: [
        { id: saved.sheets[0].id, rows: [['40', '8'], ['5', '9']] },
        { id: saved.sheets[1].id, rows: [['2', '7', '11']] },
      ] },
    })

    const exportResponse = await owner.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)
    expect(exportResponse.ok(), await exportResponse.text()).toBe(true)
    const descriptor = await exportResponse.json() as { content: string; revision: number }
    expect(descriptor.revision).toBe(1)
    const files = await sharedStrings(descriptor.content)
    expect(files['xl/workbook.xml']).toContain('Team')
    expect(files['xl/sharedStrings.xml']).toContain('7')
    expect(files['xl/sharedStrings.xml']).toContain('11')
    expect(Object.values(files).join('\n')).not.toMatch(/<f(?:\s|>)/)
    expect(files['xl/sharedStrings.xml']).not.toContain('Summary!A2')

    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      await assertNoHorizontalOverflow(owner.page)
      await expect(ownerView.locator('tbody tr').nth(0).locator('td').nth(1).locator('span').first()).toHaveText('7')
      await expect(ownerView.locator('tbody tr').nth(0).locator('td').nth(2).locator('span').first()).toHaveText('11')
      await owner.page.screenshot({ path: testInfo.outputPath(`cross-sheet-owner-${viewport.width}x${viewport.height}.png`) })
    }

    await reader.page.goto(`/artifacts/${artifact.id}`)
    const readerDetail = reader.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(readerDetail).toBeVisible()
    await readerDetail.getByRole('tab', { name: 'Detail', exact: true }).click()
    const readerView = readerDetail.locator('[data-structured-artifact-body="sheet"]')
    await expect(readerDetail.getByRole('button', { name: 'Edit sheet', exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await reader.page.setViewportSize(viewport)
      await settleArtifactPageRail(reader.page)
      await assertNoHorizontalOverflow(reader.page)
      await expect(readerView.locator('tbody tr').nth(0).locator('td').nth(1).locator('span').first()).toHaveText('7')
      await expect(readerView.locator('tbody tr').nth(0).locator('td').nth(2).locator('span').first()).toHaveText('11')
      await reader.page.screenshot({ path: testInfo.outputPath(`cross-sheet-reader-${viewport.width}x${viewport.height}.png`) })
    }
    const readerExport = await reader.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)
    expect(readerExport.ok()).toBe(true)
    expect((await readerExport.json()).content).toBe(descriptor.content)

    await foreign.page.goto(`/artifacts/${artifact.id}`)
    const denied = foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).', { exact: true })
    for (const viewport of VIEWPORTS) {
      await foreign.page.setViewportSize(viewport)
      await settleArtifactPageRail(foreign.page)
      await assertNoHorizontalOverflow(foreign.page)
      await expect(denied).toBeVisible()
      await expect(foreign.page.getByRole('tablist', { name: 'Worksheets', exact: true })).toHaveCount(0)
      await foreign.page.screenshot({ path: testInfo.outputPath(`cross-sheet-foreign-${viewport.width}x${viewport.height}.png`) })
    }
    expect((await foreign.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)).status()).toBe(404)
    expect((await foreign.page.request.get(`${API}/artifact-content`)).ok()).toBe(true)
    expect(await readBody(foreign.page, artifact.id)).toBeUndefined()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
