import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect } from '@playwright/test'
import { settledAttachmentPreview } from '../e2e/accessibility-helpers.ts'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { iconFixture } from '../tests/helpers/bitmapFixture.mjs'
import { svgFixture } from '../tests/helpers/svgFixture.mjs'
import { imageOcrFixture } from './imageOcrFixture.mjs'
import { docBlockId } from '../server/documentIdentity.ts'

const TIMEOUT_MS = 30_000
const LOCAL_IMAGE_OCR_TEXT = 'Folder image text 427'
const LOCAL_IMAGE_OCR_EDITED_TEXT = 'Folder image text 427 — verified'

export async function localImageOcrFixture() {
  return imageOcrFixture({ text: LOCAL_IMAGE_OCR_TEXT })
}

export function localImageBrowseFixture(kind) {
  if (kind === 'png') return { name: 'local-photo.png', bytes: imageFixture(240, 120), width: 240, height: 120 }
  if (kind === 'svg') return { name: 'tracked-photo.svg', bytes: svgFixture(180, 90), width: 180, height: 90 }
  if (kind === 'ico') return { name: 'untracked-photo.ico', bytes: iconFixture(64, 32, { png: true }), width: 64, height: 32 }
  throw new Error(`Unknown local image fixture: ${kind}`)
}

async function workspace(page, sessionId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`Could not read the local image-browse workspace: HTTP ${response.status}`)
    return (await response.json()).workspace
  }, sessionId)
}

async function savedDocuments(page) {
  return page.evaluate(async () => {
    const [artifactsResponse, contentsResponse] = await Promise.all([
      fetch('/api/v1/artifacts'), fetch('/api/v1/artifact-content'),
    ])
    if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('Local image OCR document reads failed.')
    return { artifacts: await artifactsResponse.json(), bodies: await contentsResponse.json() }
  })
}

/** Runs OCR from the already-rendered normalized preview. The generated source
 * is replaced after preview selection and before OCR, so recognition can only
 * succeed when the renderer retained the selected image bytes. */
