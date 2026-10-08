import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { pdfOcrFixture } from './pdfOcrFixture.mjs'
import { docBlockId } from '../server/documentIdentity.ts'

const OCR_TEXT = '[Page 1]\nScan Alpha 427\n\n[Page 2]\nScan Bravo 813'
const CORRECTED_TEXT = '[Page 1]\nScan Alpine 427\n\n[Page 2]\nScan Bravo 813'
const DRAFT_TEXT = 'Keep this PDF draft until adoption.'

async function chooseNativeOcrPdf(app, path) {
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async (_owner, options) => {
      if (options.title !== 'Extract PDF text' || options.properties.join(',') !== 'openFile' ||
          options.filters?.length !== 1 || options.filters[0].name !== 'PDF documents' ||
          options.filters[0].extensions.join(',') !== 'pdf') {
        throw new Error('Expected the single-PDF native OCR selection dialog')
      }
      return selectedPath
        ? { canceled: false, filePaths: [selectedPath] }
        : { canceled: true, filePaths: [] }
    }
  }, path)
}

async function readSavedDocuments(page) {
  return page.evaluate(async () => {
    const artifactsResponse = await fetch('/api/v1/artifacts')
    const contentsResponse = await fetch('/api/v1/artifact-content')
    if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('PDF OCR artifact reads failed.')
    return { artifacts: await artifactsResponse.json(), bodies: await contentsResponse.json() }
  })
}

/** Packaged scanned-PDF acceptance. Only the native chooser return is
 * controlled; selected-file reading, IPC, PDF rendering, Vision OCR, review,
 * adoption and persistence all run through the packaged product. */
export async function runArtifactPdfOcrSmoke({ page, app, origin, fixtureRoot, openArtifactImportDialog }) {
  const scannedPath = join(fixtureRoot, 'native-artifact-pdf-ocr.pdf')
  const blankPath = join(fixtureRoot, 'native-artifact-pdf-blank.pdf')
  const protectedPath = join(fixtureRoot, 'native-artifact-pdf-protected.pdf')
  await Promise.all([
    writeFile(scannedPath, await pdfOcrFixture({ mode: 'scanned' }), { mode: 0o600 }),
    writeFile(blankPath, await pdfOcrFixture({ mode: 'blank' }), { mode: 0o600 }),
    writeFile(protectedPath, await pdfOcrFixture({ mode: 'protected' }), { mode: 0o600 }),
  ])

  const dialog = await openArtifactImportDialog(page, origin)
  await dialog.getByLabel('Name', { exact: true }).fill('native-artifact-pdf-ocr.md')
  await dialog.getByLabel('Content', { exact: true }).fill(DRAFT_TEXT)
  const initial = await readSavedDocuments(page)
  const productRequests = []
  const captureProductRequest = (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) productRequests.push(new URL(request.url()).pathname)
  }
  page.on('request', captureProductRequest)

  await chooseNativeOcrPdf(app, null)
  await dialog.getByRole('button', { name: 'Extract PDF text', exact: true }).click()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-pdf-ocr.md')
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()
  assert.deepEqual(await readSavedDocuments(page), initial, 'cancelled native PDF selection does not write an artifact')

  await chooseNativeOcrPdf(app, blankPath)
  await dialog.getByRole('button', { name: 'Extract PDF text', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('No readable text was recognized on any of the 2 PDF pages')
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-pdf-ocr.md')
  assert.deepEqual(await readSavedDocuments(page), initial, 'blank PDF no-text result leaves saved artifacts unchanged')

  await chooseNativeOcrPdf(app, protectedPath)
  await dialog.getByRole('button', { name: 'Extract PDF text', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('password-protected or restricted', { timeout: 30_000 })
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-pdf-ocr.md')
  assert.deepEqual(await readSavedDocuments(page), initial, 'protected PDF refusal leaves saved artifacts unchanged')

  await chooseNativeOcrPdf(app, scannedPath)
  await dialog.getByRole('button', { name: 'Extract PDF text', exact: true }).click()
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveValue(OCR_TEXT, { timeout: 30_000 })
  await expect(dialog.getByText('All 2 PDF pages were processed on this Mac; text was recognized on 2 pages.', { exact: false })).toBeVisible()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-pdf-ocr.md')
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByRole('button', { name: 'Replace content with imported text', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  assert.deepEqual(await readSavedDocuments(page), initial, 'real multi-page OCR review makes no artifact write')
  page.off('request', captureProductRequest)
  assert.deepEqual(productRequests, [], 'selection, cancellation, refusal and OCR make no product/model/upload request')

  await dialog.getByRole('button', { name: 'Replace content with imported text', exact: true }).click()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(OCR_TEXT)
  await dialog.getByLabel('Content', { exact: true }).fill(CORRECTED_TEXT)
  assert.deepEqual(await readSavedDocuments(page), initial, 'explicit adoption and correction remain a local draft')
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'native-artifact-pdf-ocr.md', exact: true })).toBeVisible()

  const saved = await readSavedDocuments(page)
  const artifact = saved.artifacts.find((candidate) => candidate.name === 'native-artifact-pdf-ocr.md')
  assert.ok(artifact, 'explicit Create document writes the reviewed PDF-text draft')
  assert.equal(artifact.kind, 'doc')
  const body = {
    type: 'doc', title: 'native-artifact-pdf-ocr',
    blocks: [
      { id: docBlockId(artifact.id, 0, 0), p: '[Page 1] Scan Alpine 427' },
      { id: docBlockId(artifact.id, 0, 1), p: '[Page 2] Scan Bravo 813' },
    ], revision: 0,
  }
  assert.deepEqual(saved.bodies[artifact.id], body, 'saved body contains both OCR pages and only the corrected user draft')
  assert.equal(JSON.stringify(saved.bodies[artifact.id]).includes('%PDF-'), false)
  console.log('[desktop-artifact-pdf-ocr-smoke] native Extract PDF text dialog · generated scanned two-page PDF + Vision OCR · cancel/blank/protected inert · all-page count/review · explicit adopt/correct/create · exact ordinary Document body')
  return { id: artifact.id, path: scannedPath, name: artifact.name, body: saved.bodies[artifact.id] }
}
