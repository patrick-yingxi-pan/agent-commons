import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { localImageBrowseFixture, smokeLocalImageBrowse, verifyLocalImageBrowseRelaunch } from './localImageBrowseSmoke.mjs'

const TIMEOUT_MS = 30_000
const SELECTED_PATH = 'src/local-note.md'

async function workspace(page, sessionId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error('Could not read the folder-browse acceptance workspace.')
    return (await response.json()).workspace
  }, sessionId)
}

/** Only the native chooser answer is a fixture. The already-connected pinned
 * source, descriptor reader, IPC, renderer and ordinary saved-file path are real. */
export async function smokeLocalFolderBrowse({ run, root, connectionId, providerId, endpoint, openPicker }) {
  const { page, origin } = run
  const original = await readFile(join(root, SELECTED_PATH), 'utf8')
  assert.equal(original, 'native-nested-source-body\n', 'the selected leaf has known distinct source bytes')
  const image = localImageBrowseFixture('png')
  await writeFile(join(root, 'src', image.name), image.bytes, { mode: 0o600 })
  const session = await page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error('Could not create the isolated folder browsing conversation.')
    return response.json()
  }, providerId)
  await page.goto(`${origin}/s/${encodeURIComponent(session.id)}`)
  const { picker, native } = await openPicker(page)
  await native.getByRole('button', { name: 'Browse files in folder-ephemeral', exact: true }).click()
  const browser = native.locator('[data-local-folder-browser]')
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  const before = await workspace(page, session.id)
  const requestsBefore = endpoint.requests.length
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  const paths = browser.getByRole('list', { name: 'Folder paths', exact: true })
  await expect(paths).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(paths).not.toContainText('.env')
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await browser.getByRole('button', { name: `${SELECTED_PATH} File`, exact: true }).click()
  const preview = browser.getByRole('region', { name: `Preview of ${SELECTED_PATH}`, exact: true })
  await expect(preview).toHaveText(original, { timeout: TIMEOUT_MS })
  assert.equal(await preview.textContent(), original, 'whole selected text is shown without normalization')
  assert.deepEqual(await workspace(page, session.id), before, 'listing and preview do not save source bytes')
  assert.equal(endpoint.requests.length, requestsBefore, 'browsing cannot dispatch a model call')

  const changed = 'native-folder-changed-after-preview\n'
  await writeFile(join(root, SELECTED_PATH), changed)
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(picker).toContainText('1 added', { timeout: TIMEOUT_MS })
  await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'agent-commons-folder-browse-'))
  for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    await expect(preview).toHaveText(original)
    await preview.scrollIntoViewIfNeeded()
    await expect(preview).toBeInViewport({ ratio: 1 })
    await expect(picker.getByRole('button', { name: 'Done', exact: true })).toBeInViewport({ ratio: 1 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(evidenceRoot, `saved-copy-${width}x${height}.png`) })
  }
  const imageReceipt = await smokeLocalImageBrowse({
    run, root, path: `src/${image.name}`, kind: 'png', source: 'folder', browser, picker,
    sessionId: session.id, endpoint, listKind: 'File', previewSelector: '[data-local-folder-file-preview]',
    pickerAddedCount: 2,
  })
  const saved = await workspace(page, session.id)
  assert.equal(saved.attachments.length, 2)
  assert.equal(saved.attachments.find(item => item.label === SELECTED_PATH)?.previewText, original,
    'Attach saves the shown text, not a newer source read')
  assert.ok(saved.attachments.find(item => item.label === `src/${image.name}`)?.image,
    'Attach saves the normalized selected image')
  assert.equal(JSON.stringify(saved).includes(root), false, 'no native absolute path crosses into saved state')
  assert.equal(JSON.stringify(saved).includes(changed.trim()), false)
  assert.equal(endpoint.requests.length, requestsBefore + 1, 'only explicit Send dispatches a model call')
  // The shared image helper sent once after explicit attachment; the reply
  // should include the selected image while the prior text copy stays attached.
  assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [
    { name: SELECTED_PATH, status: 'ready', text: original },
    { name: 'src/local-photo.png', status: 'image-ready', image_index: 1, width: 240, height: 120 },
  ])
  assert.equal(JSON.stringify(endpoint.requests).includes(changed.trim()), false)
  assert.equal(JSON.stringify(endpoint.requests).includes('NESTED_HIDDEN_SECRET'), false)
  assert.equal(JSON.stringify(endpoint.requests).includes('SYMLINK_MUST_NOT_BE_READ'), false)
  console.log(`[desktop-local-folder-browse-smoke] real selected read + exact saved-copy input + five-viewport evidence: ${evidenceRoot}`)
  return { sessionId: session.id, connectionId, saved: await workspace(page, session.id), imageReceipt }
}

export async function verifyLocalFolderBrowseRelaunch(page, receipt) {
  assert.ok(receipt?.sessionId && receipt.saved?.attachments?.length === 2, 'the prior selected-file and image walks completed')
  assert.deepEqual(await workspace(page, receipt.sessionId), receipt.saved,
    'the exact selected-file copy survives packaged relaunch after its source folder is removed')
  if (receipt.imageReceipt) await verifyLocalImageBrowseRelaunch({ page }, receipt.imageReceipt)
}