export async function smokeLocalImageOcrDocument({
  run, browser, root, path, bytes, source, listKind, previewSelector, endpoint, verifySourceMetadata,
}) {
  const sourcePath = join(root, path)
  assert.ok(Buffer.isBuffer(bytes), 'the OCR source is generated PNG fixture bytes')
  assert.deepEqual(await readFile(sourcePath), bytes, `${source} OCR fixture has exact generated PNG bytes`)

  const initial = await savedDocuments(run.page)
  const returnUrl = run.page.url()
  const modelRequestsBefore = endpoint.requests.length
  const writeRequests = []
  const captureWrite = request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writeRequests.push(new URL(request.url()).pathname)
  }
  run.page.on('request', captureWrite)
  try {
    await browser.getByRole('button', { name: `${path} ${listKind}`, exact: true }).click()
    const preview = browser.locator(previewSelector)
    await expect(preview).toContainText(path, { timeout: TIMEOUT_MS })
    const image = browser.getByRole('img', { name: `Preview of ${path}`, exact: true })
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true)
    const capturedPreview = await image.evaluate(node => ({
      src: node.getAttribute('src'), width: node.naturalWidth, height: node.naturalHeight,
    }))
    assert.equal(capturedPreview.width, 1000)
    assert.equal(capturedPreview.height, 240)
    assert.match(capturedPreview.src, /^data:image\/png;base64,/,
      'OCR selection is a normalized PNG preview, regardless of the source connection')

    const changedBytes = Buffer.from(`source replaced before OCR: ${source}:${path}`)
    await writeFile(sourcePath, changedBytes, { mode: 0o600 })
    await verifySourceMetadata?.()
    const extract = browser.getByRole('button', { name: 'Extract text to new document', exact: true })
    await expect(extract).toBeVisible()
    await extract.click()

    const dialog = run.page.getByRole('dialog', { name: 'New artifact', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-local-image-draft]')).toBeVisible()
    const documentName = `${source}-image-ocr.md`
    await dialog.getByLabel('Name', { exact: true }).fill(documentName)
    await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveValue(LOCAL_IMAGE_OCR_TEXT, { timeout: TIMEOUT_MS })
    await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('')
    await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
    assert.deepEqual(await savedDocuments(run.page), initial,
      'captured-preview OCR remains a review draft and creates no document before adoption')
    assert.equal(endpoint.requests.length, modelRequestsBefore, 'on-device image OCR does not call the model')
    assert.deepEqual(writeRequests, [], 'selection and on-device OCR make no product write request')

    await dialog.getByRole('button', { name: 'Use imported text', exact: true }).click()
    await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(LOCAL_IMAGE_OCR_TEXT)
    await dialog.getByLabel('Content', { exact: true }).fill(LOCAL_IMAGE_OCR_EDITED_TEXT)
    assert.deepEqual(await savedDocuments(run.page), initial, 'adoption and correction remain an unsaved draft')
    await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(run.page.getByRole('heading', { name: documentName, exact: true })).toBeVisible()

    const saved = await savedDocuments(run.page)
    const artifact = saved.artifacts.find(candidate => candidate.name === documentName)
    assert.ok(artifact, 'explicit Create document persists the corrected OCR text')
    assert.equal(artifact.kind, 'doc')
    const body = {
      type: 'doc', title: documentName.slice(0, -3),
      blocks: [{ id: docBlockId(artifact.id, 0, 0), p: LOCAL_IMAGE_OCR_EDITED_TEXT }], revision: 0,
    }
    assert.deepEqual(saved.bodies[artifact.id], body, 'saved Document contains the exact edited OCR text')
    assert.equal(endpoint.requests.length, modelRequestsBefore, 'creating the OCR-derived Document makes no model call')
    assert.equal(JSON.stringify(saved).includes(root), false, 'native image paths never enter saved Document state')
    assert.deepEqual(await readFile(sourcePath), changedBytes, 'OCR did not restore or reread the overwritten source')
    await run.page.goto(returnUrl)
    console.log(`[desktop-local-image-ocr-smoke] ${source} selected normalized PNG · source replaced before on-device OCR · explicit adoption/edit/Create · exact Document body`)
    return { sourcePath, id: artifact.id, name: documentName, body }
  } finally {
    run.page.off('request', captureWrite)
  }
}

export async function verifyLocalImageOcrDocumentRelaunch(run, receipt) {
  assert.ok(receipt?.id && receipt.name && receipt.body, 'the local image OCR document was explicitly created')
  const returnUrl = run.page.url()
  await assert.rejects(stat(receipt.sourcePath), { code: 'ENOENT' }, 'the selected image source is absent after relaunch')
  const saved = await savedDocuments(run.page)
  assert.deepEqual(saved.bodies[receipt.id], receipt.body,
    'the exact edited OCR Document survives source-absent packaged relaunch')
  const artifact = saved.artifacts.find(candidate => candidate.id === receipt.id)
  assert.equal(artifact?.name, receipt.name)
  await run.page.goto(`${run.origin}/artifacts/${encodeURIComponent(receipt.id)}`)
  await expect(run.page.getByRole('heading', { name: receipt.name, exact: true })).toBeVisible()
  await expect(run.page.getByText(LOCAL_IMAGE_OCR_EDITED_TEXT, { exact: true })).toBeVisible()
  await run.page.goto(returnUrl)
}

function bytesBase64(bytes) { return Buffer.from(bytes).toString('base64') }

/** Arm one exact-origin Electron download and return an explicitly disposable
 * observer. This function is closure-free so Playwright can serialize it into
 * the Electron main process, and so the same state machine can be tested with
 * fake EventEmitter sessions and timers. */
