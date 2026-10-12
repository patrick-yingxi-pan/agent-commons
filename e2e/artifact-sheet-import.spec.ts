/** Browser proof for bounded CSV/TSV and XLSX-to-authored-sheet intake. */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { extractXlsx } from '../src/lib/xlsxExtraction.ts'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import type { Grant } from '../contract/index.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const REVIEW_DIR = '.data/artifact-sheet-import-review'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

mkdirSync(REVIEW_DIR, { recursive: true })

type PickedFile = { name: string; mimeType: string; buffer: Buffer }
const workbookFile = (name: string): PickedFile => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxFixture({ sheets: [
  { name: 'Overview', rows: [['Not selected'], ['Do not save this worksheet']] },
  { name: 'Hidden', hidden: true, rows: [['Private hidden values']] },
  { name: 'Selected sales', rows: [['Metric', 'Value', 'Formula', 'Saved result'], ['Revenue', '00042', '=1+1', { formula: '1+1', cached: 2 }]] },
] }) })

async function openSheetDialog(page: Page) {
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await expect(dialog.getByRole('region', { name: 'Import spreadsheet data', exact: true })).toBeVisible()
  return dialog
}

async function chooseSheet(page: Page, dialog: Locator, file: PickedFile) {
  const choosing = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await (await choosing).setFiles(file)
}

