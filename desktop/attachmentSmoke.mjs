import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect } from '@playwright/test'
import { exactLoopbackOrigin } from './runtime.mjs'
import { SMOKE_MODEL_ID, startAttachmentSmokeEndpoint } from './attachmentSmokeFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'

const TIMEOUT_MS = 30_000
const DIAGNOSTIC_TIMEOUT_MS = 2_000
const FILE_NAME = 'native-source.py'
const FIRST_TEXT = '# first native source\nVALUE = "native-first-body"\n'
const SECOND_TEXT = '# second native source\nVALUE = "native-second-body"\n'

async function launch(executable, userDataPath) {
  const app = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userDataPath}`],
    chromiumSandbox: true,
    timeout: TIMEOUT_MS,
  })
  try {
    const page = await app.firstWindow({ timeout: TIMEOUT_MS })
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: TIMEOUT_MS })
    const origin = exactLoopbackOrigin(new URL(page.url()).origin)
    const posture = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      preferences: BrowserWindow.getAllWindows().map((window) => {
        const { sandbox, contextIsolation, nodeIntegration } = window.webContents.getLastWebPreferences()
        return { sandbox, contextIsolation, nodeIntegration }
      }),
    }))
    assert.equal(posture.packaged, true, 'acceptance launches the packaged application, not a source entry point')
    assert.equal(posture.userData, userDataPath)
    assert.deepEqual(posture.preferences, [{ sandbox: true, contextIsolation: true, nodeIntegration: false }])
    return { app, page, origin }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function closePreview(page) {
  const preview = page.locator('[data-attachment-preview]')
  const dock = page.locator('[data-overlay-dock]')
  if (await dock.isVisible()) {
    await dock.getByTitle('Close', { exact: true }).click()
  } else {
    await preview.click({ position: { x: 8, y: 8 } })
    const miniRail = page.locator('[data-mini-rail]')
    const chrome = await miniRail.isVisible() ? miniRail : page.getByRole('complementary')
    await chrome.getByRole('button', { name: 'Close pane', exact: true }).click()
  }
  await expect(preview).toHaveCount(0)
}

async function openFilesPicker(page) {
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Files/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  return picker
}

async function inspectPair(page, expectedIds) {
  await page.getByTitle('Files (2)', { exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Files', exact: true })
  const rows = menu.getByRole('button', { name: FILE_NAME, exact: true })
  await expect(rows).toHaveCount(2)
  await rows.first().click()
  const preview = page.locator('[data-attachment-preview]')
  await expect(preview).toContainText(FIRST_TEXT)
  const firstId = await preview.getAttribute('data-attachment-preview')
  await page.getByRole('button', { name: FILE_NAME, exact: true }).last().click()
  await expect(preview).toContainText(SECOND_TEXT)
  const secondId = await preview.getAttribute('data-attachment-preview')
  assert.match(firstId, /^ui-host::[\da-f-]{36}$/)
  assert.match(secondId, /^ui-host::[\da-f-]{36}$/)
  assert.notEqual(firstId, secondId)
  if (expectedIds) assert.deepEqual([firstId, secondId], expectedIds, 'a full relaunch preserves exact selected-file identities')
  await closePreview(page)
  return [firstId, secondId]
}

async function send(page, text, expectedReply) {
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  const replies = page.locator('[data-turn]').filter({ hasText: expectedReply })
  const previous = await replies.count()
  await composer.fill(text)
  await composer.press('Enter')
  await expect(replies).toHaveCount(previous + 1, { timeout: TIMEOUT_MS })
  await expect(replies.last()).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
}

async function readMessages(page, sessionId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`Native attachment conversation read: HTTP ${response.status}`)
    return (await response.json()).messages
  }, sessionId)
}

async function boundedDiagnostic(label, operation) {
  let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), DIAGNOSTIC_TIMEOUT_MS)
      Promise.resolve().then(operation).then(resolve, reject)
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function writeDetachEvidence(reportPath, evidence) {
  await writeFile(reportPath, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 })
  return reportPath
}

export async function preserveSmokeFailure(originalError, capture) {
  try {
    await capture()
  } catch (diagnosticError) {
    console.error(`[desktop-attachment-smoke] unable to capture detach evidence: ${String(diagnosticError)}`)
  }
  throw originalError
}

async function captureDetachFailure(page, sessionId, endpoint, stage) {
  const stamp = `${process.pid}-${Date.now()}`
  const screenshotPath = join(tmpdir(), `agent-commons-attachment-${stamp}.png`)
  const reportPath = join(tmpdir(), `agent-commons-attachment-${stamp}.json`)
  const session = await boundedDiagnostic('session evidence read', () => page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    return response.ok ? await response.json() : { status: response.status }
  }, sessionId)).catch((error) => ({ readError: String(error) }))
  const requests = endpoint.requests
  const latestRequest = requests.at(-1)
  const composer = await boundedDiagnostic('composer evidence read', () => page.getByRole('textbox', { name: 'Message', exact: true }).evaluate((element) => ({
    value: element.value,
    disabled: element.disabled,
    ariaDisabled: element.getAttribute('aria-disabled'),
  }))).catch((error) => ({ readError: String(error) }))
  const evidence = {
    stage,
    url: page.url(),
    renderedTurns: await boundedDiagnostic('rendered transcript read', () => page.locator('[data-turn]').allTextContents()).catch(() => []),
    composer,
    session: {
      status: session.status,
      activeTurnId: session.activeTurnId ?? session.workspace?.activeTurnId ?? null,
      messages: Array.isArray(session.messages) ? session.messages : [],
      attachments: session.workspace?.attachments?.map(({ id, label, previewText, documentImport, image }) => ({
        id, label, previewText, documentImport, hasImage: Boolean(image),
      })) ?? [],
    },
    requestCount: requests.length,
    latestRequest: latestRequest ? {
      messageCount: latestRequest.messages?.length ?? 0,
      lastUserContent: latestRequest.messages?.filter((message) => message.role === 'user').at(-1)?.content,
    } : undefined,
  }
  await boundedDiagnostic('failure screenshot', () => page.screenshot({ path: screenshotPath, fullPage: true })).catch((error) => {
    evidence.screenshotError = String(error)
  })
  await writeDetachEvidence(reportPath, { ...evidence, screenshotPath })
  console.error(`[desktop-attachment-smoke] detach evidence ${reportPath} · screenshot ${screenshotPath}`)
}

/** A separate, test-only packaged phase. Only the OS dialog result and remote
 * model are fixtures: disk reads, sender-validated IPC, preload, renderer,
 * persistence, and provider transport remain the actual packaged code.
 *
 * Playwright's Electron launcher adds mock-keychain switches. This phase owns a
 * DIFFERENT user-data directory and never replaces the ordinary executable/CDP
 * smoke's real OS-backed credential and authentication-root acceptance. */
export async function smokePackagedAttachments({ executable }) {
  const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'agent-commons-native-attachments-')))
  const userDataPath = join(fixtureRoot, 'profile')
  const paths = [join(fixtureRoot, 'first', FILE_NAME), join(fixtureRoot, 'second', FILE_NAME)]
  let endpoint
  let run
  try {
    await Promise.all(paths.map(async (path, index) => {
      await mkdir(join(fixtureRoot, index === 0 ? 'first' : 'second'))
      await writeFile(path, index === 0 ? FIRST_TEXT : SECOND_TEXT, { mode: 0o600 })
    }))
    endpoint = await startAttachmentSmokeEndpoint()
    run = await launch(executable, userDataPath)
    let { page, origin } = run
    // Account/provider creation is a precondition already covered by the
    // ordinary smoke. The attachment journey below uses rendered controls.
    const session = await page.evaluate(async ({ baseURL, model }) => {
      const post = async (path, data) => {
        const response = await fetch(path, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
        })
        if (!response.ok) throw new Error(`Native attachment precondition ${path}: HTTP ${response.status}`)
        return response.json()
      }
      await post('/api/v1/auth/signup', {
        name: 'Native Attachment Smoke', email: 'native-attachments@example.test', password: 'isolated-attachment-password',
      })
      const provider = await post('/api/v1/providers', {
        label: 'Native attachment fixture', modelFamily: 'claude', effortLevels: ['Default'],
        config: { baseURL, model },
      })
      return post('/api/v1/sessions', { providerId: provider.id })
    }, { baseURL: endpoint.origin, model: SMOKE_MODEL_ID })
    const sessionPath = `/s/${encodeURIComponent(session.id)}`
    await page.goto(`${origin}${sessionPath}`)

    const calls = await run.app.evaluateHandle(({ dialog, BrowserWindow }, filePaths) => {
      const calls = []
      const selections = [[], [filePaths[0]], [filePaths[1]]]
      dialog.showOpenDialog = async (owner, options) => {
        calls.push({ owned: owner instanceof BrowserWindow, title: options.title, properties: options.properties })
        const selected = selections.shift()
        if (!selected) throw new Error('Unexpected native dialog invocation')
        return { canceled: selected.length === 0, filePaths: selected }
      }
      return calls
    }, paths)
    const picker = await openFilesPicker(page)
    const choose = picker.getByRole('button', { name: /Add files from this computer/ })
    await choose.click()
    await expect.poll(() => calls.evaluate((calls) => calls.length)).toBe(1)
    await expect(picker).toBeVisible()
    await expect(page.locator('[data-attachment-preview]')).toHaveCount(0)
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: FILE_NAME })).toHaveCount(0)
    await choose.click()
    await expect(page.locator('[data-attachment-preview]')).toContainText(FIRST_TEXT)
    await closePreview(page)
    const nextPicker = await openFilesPicker(page)
    await nextPicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await expect(page.locator('[data-attachment-preview]')).toContainText(SECOND_TEXT)
    await closePreview(page)
    assert.deepEqual(await calls.jsonValue(), Array.from({ length: 3 }, () => ({
      owned: true, title: 'Add files', properties: ['openFile', 'multiSelections'],
    })))
    await calls.dispose()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/2 text files/i)
    const ids = await inspectPair(page)
    // Rich text renders newlines as <br>, not text nodes. The visible marker
    // locates the reply; saved messages and transport assertions prove exact bytes.
    await send(page, 'Read both selected native source files.', 'native-first-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [
      { name: FILE_NAME, status: 'ready', text: FIRST_TEXT },
      { name: FILE_NAME, status: 'ready', text: SECOND_TEXT },
    ])
    assert.ok(endpoint.documents.length > 0)
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false, 'absolute native paths never reach any part of the model request')
    const savedMessages = await readMessages(page, session.id)
    assert.ok(savedMessages.some((message) => message.role === 'assistant' && message.content === `Read supplied attachment: ${FIRST_TEXT}`))

    await run.app.close()
    run = undefined
    // Once the snapshots are saved, deliberately remove the source files. A
    // relaunch must use saved content, never an undisclosed path/handle re-read.
    await Promise.all(paths.map((path) => rm(path)))
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await page.goto(`${origin}${sessionPath}`)
    await inspectPair(page, ids)
    await expect(page.locator('[data-turn]').filter({ hasText: 'native-first-body' })).toBeVisible()
    assert.deepEqual(await readMessages(page, session.id), savedMessages, 'relaunch preserves the exact prior conversation')
    await page.getByTitle('Files (2)', { exact: true }).click()
    await page.getByRole('menu', { name: 'Files', exact: true }).getByTitle('Remove from context', { exact: true }).first().click()
    const confirmation = page.getByText(`Remove ${FILE_NAME} from the conversation?`, { exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.locator('..').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: FILE_NAME })).toHaveCount(1)
    const beforeSend = endpoint.documents.length
    await send(page, 'Read only the remaining native source file.', 'native-second-body')
    assert.equal(endpoint.documents.length, beforeSend + 1)
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{ name: FILE_NAME, status: 'ready', text: SECOND_TEXT }])
    await expect(page.locator('[data-turn]').filter({ hasText: 'native-first-body' })).toBeVisible()
    const afterDetach = await readMessages(page, session.id)
    assert.deepEqual(afterDetach.slice(0, savedMessages.length), savedMessages, 'detach cannot erase or rewrite prior messages')
    assert.ok(afterDetach.some((message) => message.role === 'assistant' && message.content === `Read supplied attachment: ${SECOND_TEXT}`))
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    console.log('[desktop-attachment-smoke] native dialog-result fixture · real selected-file reads + IPC · distinct same-name snapshots · endpoint bodies · full relaunch without source files · independent detach · prior reply preserved')

    // Folder import is a separate conversation: its actual native snapshot,
    // not an individually selected attachment, must supply this model input.
    const folderPath = join(fixtureRoot, 'folder-import')
    await mkdir(folderPath)
    const folderText = 'native-folder-snapshot-body\n'
    await writeFile(join(folderPath, 'notes.md'), folderText)
    await writeFile(join(folderPath, '.env'), 'HIDDEN_FOLDER_SECRET=not-imported')
    await writeFile(join(folderPath, 'photo.png'), 'not plain text')
    const folderSession = await page.evaluate(async (providerId) => {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(`Folder conversation precondition: HTTP ${response.status}`)
      return response.json()
    }, session.providerId)
    const folderRoute = `/s/${encodeURIComponent(folderSession.id)}`
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${origin}${folderRoute}`)
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (options.properties.join(',') !== 'openDirectory') throw new Error('Expected folder selection')
        return { canceled: false, filePaths: [path] }
      }
    }, folderPath)
    await page.getByRole('button', { name: 'Add context' }).click()
    const folderPicker = page.getByRole('dialog', { name: 'Add context' })
    await folderPicker.getByRole('button', { name: /^Folder/ }).click()
    await folderPicker.getByRole('button', { name: 'This computer', exact: true }).click()
    await folderPicker.getByRole('button', { name: /Choose a folder from this computer/ }).click()
    await expect(page.locator('[data-folder-snapshot-preview]')).toContainText(folderText)
    await page.locator('[data-overlay-dock="narrow"]').getByRole('button', { name: 'Close', exact: true }).click()
    await send(page, 'Read the imported folder.', 'native-folder-snapshot-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [
      { name: 'folder-import/notes.md', status: 'ready', text: folderText },
      { name: 'folder-import/photo.png', status: 'unavailable' },
    ])
    assert.equal(JSON.stringify(endpoint.requests).includes('HIDDEN_FOLDER_SECRET'), false)
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)

    // The packaged renderer must resolve the real emitted worker under its
    // loopback CSP; a source-server-only PDF test cannot prove this boundary.
    const pdfPath = join(fixtureRoot, 'native-document.pdf')
    const pdfText = '[Page 1]\nnative-pdf-body\n\n[Page 3]\nFinal PDF page'
    await writeFile(pdfPath, pdfFixture({ pages: ['native-pdf-body', null, 'Final PDF page'], compress: true }))
    const pdfSession = await page.evaluate(async (providerId) => {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(`PDF conversation precondition: HTTP ${response.status}`)
      return response.json()
    }, session.providerId)
    const pdfRoute = `/s/${encodeURIComponent(pdfSession.id)}`
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${origin}${pdfRoute}`)
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (!options.properties.includes('openFile')) throw new Error('Expected PDF file selection')
        return { canceled: false, filePaths: [path] }
      }
    }, pdfPath)
    const pdfPicker = await openFilesPicker(page)
    await pdfPicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await expect(page.locator('[data-document-import="ready"]')).toContainText('2 of 3 pages')
    await expect(page.locator('[data-attachment-preview]')).toContainText(pdfText)
    const pdfId = await page.locator('[data-attachment-preview]').getAttribute('data-attachment-preview')
    await closePreview(page)
    await send(page, 'Read the PDF text.', 'native-pdf-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-document.pdf', status: 'ready', text: pdfText,
      extraction: { format: 'pdf', pages: 3, text_pages: 2 },
    }])
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    const docxPath = join(fixtureRoot, 'native-document.docx')
    const docxText = 'native-word-body · café 世界 😀\nSecond paragraph'
    await writeFile(docxPath, docxFixture({ paragraphs: docxText.split('\n') }), { mode: 0o600 })
    const docxSession = await page.evaluate(async (providerId) => {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(`Word conversation precondition: HTTP ${response.status}`)
      return response.json()
    }, session.providerId)
    const docxRoute = `/s/${encodeURIComponent(docxSession.id)}`
    await page.goto(`${origin}${docxRoute}`)
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (!options.properties.includes('openFile')) throw new Error('Expected Word file selection')
        return { canceled: false, filePaths: [path] }
      }
    }, docxPath)
    const docxPicker = await openFilesPicker(page)
    await docxPicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await expect(page.locator('[data-document-import="ready"]')).toContainText('Word body text')
    await expect(page.locator('[data-attachment-preview]')).toContainText(docxText)
    const docxId = await page.locator('[data-attachment-preview]').getAttribute('data-attachment-preview')
    await closePreview(page)
    await send(page, 'Read the Word body text.', 'native-word-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-document.docx', status: 'ready', text: docxText, extraction: { format: 'docx' },
    }])
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    const xlsxPath = join(fixtureRoot, 'native-document.xlsx')
    const xlsxMarker = 'native-workbook-visible-marker'
    await writeFile(xlsxPath, xlsxFixture({ sheets: [
      {
        name: 'Visible Data',
        rows: [[xlsxMarker, 42, 'hidden column value'], ['hidden row', 'hidden row value']],
        hiddenRows: [2],
        hiddenColumns: ['C'],
      },
      { name: 'Hidden Sheet', hidden: true, rows: [['hidden sheet marker']] },
    ] }), { mode: 0o600 })
    const xlsxSession = await page.evaluate(async (providerId) => {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(`XLSX conversation precondition: HTTP ${response.status}`)
      return response.json()
    }, session.providerId)
    const xlsxRoute = `/s/${encodeURIComponent(xlsxSession.id)}`
    await page.goto(`${origin}${xlsxRoute}`)
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (!options.properties.includes('openFile')) throw new Error('Expected XLSX file selection')
        return { canceled: false, filePaths: [path] }
      }
    }, xlsxPath)
    const xlsxPicker = await openFilesPicker(page)
    await xlsxPicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await expect(page.locator('[data-document-import="ready"]')).toBeVisible()
    await expect(page.locator('[data-attachment-preview]')).toContainText(xlsxMarker)
    await expect(page.locator('[data-attachment-preview]')).not.toContainText('hidden row')
    await expect(page.locator('[data-attachment-preview]')).not.toContainText('hidden sheet marker')
    const xlsxId = await page.locator('[data-attachment-preview]').getAttribute('data-attachment-preview')
    const xlsxAttachmentBeforeReload = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.find((attachment) => attachment.label === 'native-document.xlsx')
    }, xlsxSession.id)
    assert.equal(xlsxAttachmentBeforeReload.documentImport?.format, 'xlsx')
    assert.equal(xlsxAttachmentBeforeReload.documentImport?.status, 'ready')
    assert.equal(typeof xlsxAttachmentBeforeReload.previewText, 'string')
    assert.match(xlsxAttachmentBeforeReload.previewText, new RegExp(xlsxMarker))
    const xlsxText = xlsxAttachmentBeforeReload.previewText
    await closePreview(page)
    await send(page, 'Read the workbook values.', xlsxMarker)
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-document.xlsx', status: 'ready', text: xlsxText, extraction: { format: 'xlsx' },
    }])
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    await run.app.close()
    run = undefined
    await rm(folderPath, { recursive: true })
    await rm(pdfPath)
    await rm(docxPath)
    await rm(xlsxPath)
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await page.goto(`${origin}${folderRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'folder-import/' }).click()
    await expect(page.locator('[data-folder-snapshot-preview]')).toContainText(folderText)
    console.log('[desktop-folder-smoke] real native folder reader + IPC · hidden-file exclusion · bounded snapshot preview + model input · full relaunch without source folder')
    await page.goto(`${origin}${docxRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-document.docx' }).click()
    await expect(page.locator('[data-attachment-preview]')).toHaveAttribute('data-attachment-preview', docxId)
    await expect(page.locator('[data-attachment-preview]')).toContainText(docxText)
    await expect(page.locator('[data-document-import="ready"]')).toContainText('Word body text')
    const docxAttachment = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.find((attachment) => attachment.label === 'native-document.docx')
    }, docxSession.id)
    assert.equal(docxAttachment.previewText, docxText)
    assert.deepEqual(docxAttachment.documentImport, { format: 'docx', status: 'ready' })
    assert.equal(docxAttachment.docxBytes, undefined)
    await closePreview(page)
    await send(page, 'Read the saved Word document again.', 'native-word-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-document.docx', status: 'ready', text: docxText, extraction: { format: 'docx' },
    }])
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-document.docx' }).click()
    await page.getByTitle('Remove file', { exact: true }).click()
    await send(page, 'Check detached Word document.', 'No supplied attachment text.')
    assert.equal(JSON.stringify(endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content).includes('native-word-body'), false)
    console.log('[desktop-docx-smoke] real native Word bytes + IPC · packaged worker extraction · model body text · full relaunch without source · detach')
    await page.goto(`${origin}${xlsxRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-document.xlsx' }).click()
    await expect(page.locator('[data-attachment-preview]')).toHaveAttribute('data-attachment-preview', xlsxId)
    await expect(page.locator('[data-attachment-preview]')).toContainText(xlsxMarker)
    await expect(page.locator('[data-attachment-preview]')).not.toContainText('hidden sheet marker')
    await expect(page.locator('[data-document-import="ready"]')).toBeVisible()
    const savedXlsx = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.find((attachment) => attachment.label === 'native-document.xlsx')
    }, xlsxSession.id)
    assert.equal(savedXlsx.previewText, xlsxText)
    assert.deepEqual(savedXlsx.documentImport, { format: 'xlsx', status: 'ready' })
    assert.equal(savedXlsx.xlsxBytes, undefined)
    await closePreview(page)
    await send(page, 'Read the saved workbook again.', xlsxMarker)
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-document.xlsx', status: 'ready', text: xlsxText, extraction: { format: 'xlsx' },
    }])
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-document.xlsx' }).click()
    await page.getByTitle('Remove file', { exact: true }).click()
    await send(page, 'Check detached workbook.', 'No supplied attachment text.')
    assert.equal(JSON.stringify(endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content).includes(xlsxMarker), false)
    console.log('[desktop-xlsx-smoke] real native XLSX bytes + IPC · packaged worker extraction · model body text and metadata · full relaunch without source · detach')
    await page.goto(`${origin}${pdfRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-document.pdf' }).click()
    await expect(page.locator('[data-attachment-preview]')).toHaveAttribute('data-attachment-preview', pdfId)
    await expect(page.locator('[data-attachment-preview]')).toContainText(pdfText)
    await expect(page.locator('[data-document-import="ready"]')).toContainText('2 of 3 pages')
    await page.getByTitle('Remove file', { exact: true }).click()
    try {
      await send(page, 'Check detached PDF.', 'No supplied attachment text.')
    } catch (error) {
      await preserveSmokeFailure(error, () => captureDetachFailure(page, pdfSession.id, endpoint, 'pdf-detach-reply'))
    }
    const currentInput = endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content
    assert.equal(JSON.stringify(currentInput).includes('native-pdf-body'), false, 'detach removes current attachment input, not previous assistant history')
    console.log('[desktop-pdf-smoke] real native PDF bytes + IPC · packaged worker extraction · model text metadata · full relaunch without source PDF · detach')
    const imagePath = join(fixtureRoot, 'native-image.png')
    await writeFile(imagePath, imageFixture(240, 120), { mode: 0o600 })
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (!options.properties.includes('openFile')) throw new Error('Expected image file selection')
        return { canceled: false, filePaths: [path] }
      }
    }, imagePath)
    const imagePicker = await openFilesPicker(page)
    await imagePicker.getByRole('button', { name: /Add files from this computer/ }).click()
    const imagePreview = page.locator('[data-attachment-preview]')
    await expect(imagePreview).toHaveAttribute('data-attachment-input-status', 'image-ready')
    await expect.poll(() => imagePreview.locator('img').last().evaluate((image) => image.complete && image.naturalWidth === 240)).toBe(true)
    const imageId = await imagePreview.getAttribute('data-attachment-preview')
    const storedImage = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.find((attachment) => attachment.image)
    }, pdfSession.id)
    assert.equal(storedImage.previewUrl, undefined)
    assert.equal(storedImage.image.data, undefined)
    assert.equal(storedImage.image.width, 240)
    await closePreview(page)
    await send(page, 'Describe the native image.', 'Received 1 supplied image(s).')
    const imageBlocks = endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content
    assert.equal(imageBlocks.filter((block) => block.type === 'image').length, 1)
    assert.equal(imageBlocks.find((block) => block.type === 'image').source.media_type, 'image/png')
    assert.equal(JSON.stringify(endpoint.requests).includes(imagePath), false)
    await run.app.close()
    run = undefined
    await rm(imagePath)
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await page.goto(`${origin}${pdfRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-image.png' }).click()
    const restoredImage = page.locator('[data-attachment-preview]')
    await expect(restoredImage).toHaveAttribute('data-attachment-preview', imageId)
    await expect.poll(() => restoredImage.locator('img').last().evaluate((image) => image.complete && image.naturalWidth === 240)).toBe(true)
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
    await send(page, 'Check detached image.', 'No supplied attachment text.')
    const detachedInput = endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content
    assert.equal(typeof detachedInput, 'string', 'detachment excludes image blocks from future turns')
    console.log('[desktop-image-smoke] real native image bytes + IPC · renderer raster conversion · durable asset upload · model image blocks · full relaunch without source · detach')
  } finally {
    await run?.app.close()
    await endpoint?.close()
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}