export function armOriginalDownload({ session }, {
  trustedOrigin, savePath, timeoutMs = 30_000, timers = globalThis,
}) {
  let resolveDone
  let settled = false
  let activeItem = null
  let itemDoneListener = null
  let timeout
  const done = new Promise(resolve => { resolveDone = resolve })

  const cleanup = cancelActive => {
    session.defaultSession.removeListener('will-download', onWillDownload)
    if (timeout !== undefined) {
      timers.clearTimeout(timeout)
      timeout = undefined
    }
    if (activeItem && itemDoneListener) {
      activeItem.removeListener('done', itemDoneListener)
      itemDoneListener = null
    }
    if (cancelActive && activeItem) activeItem.cancel()
    activeItem = null
  }
  const finish = (result, cancelActive = false) => {
    if (settled) return
    settled = true
    cleanup(cancelActive)
    resolveDone(result)
  }
  const onWillDownload = (event, item, contents) => {
    // This observer owns exactly one click. Detach before inspecting or
    // awaiting the item so a concurrent download cannot replace its target.
    session.defaultSession.removeListener('will-download', onWillDownload)
    let downloadOrigin = ''
    try { downloadOrigin = new URL(contents.getURL()).origin } catch {}
    if (downloadOrigin !== trustedOrigin) {
      event.preventDefault()
      finish({ state: 'unexpected-origin', filename: '' })
      return
    }
    activeItem = item
    itemDoneListener = (_event, state) => finish({ state, filename: item.getFilename() })
    item.once('done', itemDoneListener)
    item.setSavePath(savePath)
  }

  session.defaultSession.on('will-download', onWillDownload)
  timeout = timers.setTimeout(() => finish({ state: 'timed-out', filename: '' }, true), timeoutMs)
  return {
    done,
    dispose() { finish({ state: 'disposed', filename: '' }, true) },
  }
}

export async function preserveImageDownloadClickFailure(originalError, capture, dispose) {
  try {
    await capture()
  } catch (diagnosticError) {
    console.error(`[desktop-local-image-download-failure] unable to capture evidence: ${String(diagnosticError)}`)
  }
  try {
    await dispose()
  } catch (disposeError) {
    console.error(`[desktop-local-image-download-failure] unable to dispose remote handle: ${String(disposeError)}`)
  }
  throw originalError
}

async function retainedBytes(page, imageId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/image-assets/${encodeURIComponent(id)}/content`)
    if (!response.ok) throw new Error(`Normalized image read failed: HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    }
    return btoa(binary)
  }, imageId)
}

