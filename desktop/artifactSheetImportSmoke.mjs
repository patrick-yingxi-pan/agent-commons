import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'

function artifactIdFromCanonicalUrl(page) {
  const match = new URL(page.url()).pathname.match(/^\/artifacts\/([^/]+)$/u)
  assert.ok(match, `created sheet did not navigate to a canonical artifact URL: ${page.url()}`)
  return decodeURIComponent(match[1])
}

/** Packaged native CSV/TSV/XLSX artifact acceptance. The caller supplies only the
 * existing real dialog/picker helpers; all reads, IPC, review and persistence
 * remain the packaged product path. */
export async function runArtifactSheetImportSmoke({ page, app, origin, fixtureRoot, openArtifactImportDialog, chooseNativeArtifactFile }) {
  const importedSheets = [
    {
      path: join(fixtureRoot, 'native-artifact-quoted.csv'),
      name: 'native-artifact-quoted.xlsx',
      source: 'Name,Value\n"Ada, Lovelace","=SUM(A1:A2)"\n"Literal ""quote""","0012"\n',
      body: {
        type: 'sheet', revision: 0,
        columns: ['Name', 'Value'],
        rows: [['Ada, Lovelace', '=SUM(A1:A2)'], ['Literal "quote"', '0012']],
      },
      firstRowHeaders: true,
    },
    {
      path: join(fixtureRoot, 'native-artifact-headerless.tsv'),
      name: 'native-artifact-headerless.xlsx',
      source: 'Ada\t001\nGrace\t=SUM(B1:B2)\n',
      body: {
        type: 'sheet', revision: 0,
        columns: ['Column A', 'Column B'],
        rows: [['Ada', '001'], ['Grace', '=SUM(B1:B2)']],
      },
      firstRowHeaders: false,
    },
    {
      path: join(fixtureRoot, 'native-artifact-workbook.xlsx'),
      name: 'native-artifact-workbook.xlsx',
      source: xlsxFixture({ sheets: [
        { name: 'Unselected', rows: [['Source', 'Value'], ['unselected-only', 'not adopted']] },
        { name: 'Hidden', state: 'hidden', rows: [['hidden-only', 'must not appear']] },
        { name: 'Selected values', rows: [
          ['Name', 'Code', 'Cached formula'],
          ['\ufeffliteral & <value>', '00123', { formula: '40+2', cached: 42 }],
        ] },
      ] }),
      body: {
        type: 'sheet', revision: 0,
        columns: ['Name', 'Code', 'Cached formula'],
        rows: [['\ufeffliteral & <value>', '00123', '42']],
      },
      firstRowHeaders: true,
      worksheet: 'Selected values',
    },
    {
      path: join(fixtureRoot, 'native-artifact-multi-tab-workbook.xlsx'),
      name: 'native-artifact-multi-tab-workbook.xlsx',
      source: xlsxFixture({ sheets: [
        { name: 'Overview', rows: [['Metric', 'Value'], ['Revenue', '00042']] },
        { name: 'Hidden', state: 'hidden', rows: [['Hidden-only', 'must not appear']] },
        { name: 'Expressions', rows: [['Name', 'Result'], ['Cached formula', { formula: '40+2', cached: 42 }]] },
      ] }),
      body: {
        type: 'workbook', revision: 0,
        sheets: [
          { id: 'source-sheet-1', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Revenue', '00042']] },
          { id: 'source-sheet-3', name: 'Expressions', columns: ['Name', 'Result'], rows: [['Cached formula', '42']] },
        ],
      },
      firstRowHeaders: true,
      allVisible: true,
    },
  ]
  await Promise.all(importedSheets.map((imported) => writeFile(imported.path, imported.source, { mode: 0o600 })))
  for (const imported of importedSheets) {
    const sheetDialog = await openArtifactImportDialog(page, origin)
    await sheetDialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Sheet' })
    await chooseNativeArtifactFile(app, sheetDialog, imported.path)
    if (imported.worksheet) {
      const worksheet = sheetDialog.getByRole('combobox', { name: 'Worksheet', exact: true })
      await expect(worksheet).toHaveValue('1')
      await expect(worksheet.locator('option')).toHaveCount(2)
      await worksheet.selectOption({ label: imported.worksheet })
      await expect(worksheet).toHaveValue('3')
    }
    if (imported.allVisible) {
      await sheetDialog.getByLabel('Import scope', { exact: true }).selectOption({ label: 'All visible worksheets' })
      const workbookPreview = sheetDialog.getByRole('region', { name: 'Imported workbook', exact: true })
      const previewTabs = workbookPreview.getByRole('tablist', { name: 'Worksheets', exact: true })
      await expect(previewTabs.getByRole('tab')).toHaveText(['Overview', 'Expressions'])
      await expect(previewTabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(workbookPreview.locator('table thead th')).toHaveText(['Metric', 'Value'])
      await expect(workbookPreview.locator('table tbody td')).toHaveText(['Revenue', '00042'])
      await previewTabs.getByRole('tab', { name: 'Expressions', exact: true }).click()
      await expect(workbookPreview.locator('table thead th')).toHaveText(['Name', 'Result'])
      await expect(workbookPreview.locator('table tbody td')).toHaveText(['Cached formula', '42'])
      await expect(workbookPreview).toContainText(/all 2 visible worksheets in source order/i)
      await expect(workbookPreview).toContainText(/1 hidden sheet is omitted/i)
      await expect(workbookPreview).not.toContainText('must not appear')
      await previewTabs.getByRole('tab', { name: 'Overview', exact: true }).click()
      await expect(previewTabs.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
    }
    const headers = sheetDialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
    await expect(headers).toBeChecked()
    if (!imported.firstRowHeaders) {
      await headers.click()
      await expect(headers).not.toBeChecked()
    }
    const firstGrid = imported.body.type === 'workbook' ? imported.body.sheets[0] : imported.body
    const importedRegion = sheetDialog.getByRole('region', { name: imported.allVisible ? 'Imported workbook' : 'Imported sheet', exact: true })
    await expect(importedRegion).toContainText(firstGrid.columns[0])
    await expect(importedRegion).toContainText(firstGrid.rows[0][0])
    if (imported.worksheet) {
      await expect(importedRegion).toContainText('00123')
      await expect(importedRegion).toContainText('42')
      await expect(importedRegion).not.toContainText('unselected-only')
      await expect(importedRegion).not.toContainText('not adopted')
      await expect(importedRegion).not.toContainText('hidden-only')
      await expect(importedRegion).not.toContainText('must not appear')
    }
    await expect(sheetDialog.getByLabel('Name', { exact: true })).toHaveValue('')
    await expect(sheetDialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
    await sheetDialog.getByRole('button', { name: imported.allVisible ? 'Use imported workbook' : 'Use imported sheet', exact: true }).click()
    if (imported.allVisible) {
      const editorTabs = sheetDialog.getByRole('tablist', { name: 'Worksheets', exact: true })
      await expect(editorTabs.getByRole('tab')).toHaveText(['Overview', 'Expressions'])
      await expect(sheetDialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toHaveValue('Overview')
      await editorTabs.getByRole('tab', { name: 'Expressions', exact: true }).click()
      await expect(sheetDialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toHaveValue('Expressions')
      await expect(sheetDialog.getByRole('textbox', { name: 'Sheet row 1 value 1', exact: true })).toHaveValue('Cached formula')
      await expect(sheetDialog.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })).toHaveValue('42')
      await editorTabs.getByRole('tab', { name: 'Overview', exact: true }).click()
      await expect(sheetDialog.getByRole('textbox', { name: 'Worksheet name', exact: true })).toHaveValue('Overview')
    }
    for (const [index, column] of firstGrid.columns.entries()) {
      await expect(sheetDialog.getByRole('textbox', { name: `Sheet column ${index + 1}`, exact: true })).toHaveValue(column)
    }
    for (const [rowIndex, row] of firstGrid.rows.entries()) {
      for (const [columnIndex, cell] of row.entries()) {
        await expect(sheetDialog.getByRole('textbox', { name: `Sheet row ${rowIndex + 1} value ${columnIndex + 1}`, exact: true })).toHaveValue(cell)
      }
    }
    await expect(sheetDialog.getByLabel('Name', { exact: true })).toHaveValue(imported.name)
    await expect(sheetDialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeEnabled()
    await sheetDialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
    await expect(sheetDialog).toHaveCount(0)
    const id = artifactIdFromCanonicalUrl(page)
    await expect(page.getByRole('heading', { name: imported.name, exact: true })).toBeVisible()
    const saved = await page.evaluate(async (artifactId) => {
      const artifactResponse = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`)
      const contentsResponse = await fetch('/api/v1/artifact-content')
      if (!artifactResponse.ok || !contentsResponse.ok) throw new Error('Imported sheet reads failed.')
      return { artifact: await artifactResponse.json(), body: (await contentsResponse.json())[artifactId] }
    }, id)
    assert.equal(saved.artifact.id, id, 'canonical URL identity is the exact registry identity')
    assert.equal(saved.artifact.kind, 'sheet')
    assert.deepEqual(saved.body, imported.body)
    imported.id = id
    if (imported.allVisible) {
      await page.getByRole('button', { name: 'Edit sheet', exact: true }).click()
      const editor = page.locator('[data-structured-artifact-editor]')
      const cell = editor.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })
      // Fixture only the clipboard event, without touching the user's OS clipboard.
      // The built editor, validation, explicit Save and durable body are real.
      const paste = async text => cell.evaluate((node, source) => {
        const clipboardData = new DataTransfer()
        clipboardData.setData('text/plain', source)
        node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
      }, text)
      const text = '0007\t=1+1\n"line one\nline two"\t'
      await paste(text)
      await expect(editor.getByRole('status')).toContainText('Pasted 2 × 2 cells')
      await expect(cell).toHaveValue('0007')
      await editor.getByRole('button', { name: 'Undo paste', exact: true }).click()
      await expect(cell).toHaveValue('00042')
      await expect(editor.getByRole('textbox', { name: 'Sheet column 3', exact: true })).toHaveCount(0)
      await paste(text)
      await paste('bad\tshape\nshort')
      await expect(editor.getByRole('status')).toContainText('Nothing was pasted.')
      await expect(cell).toHaveValue('0007')
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(editor).toHaveCount(0)
      imported.body = {
        ...imported.body, revision: 1,
        sheets: imported.body.sheets.map((sheet, index) => index === 0 ? {
          ...sheet, columns: ['Metric', 'Value', 'Column 3'],
          rows: [['Revenue', '0007', '=1+1'], ['', 'line one\nline two', '']],
        } : sheet),
      }
      const updated = await page.evaluate(async artifactId => {
        const response = await fetch('/api/v1/artifact-content')
        if (!response.ok) throw new Error('Pasted workbook read failed.')
        return (await response.json())[artifactId]
      }, id)
      assert.deepEqual(updated, imported.body, 'range paste preserves the second tab and saves one literal revision')
    }
  }
  console.log('[desktop-artifact-sheet-import-smoke] native dialog result · real CSV/TSV/XLSX readers + IPC · worksheet/all-visible selection · quoted/literal cells · header mapping · explicit adoption · range paste/Undo/refusal/Save · exact saved Sheet and workbook bodies')
  return importedSheets
}
