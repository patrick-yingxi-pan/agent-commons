/** Rendered acceptance for authored workbooks: one artifact, ordered worksheet tabs. */
import { readFile } from 'node:fs/promises'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactContent, ArtifactItem, Grant } from '../contract/index.ts'
import { extractXlsx } from '../src/lib/xlsxExtraction.ts'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

async function createArtifact(page: Page, name: string, body: ArtifactContent) {
  const kind = body.type === 'workbook' || body.type === 'sheet' ? 'sheet' : 'slide'
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind, meta: kind === 'sheet' ? 'Sheet' : 'Slides', body } } },
    headers: { 'Idempotency-Key': `workbook-e2e-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function grantRead(page: Page, id: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Grant
}

async function savedContent(page: Page, id: string) {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBeTruthy()
  const library = await response.json() as Record<string, ArtifactContent>
  return library[id]
}

async function exportText(page: Page, filename: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  const extracted = await extractXlsx(new Uint8Array(await readFile(path!)))
  expect(extracted.documentImport).toEqual({ format: 'xlsx', status: 'ready' })
  return extracted.text
}

async function checkViewport(page: Page, testInfo: TestInfo, label: string, viewport: typeof VIEWPORTS[number]) {
  await page.setViewportSize(viewport)
  await settleArtifactPageRail(page)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
}

async function leaveAndReturnToArtifact(page: Page, id: string, name: string) {
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
  const row = page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name, exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name, exact: true }).click()
  await expect(page.locator(`[data-artifact-page="${id}"]`).last()).toBeVisible()
}

test('editing a legacy sheet promotes it to a named workbook and saves ordered literal tabs', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const stamp = Date.now().toString(36)
  const name = `workbook-promotion-${stamp}.xlsx`
  try {
    const artifact = await createArtifact(owner.page, name, {
      type: 'sheet', columns: ['Metric', 'Value'], rows: [['Revenue', '00042']],
    })
    await owner.page.goto(`/artifacts/${artifact.id}`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()

    const editor = detail.locator('[data-structured-artifact-editor]')
    await expect(editor).toHaveAttribute('data-structured-artifact-editor', 'sheet')
    const tabs = editor.getByRole('tablist', { name: 'Worksheets', exact: true })
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await expect(tabs.getByRole('tab', { name: 'Sheet', exact: true })).toHaveAttribute('aria-selected', 'true')
    await editor.getByRole('textbox', { name: 'Worksheet name', exact: true }).fill('Summary')
    await expect(editor).toHaveAttribute('data-structured-artifact-editor', 'workbook')
    await editor.getByRole('button', { name: 'Add worksheet', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: 'Sheet 2', exact: true })).toHaveAttribute('aria-selected', 'true')
    await editor.getByRole('textbox', { name: 'Worksheet name', exact: true }).fill('Details & values')
    await editor.getByRole('textbox', { name: 'Sheet column 1', exact: true }).fill('Expression')
    await editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true }).fill('=1+1')
    await editor.getByRole('button', { name: 'Move worksheet earlier', exact: true }).click()
    await expect(tabs.getByRole('tab').nth(0)).toHaveAccessibleName('Details & values')

    await editor.getByRole('button', { name: 'Remove worksheet', exact: true }).click()
    await expect(editor.getByRole('status')).toContainText('Removed “Details & values”')
    await editor.getByRole('button', { name: 'Undo removal', exact: true }).click()
    await expect(tabs.getByRole('tab').nth(0)).toHaveAccessibleName('Details & values')
    await expect(tabs.getByRole('tab').nth(1)).toHaveAccessibleName('Summary')
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)

    const saved = await savedContent(owner.page, artifact.id)
    expect(saved?.type).toBe('workbook')
    if (!saved || saved.type !== 'workbook') throw new Error('saved content must be a workbook')
    expect(saved.sheets.map((sheet) => sheet.name)).toEqual(['Details & values', 'Summary'])
    expect(saved.sheets[0]?.rows).toEqual([['=1+1']])
    expect(saved.sheets[1]?.rows).toEqual([['Revenue', '00042']])

    await owner.page.reload()
    await expect(detail).toBeVisible()
    const readTabs = detail.getByRole('tablist', { name: 'Worksheets', exact: true })
    expect(await readTabs.getByRole('tab').allTextContents()).toEqual(['Details & values', 'Summary'])
    const exported = await exportText(owner.page, name)
    expect(exported.indexOf('Sheet: "Details & values"')).toBeGreaterThanOrEqual(0)
    expect(exported.indexOf('Sheet: "Summary"')).toBeGreaterThan(exported.indexOf('Sheet: "Details & values"'))
    expect(exported).toContain('A2: "=1+1"')
    expect(exported).toContain('B2: "00042"')
  } finally {
    await owner.context.close()
  }
})

test('a shared workbook reader can navigate tabs but cannot edit; foreign viewers stay walled', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  const stamp = Date.now().toString(36)
  const name = `shared-workbook-${stamp}.xlsx`
  try {
    const artifact = await createArtifact(owner.page, name, {
      type: 'workbook', sheets: [
        { id: 'summary', name: 'Summary', columns: ['Status'], rows: [['Ready']] },
        { id: 'details', name: 'Details', columns: ['Literal'], rows: [['=1+1']] },
      ],
    })
    await grantRead(owner.page, artifact.id)
    await reader.page.goto(`/artifacts/${artifact.id}`)
    const detail = reader.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    const tabs = detail.getByRole('tablist', { name: 'Worksheets', exact: true })
    const summary = tabs.getByRole('tab', { name: 'Summary', exact: true })
    const details = tabs.getByRole('tab', { name: 'Details', exact: true })
    await summary.focus()
    await summary.press('End')
    await expect(details).toHaveAttribute('aria-selected', 'true')
    await details.press('Home')
    await expect(summary).toHaveAttribute('aria-selected', 'true')
    await expect(detail.getByRole('button', { name: 'Edit sheet', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('textbox', { name: 'Worksheet name', exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Download XLSX', exact: true })).toBeVisible()

    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(foreign.page.getByRole('tablist', { name: 'Worksheets', exact: true })).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('owner editor/read and shared/foreign workbook views stay contained across the viewport ladder', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  const stamp = Date.now().toString(36)
  try {
    const artifact = await createArtifact(owner.page, `workbook-viewports-${stamp}.xlsx`, {
      type: 'workbook', sheets: [
        { id: 'long-one', name: 'Worksheet long label wraps well', columns: ['Metric', 'Value'], rows: [['Revenue', '00042']] },
        { id: 'long-two', name: 'Second tab label wraps cleanly', columns: ['Literal'], rows: [['=1+1']] },
      ],
    })
    await grantRead(owner.page, artifact.id)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    await expect(detail.locator('[data-structured-artifact-editor="workbook"]')).toBeVisible()
    for (const viewport of VIEWPORTS) await checkViewport(owner.page, testInfo, `workbook-owner-editor`, viewport)
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)
    for (const viewport of VIEWPORTS) await checkViewport(owner.page, testInfo, `workbook-owner-read`, viewport)

    await reader.page.goto(`/artifacts/${artifact.id}`)
    const readerDetail = reader.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(readerDetail).toBeVisible()
    for (const viewport of VIEWPORTS) await checkViewport(reader.page, testInfo, `workbook-shared-reader`, viewport)

    await foreign.page.goto(`/artifacts/${artifact.id}`)
    const denied = foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).', { exact: true })
    for (const viewport of VIEWPORTS) {
      await foreign.page.setViewportSize(viewport)
      await settleArtifactPageRail(foreign.page)
      await expect.poll(() => foreign.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await expect(denied).toBeVisible()
      await expect(foreign.page.getByRole('tablist', { name: 'Worksheets', exact: true })).toHaveCount(0)
    }
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('twenty long worksheet names remain keyboard navigable at narrow width', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const stamp = Date.now().toString(36)
  try {
    const sheets = Array.from({ length: 20 }, (_, index) => ({
      id: `sheet-${index + 1}`,
      name: `Worksheet ${String(index + 1).padStart(2, '0')} with long label`,
      columns: ['Value'],
      rows: [[`value-${index + 1}`]],
    }))
    const artifact = await createArtifact(owner.page, `twenty-tabs-${stamp}.xlsx`, { type: 'workbook', sheets })
    await owner.page.goto(`/artifacts/${artifact.id}`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const tabs = detail.locator('[data-structured-artifact-editor="workbook"]').getByRole('tablist', { name: 'Worksheets', exact: true })
    await expect(tabs.getByRole('tab')).toHaveCount(20)
    await owner.page.setViewportSize(VIEWPORTS[0])
    await settleArtifactPageRail(owner.page)
    const first = tabs.getByRole('tab').first()
    const last = tabs.getByRole('tab').last()
    await first.focus()
    await first.press('End')
    await expect(last).toHaveAttribute('aria-selected', 'true')
    await expect(last).toBeFocused()
    await last.press('Home')
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await expect(first).toBeFocused()
    await last.press('ArrowRight')
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(owner.page, 'Twenty worksheet tabs at 320x700')
    await owner.page.screenshot({ path: testInfo.outputPath('workbook-twenty-tabs-320x700.png') })
  } finally {
    await owner.context.close()
  }
})

test('an uncertain workbook save stays held across navigation and retries the exact whole-body write', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const name = `workbook-recovery-${stamp}.xlsx`
  const artifact = await createArtifact(page, name, {
    type: 'workbook', sheets: [
      { id: 'summary', name: 'Summary', columns: ['Status'], rows: [['Ready']] },
      { id: 'details', name: 'Details', columns: ['Literal'], rows: [['Original']] },
    ],
  })
  const requests: Array<{ key: string; body: unknown }> = []
  let retryKey: string | null = null
  await page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    const key = route.request().headers()['idempotency-key'] ?? ''
    requests.push({ key, body: route.request().postDataJSON() })
    if (retryKey === key) return route.continue()
    await route.abort('failed')
  })
  try {
    await page.goto(`/artifacts/${artifact.id}`)
    const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const editor = detail.locator('[data-structured-artifact-editor="workbook"]')
    await editor.getByRole('tab', { name: 'Details', exact: true }).click()
    const heldCell = editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })
    await heldCell.fill(`held-${stamp}`)
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="structured-artifact"]')
    await expect(notice).toContainText('Couldn’t confirm the content edit')
    await expect(heldCell).toBeDisabled()
    await leaveAndReturnToArtifact(page, artifact.id, name)
    const returnedDetail = page.locator(`[data-artifact-page="${artifact.id}"]`)
    const returnedEditor = returnedDetail.locator('[data-structured-artifact-editor="workbook"]')
    const draftTabs = returnedEditor.locator(':scope > div > [data-workbook-tabs]')
    await draftTabs.getByRole('tab', { name: 'Details', exact: true }).click()
    const returnedCell = returnedEditor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })
    await expect(returnedCell).toHaveValue(`held-${stamp}`)
    await expect(returnedCell).toBeDisabled()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.key).toBeTruthy()
    retryKey = requests[0]!.key
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(notice).toHaveCount(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.key).toBe(requests[0]!.key)
    expect(requests[1]!.body).toEqual(requests[0]!.body)
    const saved = await savedContent(page, artifact.id)
    expect(saved?.type).toBe('workbook')
    if (!saved || saved.type !== 'workbook') throw new Error('retried content must remain a workbook')
    expect(saved.sheets[1]?.rows[0]?.[0]).toBe(`held-${stamp}`)
  } finally {
    await page.unroute(`**${API}/artifacts/${artifact.id}/content`)
  }
})

test('XLSX import can adopt all visible worksheets into one authored workbook', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await expect(dialog.getByRole('region', { name: 'Import spreadsheet data', exact: true })).toBeVisible()
  const choosing = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await (await choosing).setFiles({
    name: `workbook-source-${stamp}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsxFixture({ sheets: [
      { name: 'Overview', rows: [['Metric', 'Value'], ['Revenue', '00042']] },
      { name: 'Hidden', state: 'hidden', rows: [['Exclude me']] },
      { name: 'Expressions', rows: [['Formula text'], ['=1+1']] },
    ] }),
  })
  await dialog.getByLabel('Import scope', { exact: true }).selectOption({ label: 'All visible worksheets' })
  const preview = dialog.getByRole('region', { name: 'Imported workbook', exact: true })
  await expect(preview.getByRole('tablist', { name: 'Worksheets', exact: true }).getByRole('tab')).toHaveCount(2)
  await expect(preview).toContainText('Revenue')
  await expect(preview).not.toContainText('Exclude me')
  await dialog.getByRole('button', { name: 'Use imported workbook', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toHaveValue('Overview')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`adopted-workbook-${stamp}.xlsx`)
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const artifactId = page.url().split('/').at(-1)!
  const saved = await savedContent(page, artifactId)
  expect(saved?.type).toBe('workbook')
  if (!saved || saved.type !== 'workbook') throw new Error('all-visible import must save a workbook')
  expect(saved.sheets.map((sheet) => sheet.name)).toEqual(['Overview', 'Expressions'])
  expect(saved.sheets[0]?.rows).toContainEqual(['Revenue', '00042'])
  expect(saved.sheets[1]?.rows).toContainEqual(['=1+1'])
})