async function retainedOriginal(page, imageId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/image-assets/${encodeURIComponent(id)}/original`)
    if (!response.ok) throw new Error(`Private original read failed: HTTP ${response.status}`)
    return response.json()
  }, imageId)
}

async function downloadOriginal(run, page, preview, attachmentId, targetPath, expectedBytes, expectedName) {
  await expect(preview).toHaveAttribute('data-attachment-preview', attachmentId)
  const button = preview.getByRole('button', { name: 'Download original', exact: true })
  await expect(button).toBeVisible()
  const download = await run.app.evaluateHandle(armOriginalDownload, {
    trustedOrigin: run.origin, savePath: targetPath,
  })
  try {
    await button.click()
  } catch (error) {
    await preserveImageDownloadClickFailure(error, async () => {
      const evidenceRoot = await mkdtemp(join(tmpdir(), 'agent-commons-image-download-failure-'))
      const snapshot = await page.evaluate(() => ({
        url: location.href,
        previews: Array.from(document.querySelectorAll('[data-attachment-preview]')).map(node => ({
          id: node.getAttribute('data-attachment-preview'),
          label: node.getAttribute('aria-label'),
          visible: Boolean(node.getClientRects().length),
          originalState: node.querySelector('[data-image-original]')?.getAttribute('data-image-original') ?? null,
          buttons: Array.from(node.querySelectorAll('button')).map(button => ({
            text: button.innerText.trim(), disabled: button.disabled,
            visible: Boolean(button.getClientRects().length),
          })),
        })),
      }))
      const screenshot = join(evidenceRoot, 'download-original-failure.png')
      await page.screenshot({ path: screenshot })
      console.error(`[desktop-local-image-download-failure] ${JSON.stringify({ attachmentId, snapshot, screenshot })}`)
    }, async () => {
      try { await download.evaluate(value => value.dispose()) }
      finally { await download.dispose() }
    })
  }
  let result
  try {
    result = await download.evaluate(value => value.done)
  } finally {
    try { await download.evaluate(value => value.dispose()) }
    finally { await download.dispose() }
  }
  assert.deepEqual(result, { state: 'completed', filename: expectedName }, 'native Download original completes with the basename')
  assert.deepEqual(await readFile(targetPath), Buffer.from(expectedBytes), 'native Download original writes exact selected source bytes')
}

async function openImagePreview(page, attachmentId) {
  const preview = page.locator('[data-attachment-preview]')
  await expect(preview).toHaveCount(1)
  await expect(preview).toHaveAttribute('data-attachment-preview', attachmentId)
  await settledAttachmentPreview(page)
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('data-attachment-preview', attachmentId)
  await expect(preview.getByRole('button', { name: 'Download original', exact: true })).toBeVisible()
  return preview
}

async function closeImagePreview(page, preview) {
  const dock = page.locator('[data-overlay-dock]')
  if (await dock.isVisible()) await dock.getByTitle('Close', { exact: true }).click()
  else {
    await preview.click({ position: { x: 8, y: 8 } })
    const miniRail = page.locator('[data-mini-rail]')
    const chrome = await miniRail.isVisible() ? miniRail : page.getByRole('complementary')
    await chrome.getByRole('button', { name: 'Close pane', exact: true }).click()
  }
  await expect(preview).toHaveCount(0)
}

/** Runs against an already connected source and already loaded path listing.
 * The only fixture-controlled inputs are generated file bytes and their later
 * replacement; native read, renderer normalization, IPC and upload are real. */
export async function smokeLocalImageBrowse({
  run, root, path, kind, source, browser, picker, sessionId, endpoint,
  listKind, previewSelector, pickerAddedCount, previousReplies = 0, verifySourceMetadata,
}) {
  const fixture = localImageBrowseFixture(kind)
  const sourcePath = join(root, path)
  await writeFile(sourcePath, fixture.bytes, { mode: 0o600 })
  assert.deepEqual(await readFile(sourcePath), fixture.bytes, `${source} fixture has exact generated source bytes`)
  await verifySourceMetadata?.()

  const initial = await workspace(run.page, sessionId)
  const modelRequestsBefore = endpoint.requests.length
  const imagePosts = []
  const watchUpload = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/image-assets') imagePosts.push(request)
  }
  run.page.on('request', watchUpload)
  try {
    await browser.getByRole('button', { name: `${path} ${listKind}`, exact: true }).click()
    const previewRoot = browser.locator(previewSelector)
    await expect(previewRoot).toContainText(path, { timeout: TIMEOUT_MS })
    const image = browser.getByRole('img', { name: `Preview of ${path}`, exact: true })
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true)
    const rendered = await image.evaluate(node => ({
      src: node.getAttribute('src'), width: node.naturalWidth, height: node.naturalHeight,
    }))
    assert.equal(rendered.width, fixture.width)
    assert.equal(rendered.height, fixture.height)
    assert.match(rendered.src, /^data:image\/png;base64,/)
    const normalizedBase64 = rendered.src.slice('data:image/png;base64,'.length)
    assert.deepEqual(await workspace(run.page, sessionId), initial, 'native image preview does not mutate saved workspace')
    assert.equal(endpoint.requests.length, modelRequestsBefore, 'native image preview does not call a model')
    assert.equal(imagePosts.length, 0, 'native image preview does not upload or create a durable asset')
    await verifySourceMetadata?.()

    const changedBytes = Buffer.from(`source changed after preview: ${source}:${path}`)
    await writeFile(sourcePath, changedBytes, { mode: 0o600 })
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect(picker).toContainText(`${pickerAddedCount} added`, { timeout: TIMEOUT_MS })
    await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    const saved = await workspace(run.page, sessionId)
    const attachment = saved.attachments.find(item => item.label === path)
    assert.ok(attachment?.image, 'explicit Attach creates one durable normalized image reference')
    assert.equal(attachment.image.mimeType, 'image/png')
    assert.equal(attachment.image.width, fixture.width)
    assert.equal(attachment.image.height, fixture.height)
    assert.equal(attachment.image.originalByteLength, fixture.bytes.byteLength)
    assert.equal(attachment.image.data, undefined, 'workspace stores a reference, never normalized data')
    assert.equal(attachment.imageOriginal, undefined, 'private original bytes never enter saved workspace')
    assert.equal(JSON.stringify(saved).includes(bytesBase64(fixture.bytes)), false)
    assert.equal(JSON.stringify(saved).includes(bytesBase64(changedBytes)), false)
    assert.equal(imagePosts.length, 1, 'only explicit Attach starts the image upload')
    assert.equal(endpoint.requests.length, modelRequestsBefore, 'Attach does not call a model')
    await verifySourceMetadata?.()

    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    const imagePreview = await openImagePreview(run.page, attachment.id)
    const content = await retainedBytes(run.page, attachment.image.id)
    assert.equal(content, normalizedBase64, 'authorized normalized asset bytes match the actual renderer PNG preview')
    const original = await retainedOriginal(run.page, attachment.image.id)
    assert.deepEqual(original, { id: attachment.image.id, original: {
      name: basename(path), data: bytesBase64(fixture.bytes), byteLength: fixture.bytes.byteLength,
    } }, 'the retained original is private, basename-only and exact')
    assert.equal(JSON.stringify(endpoint.requests).includes(original.original.data), false,
      'the exact original source is never supplied to model input')
    const downloadRoot = await mkdtemp(join(tmpdir(), 'agent-commons-local-image-browse-'))
    try {
      await downloadOriginal(run, run.page, imagePreview, attachment.id,
        join(downloadRoot, basename(path)), fixture.bytes, basename(path))
    } finally {
      await rm(downloadRoot, { recursive: true, force: true })
    }
    await closeImagePreview(run.page, imagePreview)

    const composer = run.page.getByRole('textbox', { name: 'Message', exact: true })
    const received = run.page.locator('[data-turn]').filter({ hasText: 'Received 1 supplied image(s).' })
    await expect(received).toHaveCount(previousReplies, { timeout: TIMEOUT_MS })
    await composer.fill('Inspect the explicitly attached normalized local image.')
    await composer.press('Enter')
    await expect(received).toHaveCount(previousReplies + 1, { timeout: TIMEOUT_MS })
    await expect(run.page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
    assert.equal(endpoint.requests.length, modelRequestsBefore + 1, 'one explicit Send makes the only model call')
    const request = endpoint.requests.at(-1)
    const userMessage = request.messages.filter(message => message.role === 'user').at(-1)
    const imageBlocks = userMessage.content.filter(block => block.type === 'image')
    assert.equal(imageBlocks.length, 1)
    assert.equal(imageBlocks[0].source.media_type, 'image/png')
    assert.equal(imageBlocks[0].source.data, content, 'model input contains the exact normalized PNG bytes')
    assert.equal(JSON.stringify(request).includes(original.original.data), false, 'model request excludes exact private original bytes')
    assert.equal(JSON.stringify(request).includes(root), false, 'native absolute path never enters model input')
    await verifySourceMetadata?.()
    return {
      sessionId, saved: await workspace(run.page, sessionId), sourcePath, path, kind,
      attachmentId: attachment.id, imageId: attachment.image.id, normalizedBase64: content,
      original: original.original, changedBytes: bytesBase64(changedBytes),
    }
  } finally {
    run.page.off('request', watchUpload)
  }
}

/** Checks source-free saved state and private original access after relaunch. */
export async function verifyLocalImageBrowseRelaunch(run, receipt) {
  assert.ok(receipt?.sessionId && receipt.attachmentId && receipt.imageId, 'the selected local image completed before relaunch')
  await assert.rejects(stat(receipt.sourcePath), { code: 'ENOENT' }, 'the selected native image source is absent after relaunch')
  assert.deepEqual(await workspace(run.page, receipt.sessionId), receipt.saved,
    'the exact normalized image reference survives without the connected source file')
  const content = await retainedBytes(run.page, receipt.imageId)
  assert.equal(content, receipt.normalizedBase64, 'the saved normalized image remains available after relaunch')
  const original = await retainedOriginal(run.page, receipt.imageId)
  assert.deepEqual(original.original, receipt.original, 'the exact private original remains downloadable after relaunch')
  assert.equal(JSON.stringify(receipt.saved).includes(receipt.original.data), false,
    'the persisted workspace never contains the private original payload')
}
