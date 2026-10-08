/** Rendered TSV range-paste acceptance for shared sheet authoring fields. */
import { readFile } from 'node:fs/promises'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactContent, ArtifactItem } from '../contract/index.ts'
import { extractXlsx } from '../src/lib/xlsxExtraction.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { splitPane } from './pane-actions.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

const ORIGINAL = {
  type: 'workbook' as const,
  sheets: [
    { id: 'summary', name: 'Summary', columns: ['Label', 'Value'], rows: [['Keep', 'A'], ['Target', 'Before']], note: 'Keep this note.' },
    { id: 'details', name: 'Details', columns: ['Literal'], rows: [['Other tab stays']], note: 'Other note stays.' },
  ],
}

const RANGE = '00042\t=1+1\t"quoted\tvalue"\r\n"line one\nline two"\ttext\tend'

async function createArtifact(page: Page, name: string, body: ArtifactContent) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'sheet', meta: 'Sheet', body } } },
    headers: { 'Idempotency-Key': `sheet-paste-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function savedContent(page: Page, id: string) {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBeTruthy()
  const library = await response.json() as Record<string, ArtifactContent>
  return library[id]
}

async function writeClipboard(page: Page, value: string) {
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), value)
}

async function pasteFromClipboard(page: Page, cell: ReturnType<Page['getByRole']>, value: string) {
  await writeClipboard(page, value)
  await cell.focus()
  await cell.press('ControlOrMeta+V')
}

async function exportXlsx(page: Page, filename: string) {
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

async function enterWorkbookEdit(page: Page, artifactId: string) {
  await page.goto(`/artifacts/${artifactId}`)
  const detail = page.locator(`[data-artifact-page="${artifactId}"]`)
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
  const editor = detail.locator('[data-structured-artifact-editor="workbook"]')
  await expect(editor).toBeVisible()
  const history = detail.locator('[data-artifact-draft-history]')
  await expect(history).toBeVisible()
  return { detail, editor, history }
}

async function expectOriginalSummary(editor: ReturnType<Page['locator']>) {
  await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Keep')
  await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('Before')
  await expect(editor.getByRole('textbox', { name: 'Sheet note', exact: true })).toHaveValue('Keep this note.')
  await expect(editor.getByRole('textbox', { name: 'Sheet column 3', exact: true })).toHaveCount(0)
  await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 1', exact: true })).toHaveCount(0)
}

test('shared creation fields paste literal TSV while single-line clipboard text keeps normal selection behavior', async ({ page, context }) => {
  test.setTimeout(ms(60_000))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const stamp = Date.now().toString(36)
  const name = `pasted-created-${stamp}.xlsx`
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Sheet' })
  const first = dialog.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })
  await dialog.getByRole('textbox', { name: 'Sheet column 1', exact: true }).fill('Literal values')
  await first.fill('selected text')
  await first.press('ControlOrMeta+A')
  await pasteFromClipboard(page, first, 'plain replacement')
  await expect(first).toHaveValue('plain replacement')
  await expect(dialog.getByText(/Pasted \d+ × \d+ cells into this draft\./)).toHaveCount(0)

  await pasteFromClipboard(page, first, '00042\t=1+1\r\n"quoted\tvalue"\t"line one\nline two"')
  await expect(dialog.getByText('Pasted 2 × 2 cells into this draft.', { exact: true })).toBeVisible()
  await expect(first).toHaveValue('00042')
  await expect(dialog.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })).toHaveValue('=1+1')
  await expect(dialog.getByRole('textbox', { name: 'Sheet row 2 value 1', exact: true })).toHaveValue('quoted\tvalue')
  await expect(dialog.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('line one\nline two')
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const artifactId = page.url().split('/').at(-1)!
  const saved = await savedContent(page, artifactId)
  expect(saved).toMatchObject({ type: 'sheet', columns: ['Literal values', 'Column 2'], rows: [['00042', '=1+1'], ['quoted\tvalue', 'line one\nline two']] })

  await page.reload()
  await expect(page.locator(`[data-artifact-page="${artifactId}"]`)).toBeVisible()
  const exported = await exportXlsx(page, name)
  expect(exported).toContain('A2: "00042"')
  expect(exported).toContain('B2: "=1+1"')
  expect(exported).toContain(`A3: ${JSON.stringify('quoted\tvalue')}`)
  expect(exported).toContain(`B3: ${JSON.stringify('line one\nline two')}`)
})

test('owner workbook edits support bounded paste, undo, rejection, held save, reload/export, and cancel', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const stamp = Date.now().toString(36)
  const name = `paste-workbook-${stamp}.xlsx`
  try {
    const artifact = await createArtifact(owner.page, name, ORIGINAL)
    const { detail, editor, history } = await enterWorkbookEdit(owner.page, artifact.id)
    const summary = editor.getByRole('tab', { name: 'Summary', exact: true })
    const details = editor.getByRole('tab', { name: 'Details', exact: true })
    const target = editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })

    await pasteFromClipboard(owner.page, target, RANGE)
    await expect(editor.getByText('Pasted 2 × 3 cells into this draft.', { exact: true })).toBeVisible()
    await expect(target).toHaveValue('00042')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 3', exact: true })).toHaveValue('=1+1')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 4', exact: true })).toHaveValue('quoted\tvalue')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 2', exact: true })).toHaveValue('line one\nline two')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 3', exact: true })).toHaveValue('text')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 4', exact: true })).toHaveValue('end')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Keep')
    await expect(editor.getByRole('textbox', { name: 'Sheet note', exact: true })).toHaveValue('Keep this note.')
    await pasteFromClipboard(owner.page, target, 'one\ttwo\nthree')
    await expect(editor.getByText('Use a rectangular table with tabs between cells and valid quoted values. Nothing was pasted.', { exact: true })).toBeVisible()
    await expect(target).toHaveValue('00042')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 4', exact: true })).toHaveValue('quoted\tvalue')
    await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await history.getByRole('button', { name: 'Undo', exact: true }).click()
    await expectOriginalSummary(editor)

    await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }), RANGE)
    await details.click()
    await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Other tab stays')
    await expect(editor.getByRole('textbox', { name: 'Sheet note', exact: true })).toHaveValue('Other note stays.')
    await summary.click()
    await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('00042')

    await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }), 'one\ttwo\nthree')
    await expect(editor.getByText('Use a rectangular table with tabs between cells and valid quoted values. Nothing was pasted.', { exact: true })).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('00042')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 3', exact: true })).toHaveValue('=1+1')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 4', exact: true })).toHaveValue('end')

    await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }), `${'x'.repeat(256 * 1024 + 1)}\tvalue`)
    await expect(editor.getByText('Paste up to 256 KiB of tab-separated text at once. Nothing was pasted.', { exact: true })).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('00042')
    await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 4', exact: true })).toHaveValue('end')

    // A save in flight disables draft controls, including a still-available undo.
    await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }), RANGE)
    let releaseSave!: () => void
    let reachedSave!: () => void
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    const saveReached = new Promise<void>((resolve) => { reachedSave = resolve })
    await owner.page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      reachedSave()
      await saveGate
      await route.continue()
    })
    try {
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
      await saveReached
      await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
      await expect(editor.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible()
    } finally {
      releaseSave()
    }
    await expect(detail.locator('[data-structured-artifact-editor]')).toHaveCount(0)
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/content`)

    const saved = await savedContent(owner.page, artifact.id)
    expect(saved).toEqual({ type: 'workbook', revision: 1, sheets: [
      { id: 'summary', name: 'Summary', columns: ['Label', 'Value', 'Column 3', 'Column 4'], rows: [['Keep', 'A', '', ''], ['Target', '00042', '=1+1', 'quoted\tvalue'], ['', 'line one\nline two', 'text', 'end']], note: 'Keep this note.' },
      { id: 'details', name: 'Details', columns: ['Literal'], rows: [['Other tab stays']], note: 'Other note stays.' },
    ] })
    await owner.page.reload()
    await expect(detail).toBeVisible()
    const exported = await exportXlsx(owner.page, name)
    expect(exported).toContain('B3: "00042"')
    expect(exported).toContain('C3: "=1+1"')
    expect(exported).toContain(`D3: ${JSON.stringify('quoted\tvalue')}`)
    expect(exported).toContain(`B4: ${JSON.stringify('line one\nline two')}`)

    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const cancelEditor = detail.locator('[data-structured-artifact-editor="workbook"]')
    await cancelEditor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true }).fill('discarded draft')
    let cancelledWrites = 0
    await owner.page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
      if (route.request().method() === 'PATCH') cancelledWrites++
      await route.continue()
    })
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click()
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/content`)
    expect(cancelledWrites).toBe(0)
    expect(await savedContent(owner.page, artifact.id)).toEqual(saved)
  } finally {
    await owner.context.close()
  }
})

test('duplicate workbook panes share sequential undo across the newest edit and an earlier paste', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const stamp = Date.now().toString(36)
  try {
    const artifact = await createArtifact(owner.page, `paste-duplicate-${stamp}.xlsx`, ORIGINAL)
    await enterWorkbookEdit(owner.page, artifact.id)
    await splitPane(owner.page, 'right')
    const panes = owner.page.locator('[data-main-pane]')
    await expect(panes).toHaveCount(2)
    const focusedPane = owner.page.locator('[data-main-pane][data-focused="true"]')
    const focusedIndex = await focusedPane.evaluate((node) => Array.from(document.querySelectorAll('[data-main-pane]')).indexOf(node))
    const focusedEditor = focusedPane.locator('[data-structured-artifact-editor="workbook"]')
    const focusedHistory = focusedPane.locator('[data-artifact-draft-history]')
    const otherPane = panes.nth(focusedIndex === 0 ? 1 : 0)
    const otherEditor = otherPane.locator('[data-structured-artifact-editor="workbook"]')
    const otherHistory = otherPane.locator('[data-artifact-draft-history]')
    await expect(focusedEditor).toBeVisible()
    await expect(otherEditor).toBeVisible()

    await pasteFromClipboard(owner.page, focusedEditor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }), RANGE)
    await expect(focusedHistory.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await expect(otherEditor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('00042')
    const laterEdit = otherEditor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })
    await laterEdit.fill('Later pane edit')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Later pane edit')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 2 value 4', exact: true })).toHaveValue('quoted\tvalue')
    await laterEdit.press('ControlOrMeta+Z')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Keep')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('00042')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 2 value 4', exact: true })).toHaveValue('quoted\tvalue')
    await expect(otherHistory.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()

    await laterEdit.press('ControlOrMeta+Z')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Keep')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })).toHaveValue('Before')
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 2 value 3', exact: true })).toHaveCount(0)
    await expect(focusedEditor.getByRole('textbox', { name: 'Sheet row 3 value 1', exact: true })).toHaveCount(0)
    await expect(otherHistory.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
    expect(await savedContent(owner.page, artifact.id)).toEqual({ ...ORIGINAL, revision: 0 })
  } finally {
    await owner.context.close()
  }
})

test('paste success and all-or-nothing refusal stay accessible and contained across the viewport ladder', async ({ browser }, testInfo: TestInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const stamp = Date.now().toString(36)
  try {
    const artifact = await createArtifact(owner.page, `paste-viewports-${stamp}.xlsx`, ORIGINAL)
    const { editor, history } = await enterWorkbookEdit(owner.page, artifact.id)
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      const size = `${viewport.width}x${viewport.height}`
      const target = editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true })
      await pasteFromClipboard(owner.page, target, 'Left\tRight\r\nBottom\tEnd')
      await expect(editor.getByText('Pasted 2 × 2 cells into this draft.', { exact: true })).toBeVisible()
      await expect(target).toHaveValue('Left')
      await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 3', exact: true })).toHaveValue('End')
      await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(owner.page, `Sheet paste success at ${size}`)
      await owner.page.screenshot({ path: testInfo.outputPath(`sheet-paste-success-${size}.png`) })

      await pasteFromClipboard(owner.page, editor.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }), 'ragged\trow\nshort')
      await expect(editor.getByText('Use a rectangular table with tabs between cells and valid quoted values. Nothing was pasted.', { exact: true })).toBeVisible()
      await expect(target).toHaveValue('Left')
      await expect(editor.getByRole('textbox', { name: 'Sheet row 3 value 3', exact: true })).toHaveValue('End')
      await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
      await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(owner.page, `Sheet paste refusal at ${size}`)
      await owner.page.screenshot({ path: testInfo.outputPath(`sheet-paste-refusal-${size}.png`) })
      await history.getByRole('button', { name: 'Undo', exact: true }).click()
      await expectOriginalSummary(editor)
    }
  } finally {
    await owner.context.close()
  }
})
