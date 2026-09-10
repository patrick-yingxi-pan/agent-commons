/** Browser proof for the bounded CSV/TSV-to-authored-sheet intake path. */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { extractXlsx } from '../src/lib/xlsxExtraction.ts'
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
  const preview = failed ? dialog.getByRole('alert') : dialog.getByRole('region', { name: 'Imported sheet', exact: true })
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
  await expect(dialog.getByLabel('Name')).toHaveValue(suggestedName)
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toBeFocused()
  await expect(dialog.getByLabel('Sheet column 1', { exact: true })).toHaveValue('Metric')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Revenue')
  await dialog.getByLabel('Name').fill(finalName)
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('00043')
  await expect(dialog.getByLabel('Name')).toHaveValue(finalName)
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

test('the saved imported sheet is visible to its owner and granted reader, but not a foreign account', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const name = `shared-import-${stamp}.xlsx`
  try {
    const dialog = await openSheetDialog(owner.page)
    await chooseSheet(owner.page, dialog, { name: `shared-${stamp}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`Metric,Value\nRevenue,00042\n`) })
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
  await dialog.getByLabel('Name').fill(`held-sheet-${stamp}.xlsx`)
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Original')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Draft stays')
  await chooseSheet(page, dialog, { name: `replacement-${stamp}.tsv`, mimeType: 'text/tab-separated-values', buffer: Buffer.from(`Header A\tHeader B\n00042\t=1+1\n`) })
  await expect(dialog.getByLabel('Name')).toHaveValue(`held-sheet-${stamp}.xlsx`)
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
