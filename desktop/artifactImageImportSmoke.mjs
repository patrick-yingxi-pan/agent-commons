import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { imageOcrFixture } from './imageOcrFixture.mjs'
import { docBlockId } from '../server/documentIdentity.ts'

const OCR_TEXT = 'Cobalt garden 427'
const DRAFT_TEXT = 'Keep this draft until adoption.'
const CORRECTED_TEXT = 'Cobalt garden 427 — verified'

async function chooseNativeOcrImage(app, path) {
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async (_owner, options) => {
      if (options.title !== 'Add photos' || options.properties.join(',') !== 'openFile' ||
          options.filters?.length !== 1 || options.filters[0].name !== 'Images') {
        throw new Error('Expected the single-image native selection dialog')
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
    if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('Image OCR artifact reads failed.')
    return { artifacts: await artifactsResponse.json(), bodies: await contentsResponse.json() }
  })
}

/** Packaged UI acceptance for selected pixels through review and explicit save.
 * Only the native dialog result is controlled; normalization, IPC and OCR are real. */
export async function runArtifactImageImportSmoke({ page, app, origin, fixtureRoot, openArtifactImportDialog }) {
  const readablePath = join(fixtureRoot, 'native-artifact-image-ocr.png')
  const blankPath = join(fixtureRoot, 'native-artifact-image-blank.png')
  await Promise.all([
    writeFile(readablePath, await imageOcrFixture({ text: OCR_TEXT }), { mode: 0o600 }),
    writeFile(blankPath, await imageOcrFixture({ text: '' }), { mode: 0o600 }),
  ])

  const dialog = await openArtifactImportDialog(page, origin)
  await dialog.getByLabel('Name', { exact: true }).fill('native-artifact-image-ocr.md')
  await dialog.getByLabel('Content', { exact: true }).fill(DRAFT_TEXT)
  const initial = await readSavedDocuments(page)
  const productRequests = []
  const captureProductRequest = (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) productRequests.push(new URL(request.url()).pathname)
  }
  page.on('request', captureProductRequest)

  await chooseNativeOcrImage(app, null)
  await dialog.getByRole('button', { name: 'Extract image text', exact: true }).click()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-image-ocr.md')
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()
  assert.deepEqual(await readSavedDocuments(page), initial, 'cancelled native image selection does not write an artifact')

  await chooseNativeOcrImage(app, blankPath)
  await dialog.getByRole('button', { name: 'Extract image text', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('No readable text was found')
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-image-ocr.md')
  assert.deepEqual(await readSavedDocuments(page), initial, 'blank-image no-text result leaves saved artifacts unchanged')

  await chooseNativeOcrImage(app, readablePath)
  await dialog.getByRole('button', { name: 'Extract image text', exact: true }).click()
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveValue(OCR_TEXT, { timeout: 30_000 })
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('native-artifact-image-ocr.md')
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(DRAFT_TEXT)
  await expect(dialog.getByRole('button', { name: 'Replace content with imported text', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  assert.deepEqual(await readSavedDocuments(page), initial, 'real OCR review makes no artifact or content write')
  page.off('request', captureProductRequest)
  assert.deepEqual(productRequests, [], 'picking, cancellation and actual native recognition make no product/model/image-upload write')

  await dialog.getByRole('button', { name: 'Replace content with imported text', exact: true }).click()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(OCR_TEXT)
  await dialog.getByLabel('Content', { exact: true }).fill(CORRECTED_TEXT)
  assert.deepEqual(await readSavedDocuments(page), initial, 'review adoption and correction remain a local draft')
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'native-artifact-image-ocr.md', exact: true })).toBeVisible()

  const saved = await readSavedDocuments(page)
  const artifact = saved.artifacts.find((candidate) => candidate.name === 'native-artifact-image-ocr.md')
  assert.ok(artifact, 'explicit Create document writes the reviewed image-text draft')
  assert.equal(artifact.kind, 'doc')
  assert.deepEqual(saved.bodies[artifact.id], {
    type: 'doc', title: 'native-artifact-image-ocr',
    blocks: [{ id: docBlockId(artifact.id, 0, 0), p: CORRECTED_TEXT }], revision: 0,
  }, 'saved body contains the corrected reviewed text, not the image or uncorrected OCR candidate')
  console.log('[desktop-artifact-image-import-smoke] native Add photos dialog result · generated real PNG pixels · packaged normalization + native OCR IPC · cancel/no-text inert · read-only review · explicit replace/edit/create · exact saved body')
  return { id: artifact.id, path: readablePath, name: artifact.name, body: saved.bodies[artifact.id] }
}
