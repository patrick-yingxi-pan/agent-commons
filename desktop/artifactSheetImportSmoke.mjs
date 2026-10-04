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
    const headers = sheetDialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
    await expect(headers).toBeChecked()
    if (!imported.firstRowHeaders) {
      await headers.click()
      await expect(headers).not.toBeChecked()
    }
    const importedRegion = sheetDialog.getByRole('region', { name: 'Imported sheet', exact: true })
    await expect(importedRegion).toContainText(imported.body.columns[0])
    await expect(importedRegion).toContainText(imported.body.rows[0][0])
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
    await sheetDialog.getByRole('button', { name: 'Use imported sheet', exact: true }).click()
    for (const [index, column] of imported.body.columns.entries()) {
      await expect(sheetDialog.getByRole('textbox', { name: `Sheet column ${index + 1}`, exact: true })).toHaveValue(column)
    }
    for (const [rowIndex, row] of imported.body.rows.entries()) {
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
  }
  console.log('[desktop-artifact-sheet-import-smoke] native dialog result · real CSV/TSV/XLSX readers + IPC · worksheet selection · quoted/literal cells · header mapping · explicit adoption · exact saved sheet bodies')
  return importedSheets
}