async function expectContained(page: Page, dialog: Locator) {
  await expect.poll(async () => {
    const box = await dialog.locator('[data-bounded-dialog="resource-form"]').boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function captureDialog(page: Page, dialog: Locator, testInfo: TestInfo, label: string, failed = false) {
  const viewport = page.viewportSize()!
  const preview = failed ? dialog.getByRole('alert') : dialog.getByRole('region', { name: /^Imported (sheet|workbook)$/ })
  await preview.scrollIntoViewIfNeeded()
  await expectContained(page, dialog)
  if (failed) await expect(preview).toBeVisible()
  else await expect(preview.locator('table')).toBeVisible()
  await assertWcag22Aa(page, `Sheet import ${label} ${viewport.width}x${viewport.height}`)
  await page.screenshot({ path: `${REVIEW_DIR}/${testInfo.project.name}-${label}-${viewport.width}x${viewport.height}.png`, fullPage: false })
}

async function captureAllDialogViewports(page: Page, dialog: Locator, testInfo: TestInfo, label: string, failed = false) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await captureDialog(page, dialog, testInfo, label, failed)
  }
}

async function createSheetFromDialog(page: Page, dialog: Locator, suggestedName: string, finalName: string) {
  await dialog.getByRole('button', { name: 'Use imported sheet', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(suggestedName)
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toBeFocused()
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Metric')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Revenue')
  await dialog.getByLabel('Name', { exact: true }).fill(finalName)
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('00043')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(finalName)
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const artifactId = page.url().split('/').at(-1)!
  await expect(page.locator(`[data-artifact-page="${artifactId}"]`)).toBeVisible()
  return artifactId
}

async function grantSheet(page: Page, artifactId: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id: artifactId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Grant
}

async function exportXlsx(page: Page, filename: string) {
  const action = page.getByRole('button', { name: 'Download XLSX', exact: true })
  await expect(action).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await action.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = await readFile(path!)
  expect(bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
  const extracted = await extractXlsx(new Uint8Array(bytes))
  expect(extracted.documentImport).toEqual({ format: 'xlsx', status: 'ready' })
  expect(extracted.text).toContain('00043')
  expect(extracted.text).toContain('=1+1')
}

async function expectSavedSheetFace(page: Page, artifactId: string, role: string, testInfo: TestInfo) {
  await page.goto(`/artifacts/${artifactId}`)
  const detail = page.locator(`[data-artifact-page="${artifactId}"]`)
  await expect(detail).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(detail.locator('td').filter({ hasText: '00043' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `Saved sheet ${role} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `${REVIEW_DIR}/${testInfo.project.name}-${role}-${viewport.width}x${viewport.height}.png`, fullPage: false })
  }
}

test('CSV review toggles headers, adopts literal values, and creates a real XLSX sheet', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const name = `imported-sheet-${stamp}.xlsx`
  const csv = `Metric,Value,Formula\nRevenue,00042,=1+1\n"Quoted, cell","Line 1\nLine 2","He said ""ready"""\n`
  const dialog = await openSheetDialog(page)
  await chooseSheet(page, dialog, { name: `sales-export-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const preview = dialog.getByRole('region', { name: 'Imported sheet', exact: true })
  await expect(preview).toBeVisible()
  const headers = dialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
  await expect(headers).toBeChecked()
  await expect(preview.locator('th').filter({ hasText: 'Metric' })).toBeVisible()
  await expect(preview.locator('td').filter({ hasText: '00042' })).toBeVisible()
  await expect(preview.locator('td').filter({ hasText: '=1+1' })).toBeVisible()
  await expect(preview.locator('td').filter({ hasText: 'Line 1' })).toHaveText('Line 1\nLine 2')
  await expect(preview.locator('td').filter({ hasText: 'He said' })).toHaveText('He said "ready"')
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await captureAllDialogViewports(page, dialog, testInfo, 'ready')
  await page.setViewportSize(VIEWPORTS[0])
  const scrollableSheet = preview.getByRole('region', { name: 'Sheet preview', exact: true })
  await scrollableSheet.focus()
  await scrollableSheet.press('ArrowRight')
  await expect.poll(() => scrollableSheet.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  await expectContained(page, dialog)
  await page.setViewportSize(VIEWPORTS[4])

  await headers.click()
  await expect(preview.locator('th').filter({ hasText: 'Column A' })).toBeVisible()
  await expect(preview.locator('td').filter({ hasText: 'Metric' })).toBeVisible()
  await headers.click()
  await expect(preview.locator('th').filter({ hasText: 'Metric' })).toBeVisible()
  await createSheetFromDialog(page, dialog, `sales-export-${stamp}.xlsx`, name)
  await expect(page.locator('td').filter({ hasText: '00043' })).toBeVisible()
  await expect(page.locator('td').filter({ hasText: '=1+1' })).toBeVisible()
  await page.reload()
  await expect(page.locator('td').filter({ hasText: '00043' })).toBeVisible()
  await exportXlsx(page, name)
})

test('XLSX review chooses a worksheet, keeps cached values literal and saves only that reviewed body', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const name = `workbook-${stamp}.xlsx`
  const dialog = await openSheetDialog(page)
  await chooseSheet(page, dialog, workbookFile(name))
  const worksheet = dialog.getByRole('combobox', { name: 'Worksheet', exact: true })
  await expect(worksheet.locator('option')).toHaveText(['Overview', 'Selected sales'])
  await expect(worksheet).toHaveValue('1')
  await worksheet.selectOption({ label: 'Selected sales' })
  const preview = dialog.getByRole('region', { name: 'Imported sheet', exact: true })
  await expect(preview.locator('td')).toHaveText(['Revenue', '00042', '=1+1', '2'])
  await expect(preview).toContainText(/cached/i)
  await expect(preview).not.toContainText('Do not save')
  await expect(preview).not.toContainText('Private hidden')
  await captureAllDialogViewports(page, dialog, testInfo, 'xlsx-selected')
  const headers = dialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
  await headers.click()
  await expect(preview.getByRole('columnheader', { name: 'Column A', exact: true })).toBeVisible()
  await expect(preview.getByRole('columnheader', { name: 'Data column A', exact: true })).toHaveText('A')
  await expect(preview.locator('td').first()).toHaveText('Metric')
  await headers.click()
  // The review actions begin below the short viewport's fold. Trusted clicks
  // must scroll them above the sticky footer, not bypass its hit testing.
  await page.setViewportSize(VIEWPORTS[3])
  const id = await createSheetFromDialog(page, dialog, name, name)
  const response = await page.request.get(`${API}/artifact-content`)
  expect((await response.json())[id]).toEqual({ type: 'sheet', revision: 0, columns: ['Metric', 'Value', 'Formula', 'Saved result'], rows: [['00043', '00042', '=1+1', '2']] })
  await page.reload()
  await exportXlsx(page, name)
})

test('all-visible XLSX review keeps the draft until explicit adoption and blocks missing cached values', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const filename = `all-visible-${stamp}.xlsx`
  const badWorkbook: PickedFile = {
    name: `missing-cache-${stamp}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsxFixture({ sheets: [
      { name: 'Ready first', rows: [['Metric', 'Value'], ['Revenue', '00042']] },
      { name: 'Missing cache', rows: [['Metric', 'Formula'], ['Revenue', { formula: '1+1' }]] },
    ] }),
  }
  const allVisibleWorkbook: PickedFile = {
    name: filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsxFixture({ sheets: [
      { name: 'Overview', rows: [['Metric', 'Value'], ['Revenue', '00042']] },
      { name: 'Hidden tab', hidden: true, rows: [['Do not import', 'hidden']] },
      { name: 'Selected sales', rows: [['Metric', 'Value'], ['Costs', '00017']] },
    ] }),
  }
  const dialog = await openSheetDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill('Keep my draft.xlsx')
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Draft column')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Draft value')
  await chooseSheet(page, dialog, badWorkbook)
  await dialog.getByLabel('Import scope').selectOption({ label: 'All visible worksheets' })
  const invalidPreview = dialog.getByRole('region', { name: 'Imported workbook', exact: true })
  await expect(invalidPreview.getByRole('alert')).toContainText(/Missing cache.*no saved cached value/i)
  await expect(dialog.getByRole('button', { name: 'Replace spreadsheet with imported workbook', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Keep my draft.xlsx')
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Draft column')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Draft value')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()

  await chooseSheet(page, dialog, allVisibleWorkbook)
  await dialog.getByLabel('Import scope').selectOption({ label: 'All visible worksheets' })
  const preview = dialog.getByRole('region', { name: 'Imported workbook', exact: true })
  const tabs = preview.getByRole('tablist', { name: 'Worksheets', exact: true })
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Selected sales'])
  await expect(tabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(preview.getByRole('columnheader', { name: 'Metric', exact: true })).toBeVisible()
  await expect(preview.getByRole('columnheader', { name: 'Value', exact: true })).toBeVisible()
  await expect(preview.getByRole('columnheader', { name: 'Data column A', exact: true })).toHaveText('A')
  await expect(preview.getByRole('columnheader', { name: 'Data column B', exact: true })).toHaveText('B')
  await expect(preview.locator('table tbody td')).toHaveText(['Revenue', '00042'])
  await tabs.getByRole('tab', { name: 'Selected sales', exact: true }).click()
  await expect(preview.locator('table tbody td')).toHaveText(['Costs', '00017'])
  await expect(preview).toContainText(/all 2 visible worksheets in source order/i)
  await expect(preview).toContainText(/first row as column names/i)
  await expect(dialog.getByRole('button', { name: 'Replace spreadsheet with imported workbook', exact: true })).toBeEnabled()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Keep my draft.xlsx')
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Draft column')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Draft value')
  await captureAllDialogViewports(page, dialog, testInfo, 'xlsx-all-visible')

  await dialog.getByRole('button', { name: 'Replace spreadsheet with imported workbook', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Imported workbook', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Keep my draft.xlsx')
  const editorTabs = dialog.getByRole('tablist', { name: 'Worksheets', exact: true })
  await expect(editorTabs.getByRole('tab')).toHaveText(['Overview', 'Selected sales'])
  await expect(editorTabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByLabel('Worksheet name')).toHaveValue('Overview')
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Metric')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Revenue')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('XLSX missing formula results refuse adoption without changing the draft and a new candidate resets worksheet choice', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const dialog = await openSheetDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill('My unchanged sheet.xlsx')
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Original')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Keep this draft')
  await chooseSheet(page, dialog, { name: 'uncalculated.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxFixture({ sheets: [
    { name: 'Empty', rows: [] },
    { name: 'Missing saved result', rows: [['Metric', 'Value'], ['Revenue', { formula: '1+1' }]] },
  ] }) })
  const worksheet = dialog.getByRole('combobox', { name: 'Worksheet', exact: true })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await worksheet.selectOption({ label: 'Missing saved result' })
  await expect(dialog.getByRole('alert')).toContainText(/recalculate/i)
  const scope = dialog.getByLabel('Import scope', { exact: true })
  await scope.selectOption({ label: 'All visible worksheets' })
  await expect(scope).toHaveValue('all')
  await expect(dialog.getByRole('button', { name: 'Replace spreadsheet with imported workbook', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await captureAllDialogViewports(page, dialog, testInfo, 'xlsx-missing-cache', true)
  await page.setViewportSize(VIEWPORTS[0])
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await chooseSheet(page, dialog, workbookFile('replacement.xlsx'))
  await expect(scope, 'scope from a previous workbook cannot carry to a new candidate').toHaveValue('selected')
  await expect(worksheet).toHaveValue('1')
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toContainText('Do not save this worksheet')
  await scope.selectOption({ label: 'All visible worksheets' })
  await expect(scope).toHaveValue('all')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await chooseSheet(page, dialog, { name: 'replacement.csv', mimeType: 'text/csv', buffer: Buffer.from('Metric,Value\nImported,00042\n') })
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Imported workbook', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Replace sheet with imported sheet', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Replace spreadsheet with imported workbook', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('My unchanged sheet.xlsx')
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Original')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Keep this draft')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('the saved imported sheet is visible to its owner and granted reader, but not a foreign account', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const name = `shared-import-${stamp}.xlsx`
  try {
    const dialog = await openSheetDialog(owner.page)
    await chooseSheet(owner.page, dialog, workbookFile(`shared-${stamp}.xlsx`))
    await dialog.getByRole('combobox', { name: 'Worksheet', exact: true }).selectOption({ label: 'Selected sales' })
    await createSheetFromDialog(owner.page, dialog, `shared-${stamp}.xlsx`, name)
    const artifactId = owner.page.url().split('/').at(-1)!
    await grantSheet(owner.page, artifactId)
    await expectSavedSheetFace(owner.page, artifactId, 'owner', testInfo)
    await expectSavedSheetFace(reader.page, artifactId, 'reader', testInfo)
    await foreign.page.goto(`/artifacts/${artifactId}`)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).', { exact: true })).toBeVisible()
    await expect(foreign.page.getByRole('button', { name: 'Download XLSX', exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await foreign.page.setViewportSize(viewport)
      await settleArtifactPageRail(foreign.page)
      await expect.poll(() => foreign.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertWcag22Aa(foreign.page, `Foreign sheet ${viewport.width}x${viewport.height}`)
      await foreign.page.screenshot({ path: `${REVIEW_DIR}/${testInfo.project.name}-foreign-${viewport.width}x${viewport.height}.png`, fullPage: false })
    }
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('TSV replacement, malformed input, and discard preserve the authored draft', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const dialog = await openSheetDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill(`held-sheet-${stamp}.xlsx`)
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Original')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Draft stays')
  await chooseSheet(page, dialog, { name: `replacement-${stamp}.tsv`, mimeType: 'text/tab-separated-values', buffer: Buffer.from(`Header A\tHeader B\n00042\t=1+1\n`) })
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(`held-sheet-${stamp}.xlsx`)
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Draft stays')
  await captureAllDialogViewports(page, dialog, testInfo, 'replacement-review')
  await dialog.getByRole('button', { name: 'Replace sheet with imported sheet', exact: true }).click()
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Header A')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('00042')
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toBeFocused()

  await chooseSheet(page, dialog, { name: `bad-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from('a,b\n"unterminated,c\n') })
  await expect(dialog.getByRole('alert')).toContainText('malformed CSV/TSV')
  await captureAllDialogViewports(page, dialog, testInfo, 'malformed', true)
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Header A')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('00042')

  await chooseSheet(page, dialog, { name: `blank-header-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(',Value\nx,y\n') })
  const blankPreview = dialog.getByRole('region', { name: 'Imported sheet', exact: true })
  await expect(blankPreview.getByRole('alert')).toContainText('first row must contain nonblank headers')
  await expect(dialog.getByRole('button', { name: 'Replace sheet with imported sheet', exact: true })).toBeDisabled()
  await captureAllDialogViewports(page, dialog, testInfo, 'invalid-headers', true)
  const headers = dialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
  await headers.click()
  await expect(blankPreview.locator('th').filter({ hasText: 'Column A' })).toBeVisible()
  await expect(blankPreview.locator('td').filter({ hasText: 'x' })).toBeVisible()
  await captureAllDialogViewports(page, dialog, testInfo, 'headerless')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()

  await chooseSheet(page, dialog, { name: `ragged-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from('a,b\nc\n') })
  await expect(dialog.getByRole('alert')).toContainText('consistent row width')
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Header A')

  await chooseSheet(page, dialog, { name: `oversized-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`a\n${'x'.repeat(300_000)}\n`) })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Header A')

  await chooseSheet(page, dialog, { name: `fenced-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from('Fenced,Value\nkept,late\n') })
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toBeVisible()
  await dialog.getByLabel('Format').selectOption({ label: 'Document' })
  await expect(dialog.getByRole('region', { name: 'Import spreadsheet data', exact: true })).toHaveCount(0)
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toHaveCount(0)

  await chooseSheet(page, dialog, { name: `discard-${stamp}.tsv`, mimeType: 'text/tab-separated-values', buffer: Buffer.from(`New A\tNew B\nnew\tvalue\n`) })
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Header A')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('00042')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
