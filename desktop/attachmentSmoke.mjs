import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect } from '@playwright/test'
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'
import { exactLoopbackOrigin } from './runtime.mjs'
import { SMOKE_MODEL_ID, startAttachmentSmokeEndpoint } from './attachmentSmokeFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { bitmapFixture, iconFixture } from '../tests/helpers/bitmapFixture.mjs'
import { svgFixture } from '../tests/helpers/svgFixture.mjs'
import { runArtifactSheetImportSmoke } from './artifactSheetImportSmoke.mjs'
import { smokeDesktopUpdateMenu } from './updateMenuSmoke.mjs'
import { smokePackagedLocalGit } from './localGitSmoke.mjs'
import { settledAttachmentPreview } from '../e2e/accessibility-helpers.ts'

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
    if (process.platform === 'darwin') await smokeDesktopUpdateMenu(app)
    return { app, page, origin }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function closePreview(page, preview = page.locator('[data-attachment-preview]')) {
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

async function expectSheetGrid(sheetPreview, sheet) {
  await expect(sheetPreview.locator('table thead th')).toHaveText(sheet.columns)
  await expect(sheetPreview.locator('table tbody td')).toHaveText(sheet.rows.flat())
}

async function openFilesPicker(page) {
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Files/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  return picker
}

async function openNativeLocalFolderPicker(page) {
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Folder/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  return { picker, native: picker.locator('[data-native-folder-picker]') }
}

async function chooseNativeConnectionFolder(app, selectedPath) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async (_owner, options) => {
      if (options.title !== 'Connect folder' || options.properties.join(',') !== 'openDirectory') {
        throw new Error('Expected explicit native folder connection selection')
      }
      return { canceled: false, filePaths: [path] }
    }
  }, selectedPath)
}

async function readNativeConnections(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/me')
    if (!response.ok) throw new Error('The local-folder identity precondition failed.')
    const identity = await response.json()
    const source = { namespace: identity.tenant.id, userId: identity.user.id }
    return window.agentCommonsDesktop.context.localFolders.list(source)
  })
}

function visibleLocalWorkspaceFolder(page, connectionId) {
  if (typeof connectionId !== 'string' || !/^LOCAL_[A-F0-9]{32}$/.test(connectionId)) {
    throw new Error('Expected an opaque native local-folder connection id')
  }
  return page.locator(`[data-workspace-folder="ui-host::${connectionId}"]:visible`)
}

async function finishReadyTextIntake(page, picker, expectedCount) {
  await expect(page.locator('[data-attachment-input-ready]')).toHaveAttribute(
    'data-attachment-input-ready', String(expectedCount), { timeout: TIMEOUT_MS },
  )
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
}

async function openArtifactImportDialog(page, origin) {
  await page.goto(`${origin}/artifacts`)
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  return dialog
}

async function chooseNativeArtifactFile(app, dialog, path) {
  await app.evaluate(({ dialog: nativeDialog }, selectedPath) => {
    nativeDialog.showOpenDialog = async (_owner, options) => {
      if (options.title !== 'Add files' || options.properties.join(',') !== 'openFile,multiSelections' || options.filters !== undefined) {
        throw new Error('Expected any-format native artifact file selection')
      }
      return { canceled: false, filePaths: [selectedPath] }
    }
  }, path)
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
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
    console.error(`[desktop-attachment-smoke] unable to capture failure evidence: ${String(diagnosticError)}`)
  }
  throw originalError
}

async function capturePickerFailure(page, picker) {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'agent-commons-picker-failure-'))
  const geometry = await boundedDiagnostic('picker geometry', () => picker.evaluate((dialog) => {
    const describe = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        tag: element.tagName, text: element.textContent, className: element.className,
        rect: rect.toJSON(), clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
        scrollLeft: element.scrollLeft, scrollTop: element.scrollTop,
        overflowX: style.overflowX, overflowY: style.overflowY,
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
      dialog: describe(dialog),
      buttons: [...dialog.querySelectorAll('button')].map((button) => {
        const rect = button.getBoundingClientRect()
        return {
          button: describe(button), parent: describe(button.parentElement),
          centerHit: describe(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
        }
      }),
    }
  })).catch((error) => ({ readError: String(error) }))
  await writeDetachEvidence(join(evidenceRoot, 'geometry.json'), geometry)
  await boundedDiagnostic('picker screenshot', () => page.screenshot({ path: join(evidenceRoot, 'picker.png') }))
  console.error(`[desktop-attachment-smoke] picker failure evidence ${evidenceRoot}`)
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

    const importedDocuments = [
      {
        path: join(fixtureRoot, 'native-artifact-text.txt'),
        name: 'native-artifact-text.md',
        text: 'Native text artifact body.\n\nSecond text paragraph.',
        blocks: ['Native text artifact body.', 'Second text paragraph.'],
      },
      {
        path: join(fixtureRoot, 'native-artifact-pdf.pdf'),
        name: 'native-artifact-pdf.md',
        text: '[Page 1]\nnative-artifact-pdf-body\n\n[Page 3]\nFinal PDF page',
        blocks: ['[Page 1] native-artifact-pdf-body', '[Page 3] Final PDF page'],
        disclosure: '2 of 3 pages',
        bytes: pdfFixture({ pages: ['native-artifact-pdf-body', null, 'Final PDF page'], compress: true }),
      },
      {
        path: join(fixtureRoot, 'native-artifact-docx.docx'),
        name: 'native-artifact-docx.md',
        text: 'native-artifact-word-body · café 世界 😀\nSecond Word paragraph.',
        blocks: ['native-artifact-word-body · café 世界 😀 Second Word paragraph.'],
        disclosure: 'Extracted Word body text',
        bytes: docxFixture({ paragraphs: ['native-artifact-word-body · café 世界 😀', 'Second Word paragraph.'] }),
      },
    ]
    await writeFile(importedDocuments[0].path, importedDocuments[0].text, { mode: 0o600 })
    await writeFile(importedDocuments[1].path, importedDocuments[1].bytes, { mode: 0o600 })
    await writeFile(importedDocuments[2].path, importedDocuments[2].bytes, { mode: 0o600 })
    for (const imported of importedDocuments) {
      const artifactDialog = await openArtifactImportDialog(page, origin)
      await chooseNativeArtifactFile(run.app, artifactDialog, imported.path)
      await expect(artifactDialog.getByLabel('Name', { exact: true })).toHaveValue('')
      await expect(artifactDialog.getByLabel('Content', { exact: true })).toHaveValue('')
      await expect(artifactDialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
      await expect(artifactDialog.getByLabel('Imported text', { exact: true })).toHaveValue(imported.text)
      if (imported.disclosure) await expect(artifactDialog).toContainText(imported.disclosure)
      await artifactDialog.getByRole('button', { name: 'Use imported text', exact: true }).click()
      await expect(artifactDialog.getByLabel('Name', { exact: true })).toHaveValue(imported.name)
      await expect(artifactDialog.getByLabel('Content', { exact: true })).toHaveValue(imported.text)
      await expect(artifactDialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()
      await artifactDialog.getByRole('button', { name: 'Create document', exact: true }).click()
      await expect(artifactDialog).toHaveCount(0)
      await expect(page.getByRole('heading', { name: imported.name, exact: true })).toBeVisible()
      const saved = await page.evaluate(async (name) => {
        const artifactsResponse = await fetch('/api/v1/artifacts')
        const contentsResponse = await fetch('/api/v1/artifact-content')
        if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('Imported artifact reads failed.')
        const artifacts = await artifactsResponse.json()
        const contents = await contentsResponse.json()
        const artifact = artifacts.find((candidate) => candidate.name === name)
        return { artifact, body: artifact ? contents[artifact.id] : undefined }
      }, imported.name)
      assert.equal(saved.artifact?.kind, 'doc')
      assert.deepEqual(saved.body, {
        type: 'doc', title: imported.name.slice(0, -3), blocks: imported.blocks.map((p) => ({ p })), revision: 0,
      })
      imported.id = saved.artifact.id
    }

    const importedPresentation = {
      path: join(fixtureRoot, 'native-artifact-slides.pptx'),
      name: 'native-artifact-slides.slides',
      body: {
        type: 'slides',
        revision: 0,
        slides: [
          { title: 'Imported deck title', bullets: ['Opening bullet', 'Revenue\t43'] },
          { title: 'Final deck title', bullets: ['Closing bullet'] },
        ],
      },
    }
    await writeFile(importedPresentation.path, pptxFixture({
      slides: [
        { shapes: ['Imported deck title', 'Opening bullet'], table: [['Revenue', '43']] },
        { hidden: true, shapes: ['HIDDEN_SLIDE'] },
        { shapes: ['Final deck title', 'Closing bullet'] },
      ],
    }), { mode: 0o600 })
    const presentationDialog = await openArtifactImportDialog(page, origin)
    await presentationDialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Slides' })
    await chooseNativeArtifactFile(run.app, presentationDialog, importedPresentation.path)
    const importedSlides = presentationDialog.getByRole('region', { name: 'Imported slides', exact: true })
    await expect(importedSlides).toContainText('Imported deck title')
    await expect(importedSlides).toContainText('Final deck title')
    await expect(importedSlides).not.toContainText('HIDDEN_SLIDE')
    await expect(presentationDialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue('')
    await expect(presentationDialog.getByRole('button', { name: 'Create slides', exact: true })).toBeDisabled()
    await presentationDialog.getByRole('button', { name: 'Use imported slides', exact: true }).click()
    await expect(presentationDialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue('Imported deck title')
    await expect(presentationDialog.getByLabel('Slide 1 bullet 1', { exact: true })).toHaveValue('Opening bullet')
    await expect(presentationDialog.getByLabel('Slide 1 bullet 2', { exact: true })).toHaveValue('Revenue\t43')
    await expect(presentationDialog.getByLabel('Slide 2 title', { exact: true })).toHaveValue('Final deck title')
    await expect(presentationDialog.getByLabel('Slide 2 bullet 1', { exact: true })).toHaveValue('Closing bullet')
    await expect(presentationDialog.getByLabel('Name', { exact: true })).toHaveValue(importedPresentation.name)
    await expect(presentationDialog.getByRole('button', { name: 'Create slides', exact: true })).toBeEnabled()
    await presentationDialog.getByRole('button', { name: 'Create slides', exact: true }).click()
    await expect(presentationDialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: importedPresentation.name, exact: true })).toBeVisible()
    const savedPresentation = await page.evaluate(async (name) => {
      const artifactsResponse = await fetch('/api/v1/artifacts')
      const contentsResponse = await fetch('/api/v1/artifact-content')
      if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('Imported presentation reads failed.')
      const artifacts = await artifactsResponse.json()
      const contents = await contentsResponse.json()
      const artifact = artifacts.find((candidate) => candidate.name === name)
      return { artifact, body: artifact ? contents[artifact.id] : undefined }
    }, importedPresentation.name)
    assert.equal(savedPresentation.artifact?.kind, 'slide')
    assert.deepEqual(savedPresentation.body, importedPresentation.body)
    importedPresentation.id = savedPresentation.artifact.id
    console.log('[desktop-artifact-presentation-import-smoke] any-format native dialog result · real PPTX reader + IPC · reviewed visible-slide outline · explicit adoption · exact saved titles and bullets')

    const importedSheets = await runArtifactSheetImportSmoke({
      page, app: run.app, origin, fixtureRoot, openArtifactImportDialog, chooseNativeArtifactFile,
    })

    await Promise.all([...importedDocuments.map(({ path }) => rm(path)), rm(importedPresentation.path), ...importedSheets.map(({ path }) => rm(path))])
    console.log('[desktop-artifact-import-smoke] real native reader + IPC · text/PDF/DOCX review · explicit adoption · saved document bodies')

    // Markdown export is a renderer download, not a native bridge. Create a real
    // authored document through the authenticated relation seam, then capture the
    // one download in the existing packaged Electron test process. The listener is
    // test-only and writes into this smoke's isolated fixture root; production main
    // and preload code retain their normal sandboxed authority.
    const markdownName = `native-markdown-${Date.now().toString(36)}.md`
    const markdownBody = `Native Markdown smoke body ${Date.now().toString(36)}\n\nCurrent saved revision.`
    const markdownArtifact = await page.evaluate(async ({ name, body, sessionId }) => {
      const apply = await fetch('/api/v1/relations/ops', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `native-markdown-${name}` },
        body: JSON.stringify({ op: {
          kind: 'save-artifact',
          artifact: { name, kind: 'doc', meta: 'Document', body },
          sessionId,
          sessionTitle: 'Native Markdown Smoke',
        } }),
      })
      if (!apply.ok) throw new Error(`Markdown artifact creation failed: HTTP ${apply.status}`)
      const artifactsResponse = await fetch('/api/v1/artifacts')
      if (!artifactsResponse.ok) throw new Error(`Markdown artifact listing failed: HTTP ${artifactsResponse.status}`)
      const artifact = (await artifactsResponse.json()).find((candidate) => candidate.name === name)
      if (!artifact) throw new Error('Markdown artifact was not returned by the authenticated registry')
      const editedBody = 'Edited current saved revision.'
      const edit = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifact.id)}/content`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': `native-markdown-edit-${name}` },
        body: JSON.stringify({ block: 1, text: editedBody, expectedRevision: 0 }),
      })
      if (!edit.ok) throw new Error(`Markdown artifact edit failed: HTTP ${edit.status}`)
      return { id: artifact.id, editedBody }
    }, { name: `original-${markdownName}`, body: markdownBody, sessionId: session.id })
    const markdownRoute = `/artifacts/${encodeURIComponent(markdownArtifact.id)}`
    await page.goto(`${origin}${markdownRoute}`)
    await page.getByRole('button', { name: 'Rename artifact', exact: true }).click()
    await page.getByRole('textbox', { name: 'Artifact name', exact: true }).fill(markdownName)
    await page.getByRole('button', { name: 'Save artifact name', exact: true }).click()
    await expect(page.getByRole('heading', { name: markdownName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeVisible()
    const exportPayload = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(id)}/export`)
      return { status: response.status, payload: await response.json() }
    }, markdownArtifact.id)
    assert.equal(exportPayload.status, 200, 'fresh authenticated export GET succeeds')
    assert.equal(exportPayload.payload.artifactId, markdownArtifact.id)
    assert.equal(exportPayload.payload.filename, markdownName)
    assert.equal(exportPayload.payload.mediaType, 'text/markdown;charset=utf-8')
    assert.ok(Number.isSafeInteger(exportPayload.payload.revision))
    assert.match(exportPayload.payload.content, /Edited current saved revision\\\./, 'export contains the current edited text with Markdown escaping')
    assert.match(exportPayload.payload.content, /Native Markdown smoke body [\w-]+/, 'export contains the first authored paragraph')
    const downloadDirectory = join(fixtureRoot, 'markdown-download')
    const downloadPath = join(downloadDirectory, markdownName)
    await mkdir(downloadDirectory, { recursive: true })
    const downloadDone = await run.app.evaluateHandle(({ session }, { trustedOrigin, target }) => ({
      done: new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ state: 'timed-out', filename: '' }), 30_000)
        session.defaultSession.once('will-download', (event, item, contents) => {
          let downloadOrigin = ''
          try { downloadOrigin = new URL(contents.getURL()).origin } catch {}
          if (downloadOrigin !== trustedOrigin) {
            event.preventDefault()
            clearTimeout(timeout)
            resolve({ state: 'unexpected-origin', filename: '' })
            return
          }
          item.setSavePath(target)
          item.once('done', (_event, state) => {
            clearTimeout(timeout)
            resolve({ state, filename: item.getFilename() })
          })
        })
      }),
    }), { trustedOrigin: origin, target: downloadPath })
    await page.getByRole('button', { name: 'Download Markdown', exact: true }).click()
    const downloadResult = await downloadDone.evaluate((holder) => holder.done)
    await downloadDone.dispose()
    assert.deepEqual(downloadResult, { state: 'completed', filename: markdownName }, 'Electron completed the packaged download with the expected filename')
    const downloaded = await readFile(downloadPath)
    assert.deepEqual(downloaded.toString('utf8'), exportPayload.payload.content, 'downloaded Markdown bytes equal the fresh authenticated export content')
    assert.match(downloaded.toString('utf8'), /Edited current saved revision\\\./, 'download preserves escaped Markdown punctuation')
    console.log('[desktop-markdown-smoke] owner rename · authenticated fresh export GET · current edited document bytes · test-only packaged download redirect · exact renamed .md file')

    // Word export uses the same saved, renamed, edited document. Fetch the
    // authenticated DOCX representation first, inspect its native document
    // part, then prove the real renderer download is byte-identical in the
    // isolated packaged Electron process.
    const wordName = markdownName.replace(/\.md$/iu, '.docx')
    await expect(page.getByRole('button', { name: 'Download Word', exact: true })).toBeVisible()
    const wordExportPayload = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(id)}/export?format=docx`)
      return { status: response.status, payload: await response.json() }
    }, markdownArtifact.id)
    assert.equal(wordExportPayload.status, 200, 'fresh authenticated Word export GET succeeds')
    assert.equal(wordExportPayload.payload.artifactId, markdownArtifact.id)
    assert.equal(wordExportPayload.payload.filename, wordName)
    assert.equal(wordExportPayload.payload.mediaType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert.equal(wordExportPayload.payload.revision, exportPayload.payload.revision, 'Word export uses the same current saved revision')
    const expectedWordBytes = Buffer.from(wordExportPayload.payload.content, 'base64')
    const wordReader = new ZipReader(new Uint8ArrayReader(expectedWordBytes), { checkSignature: true })
    let nativeWord = ''
    try {
      const documentEntry = (await wordReader.getEntries()).find((entry) => entry.filename === 'word/document.xml')
      assert.ok(documentEntry, 'DOCX contains the native Word document part')
      nativeWord = await documentEntry.getData(new TextWriter(), { checkSignature: true })
    } finally { await wordReader.close() }
    assert.match(nativeWord, /Edited current saved revision\./, 'native Word body contains the edited saved paragraph')
    assert.match(nativeWord, /Native Markdown smoke body [\w-]+/, 'native Word body contains the first authored paragraph')
    assert.match(nativeWord, /<w:document[^>]*xmlns:w=/, 'native Word body is editable WordprocessingML')
    const wordDownloadDirectory = join(fixtureRoot, 'word-download')
    const wordDownloadPath = join(wordDownloadDirectory, wordName)
    await mkdir(wordDownloadDirectory, { recursive: true })
    const wordDownloadDone = await run.app.evaluateHandle(({ session }, { trustedOrigin, target }) => ({
      done: new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ state: 'timed-out', filename: '' }), 30_000)
        session.defaultSession.once('will-download', (event, item, contents) => {
          let downloadOrigin = ''
          try { downloadOrigin = new URL(contents.getURL()).origin } catch {}
          if (downloadOrigin !== trustedOrigin) {
            event.preventDefault()
            clearTimeout(timeout)
            resolve({ state: 'unexpected-origin', filename: '' })
            return
          }
          item.setSavePath(target)
          item.once('done', (_event, state) => {
            clearTimeout(timeout)
            resolve({ state, filename: item.getFilename() })
          })
        })
      }),
    }), { trustedOrigin: origin, target: wordDownloadPath })
    await page.getByRole('button', { name: 'Download Word', exact: true }).click()
    const wordDownloadResult = await wordDownloadDone.evaluate((holder) => holder.done)
    await wordDownloadDone.dispose()
    assert.deepEqual(wordDownloadResult, { state: 'completed', filename: wordName }, 'Electron completed the packaged Word download with the expected filename')
    const downloadedWord = await readFile(wordDownloadPath)
    assert.deepEqual(downloadedWord, expectedWordBytes, 'downloaded Word bytes equal the fresh authenticated export content')
    console.log('[desktop-word-smoke] same renamed/edited document · authenticated fresh DOCX export GET · native word/document.xml text · test-only packaged download redirect · exact renamed .docx bytes')

    // XLSX export is a renderer download, not a native bridge. Create a real
    // structured sheet through the authenticated relation seam, rename it via
    // the canonical page, and inspect the downloaded ZIP/XML so formula-looking
    // user text remains a literal cell rather than becoming executable formula
    // markup. This intentionally uses the same isolated packaged Electron
    // process and download redirect as the Markdown acceptance above.
    const sheetName = `native-sheet-${Date.now().toString(36)}.xlsx`
    const sheetBody = {
      type: 'sheet',
      columns: ['Label', 'Value'],
      rows: [['Literal formula text', '=SUM(A1:A2)'], ['Unicode', 'café ☀️']],
      note: 'No formula calculation in export smoke.',
    }
    const sheetArtifact = await page.evaluate(async ({ name, body, sessionId }) => {
      const apply = await fetch('/api/v1/relations/ops', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `native-xlsx-${name}` },
        body: JSON.stringify({ op: {
          kind: 'save-artifact',
          artifact: { name, kind: 'sheet', meta: 'Sheet', body },
          sessionId,
          sessionTitle: 'Native XLSX Smoke',
        } }),
      })
      if (!apply.ok) throw new Error(`XLSX artifact creation failed: HTTP ${apply.status}`)
      const artifactsResponse = await fetch('/api/v1/artifacts')
      if (!artifactsResponse.ok) throw new Error(`XLSX artifact listing failed: HTTP ${artifactsResponse.status}`)
      const artifact = (await artifactsResponse.json()).find((candidate) => candidate.name === name)
      if (!artifact) throw new Error('XLSX artifact was not returned by the authenticated registry')
      return { id: artifact.id, originalName: artifact.name }
    }, { name: `original-${sheetName}`, body: sheetBody, sessionId: session.id })
    const sheetRoute = `/artifacts/${encodeURIComponent(sheetArtifact.id)}`
    await page.goto(`${origin}${sheetRoute}`)
    await page.getByRole('button', { name: 'Rename artifact', exact: true }).click()
    await page.getByRole('textbox', { name: 'Artifact name', exact: true }).fill(sheetName)
    await page.getByRole('button', { name: 'Save artifact name', exact: true }).click()
    await expect(page.getByRole('heading', { name: sheetName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download XLSX', exact: true })).toBeVisible()
    // Exercise the canonical owner editor before exporting. The response below
    // is the authorized body read that the export must reflect, rather than a
    // fixture-side copy of the edited value.
    await page.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    await page.getByRole('textbox', { name: 'Sheet row 2 value 2', exact: true }).fill('café edited ✅')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit sheet', exact: true })).toBeVisible()
    const editedSheetRead = await page.evaluate(async (id) => {
      const response = await fetch('/api/v1/artifact-content')
      return { status: response.status, body: (await response.json())[id] }
    }, sheetArtifact.id)
    assert.equal(editedSheetRead.status, 200, 'authorized structured body read succeeds after owner edit')
    assert.equal(editedSheetRead.body.revision, 1, 'owner edit advances the structured body revision once')
    assert.equal(editedSheetRead.body.rows[1][1], 'café edited ✅', 'authorized body read contains the saved literal cell')
    const xlsxExport = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(id)}/export?format=xlsx`)
      return { status: response.status, payload: await response.json() }
    }, sheetArtifact.id)
    assert.equal(xlsxExport.status, 200, 'fresh authenticated XLSX export GET succeeds')
    assert.equal(xlsxExport.payload.artifactId, sheetArtifact.id)
    assert.equal(xlsxExport.payload.filename, sheetName)
    assert.equal(xlsxExport.payload.mediaType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.equal(xlsxExport.payload.encoding, 'base64')
    assert.equal(xlsxExport.payload.revision, editedSheetRead.body.revision, 'export revision matches the authorized edited body')
    const xlsxBytes = Buffer.from(xlsxExport.payload.content, 'base64')
    assert.equal(xlsxBytes.subarray(0, 2).toString('hex'), '504b', 'XLSX export is a ZIP package')
    const xlsxReader = new ZipReader(new Uint8ArrayReader(xlsxBytes))
    let sheetXml = ''
    let sharedStringsXml = ''
    try {
      const entries = await xlsxReader.getEntries()
      const worksheet = entries.find((entry) => entry.filename === 'xl/worksheets/sheet1.xml')
      const sharedStrings = entries.find((entry) => entry.filename === 'xl/sharedStrings.xml')
      assert.ok(worksheet, 'XLSX package contains its first worksheet')
      assert.ok(sharedStrings, 'XLSX package contains its shared strings table')
      sheetXml = await worksheet.getData(new TextWriter())
      sharedStringsXml = await sharedStrings.getData(new TextWriter())
    } finally {
      await xlsxReader.close()
    }
    assert.match(sheetXml, /t="s"/, 'worksheet stores cells as shared-string references')
    assert.match(sharedStringsXml, /Literal formula text/)
    assert.match(sharedStringsXml, /=SUM\(A1:A2\)/, 'formula-looking text survives as a shared literal cell')
    assert.match(sharedStringsXml, /caf/, 'Unicode literal cell survives export')
    assert.match(sharedStringsXml, /edited/, 'export contains the edited authorized cell')
    assert.doesNotMatch(`${sheetXml}\n${sharedStringsXml}`, /<f(?:\s|>)/, 'XLSX export contains no formula nodes')
    const xlsxDownloadDirectory = join(fixtureRoot, 'xlsx-download')
    const xlsxDownloadPath = join(xlsxDownloadDirectory, sheetName)
    await mkdir(xlsxDownloadDirectory, { recursive: true })
    const xlsxDownloadDone = await run.app.evaluateHandle(({ session }, { trustedOrigin, target }) => ({
      done: new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ state: 'timed-out', filename: '' }), 30_000)
        session.defaultSession.once('will-download', (event, item, contents) => {
          let downloadOrigin = ''
          try { downloadOrigin = new URL(contents.getURL()).origin } catch {}
          if (downloadOrigin !== trustedOrigin) {
            event.preventDefault()
            clearTimeout(timeout)
            resolve({ state: 'unexpected-origin', filename: '' })
            return
          }
          item.setSavePath(target)
          item.once('done', (_event, state) => {
            clearTimeout(timeout)
            resolve({ state, filename: item.getFilename() })
          })
        })
      }),
    }), { trustedOrigin: origin, target: xlsxDownloadPath })
    await page.getByRole('button', { name: 'Download XLSX', exact: true }).click()
    const xlsxDownloadResult = await xlsxDownloadDone.evaluate((holder) => holder.done)
    await xlsxDownloadDone.dispose()
    assert.deepEqual(xlsxDownloadResult, { state: 'completed', filename: sheetName }, 'Electron completed the packaged XLSX download with the expected filename')
    const downloadedXlsx = await readFile(xlsxDownloadPath)
    assert.deepEqual(downloadedXlsx, xlsxBytes, 'downloaded XLSX bytes equal the fresh authenticated export content')
    assert.equal(downloadedXlsx.subarray(0, 2).toString('hex'), '504b', 'downloaded XLSX remains a ZIP package')
    console.log('[desktop-xlsx-export-smoke] owner rename · authenticated literal sheet export · ZIP worksheet without formula nodes · exact renamed .xlsx download')

    // PPTX export is likewise a renderer download, not a native bridge. Create
    // a real structured slide deck through the authenticated relation seam,
    // rename it on the canonical page, and inspect its generated package for
    // ordered literal title/bullet text without external or macro parts.
    const presentationName = `native-slides-${Date.now().toString(36)}.Q1.pptx`
    const presentationBody = {
      type: 'slides',
      slides: [
        { title: 'Launch plan', bullets: ['Literal first bullet', 'Second bullet'] },
        { title: 'Close', bullets: ['No external links or macros'] },
      ],
    }
    const presentationArtifact = await page.evaluate(async ({ name, body, sessionId }) => {
      const apply = await fetch('/api/v1/relations/ops', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `native-pptx-${name}` },
        body: JSON.stringify({ op: {
          kind: 'save-artifact',
          artifact: { name, kind: 'slide', meta: 'Slides', body },
          sessionId,
          sessionTitle: 'Native PPTX Smoke',
        } }),
      })
      if (!apply.ok) throw new Error(`PPTX artifact creation failed: HTTP ${apply.status}`)
      const artifactsResponse = await fetch('/api/v1/artifacts')
      if (!artifactsResponse.ok) throw new Error(`PPTX artifact listing failed: HTTP ${artifactsResponse.status}`)
      const artifact = (await artifactsResponse.json()).find((candidate) => candidate.name === name)
      if (!artifact) throw new Error('PPTX artifact was not returned by the authenticated registry')
      return { id: artifact.id }
    }, { name: `original-${presentationName}`, body: presentationBody, sessionId: session.id })
    const presentationRoute = `/artifacts/${encodeURIComponent(presentationArtifact.id)}`
    await page.goto(`${origin}${presentationRoute}`)
    await page.getByRole('button', { name: 'Rename artifact', exact: true }).click()
    await page.getByRole('textbox', { name: 'Artifact name', exact: true }).fill(presentationName)
    await page.getByRole('button', { name: 'Save artifact name', exact: true }).click()
    await expect(page.getByRole('heading', { name: presentationName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download PowerPoint', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit slides', exact: true }).click()
    await page.getByRole('textbox', { name: 'Slide 1 title', exact: true }).fill('Launch plan edited')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit slides', exact: true })).toBeVisible()
    const editedPresentationRead = await page.evaluate(async (id) => {
      const response = await fetch('/api/v1/artifact-content')
      return { status: response.status, body: (await response.json())[id] }
    }, presentationArtifact.id)
    assert.equal(editedPresentationRead.status, 200, 'authorized slide body read succeeds after owner edit')
    assert.equal(editedPresentationRead.body.revision, 1, 'slide edit advances the structured body revision once')
    assert.equal(editedPresentationRead.body.slides[0].title, 'Launch plan edited', 'authorized body read contains the saved slide title')
    const pptxExport = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(id)}/export?format=pptx`)
      return { status: response.status, payload: await response.json() }
    }, presentationArtifact.id)
    assert.equal(pptxExport.status, 200, 'fresh authenticated PPTX export GET succeeds')
    assert.equal(pptxExport.payload.artifactId, presentationArtifact.id)
    assert.equal(pptxExport.payload.filename, presentationName)
    assert.equal(pptxExport.payload.mediaType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    assert.equal(pptxExport.payload.encoding, 'base64')
    assert.equal(pptxExport.payload.revision, editedPresentationRead.body.revision, 'PPTX revision matches the authorized edited body')
    const pptxBytes = Buffer.from(pptxExport.payload.content, 'base64')
    assert.equal(pptxBytes.subarray(0, 2).toString('hex'), '504b', 'PPTX export is a ZIP package')
    const pptxReader = new ZipReader(new Uint8ArrayReader(pptxBytes))
    const pptxParts = new Map()
    try {
      const entries = await pptxReader.getEntries()
      for (const entry of entries) {
        if (entry.directory) continue
        pptxParts.set(entry.filename, await entry.getData(new TextWriter()))
      }
    } finally {
      await pptxReader.close()
    }
    const partNames = [...pptxParts.keys()]
    assert.ok(pptxParts.has('ppt/presentation.xml'), 'PPTX package contains presentation metadata')
    assert.ok(pptxParts.has('ppt/slides/slide1.xml'), 'PPTX package contains the first slide')
    assert.ok(pptxParts.has('ppt/slides/slide2.xml'), 'PPTX package contains the second slide')
    assert.ok(partNames.every((name) => !/vbaProject|externalLink|\.bin$/iu.test(name)), 'PPTX package contains no macro or external-link parts')
    const pptxXml = [...pptxParts.values()].join('\n')
    assert.doesNotMatch(pptxXml, /TargetMode="External"|vbaProject|externalLink/iu, 'PPTX package contains no external relationships or macros')
    const slide1 = pptxParts.get('ppt/slides/slide1.xml')
    const slide2 = pptxParts.get('ppt/slides/slide2.xml')
    assert.match(slide1, /Launch plan edited/)
    assert.match(slide1, /Literal first bullet/)
    assert.match(slide1, /Second bullet/)
    assert.ok(slide1.indexOf('Literal first bullet') < slide1.indexOf('Second bullet'), 'first slide bullets retain source order')
    assert.match(slide2, /Close/)
    assert.match(slide2, /No external links or macros/)
    const pptxDownloadDirectory = join(fixtureRoot, 'pptx-download')
    const pptxDownloadPath = join(pptxDownloadDirectory, presentationName)
    await mkdir(pptxDownloadDirectory, { recursive: true })
    const pptxDownloadDone = await run.app.evaluateHandle(({ session }, { trustedOrigin, target }) => ({
      done: new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ state: 'timed-out', filename: '' }), 30_000)
        session.defaultSession.once('will-download', (event, item, contents) => {
          let downloadOrigin = ''
          try { downloadOrigin = new URL(contents.getURL()).origin } catch {}
          if (downloadOrigin !== trustedOrigin) {
            event.preventDefault()
            clearTimeout(timeout)
            resolve({ state: 'unexpected-origin', filename: '' })
            return
          }
          item.setSavePath(target)
          item.once('done', (_event, state) => {
            clearTimeout(timeout)
            resolve({ state, filename: item.getFilename() })
          })
        })
      }),
    }), { trustedOrigin: origin, target: pptxDownloadPath })
    await page.getByRole('button', { name: 'Download PowerPoint', exact: true }).click()
    const pptxDownloadResult = await pptxDownloadDone.evaluate((holder) => holder.done)
    await pptxDownloadDone.dispose()
    assert.deepEqual(pptxDownloadResult, { state: 'completed', filename: presentationName }, 'Electron completed the packaged PPTX download with the expected filename')
    const downloadedPptx = await readFile(pptxDownloadPath)
    assert.deepEqual(downloadedPptx, pptxBytes, 'downloaded PPTX bytes equal the fresh authenticated export content')
    assert.equal(downloadedPptx.subarray(0, 2).toString('hex'), '504b', 'downloaded PPTX remains a ZIP package')
    console.log('[desktop-pptx-export-smoke] owner rename · authenticated literal slide export · ordered slide ZIP without external or macro parts · exact renamed .pptx download')
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
    await finishReadyTextIntake(page, picker, 1)
    await expect(page.locator('[data-attachment-preview]')).toContainText(FIRST_TEXT)
    await closePreview(page)
    const nextPicker = await openFilesPicker(page)
    await nextPicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await finishReadyTextIntake(page, nextPicker, 2)
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
    for (const imported of importedDocuments) {
      await page.goto(`${origin}/artifacts/${encodeURIComponent(imported.id)}`)
      await expect(page.getByRole('heading', { name: imported.name, exact: true })).toBeVisible()
      for (const block of imported.blocks) await expect(page.getByText(block, { exact: true })).toBeVisible()
    }
    await page.goto(`${origin}/artifacts/${encodeURIComponent(importedPresentation.id)}`)
    await expect(page.getByRole('heading', { name: importedPresentation.name, exact: true })).toBeVisible()
    const persistedPresentation = page.locator('[data-structured-artifact-body="slides"]')
    await expect(persistedPresentation).toContainText('Imported deck title')
    await expect(persistedPresentation).toContainText('Revenue\t43')
    await expect(persistedPresentation).toContainText('Final deck title')
    await expect(persistedPresentation).toContainText('Closing bullet')
    const restoredPresentationBody = await page.evaluate(async (id) => {
      const response = await fetch('/api/v1/artifact-content')
      if (!response.ok) throw new Error('Restored presentation read failed.')
      return (await response.json())[id]
    }, importedPresentation.id)
    assert.deepEqual(restoredPresentationBody, importedPresentation.body)
    console.log('[desktop-artifact-presentation-import-smoke] exact saved slide identity + body survive full relaunch without source PPTX')
    for (const imported of importedSheets) {
      await page.goto(`${origin}/artifacts/${encodeURIComponent(imported.id)}`)
      await expect(page.getByRole('heading', { name: imported.name, exact: true })).toBeVisible()
      const restoredSheet = await page.evaluate(async (id) => {
        const response = await fetch('/api/v1/artifact-content')
        if (!response.ok) throw new Error('Restored sheet read failed.')
        return (await response.json())[id]
      }, imported.id)
      assert.deepEqual(restoredSheet, imported.body)
      if (imported.body.type === 'workbook') {
        const workbookView = page.locator('[data-structured-artifact-body="workbook"]')
        const tabs = workbookView.getByRole('tablist', { name: 'Worksheets', exact: true })
        for (const sheet of imported.body.sheets) {
          const tab = tabs.getByRole('tab', { name: sheet.name, exact: true })
          await tab.click()
          await expect(tab).toHaveAttribute('aria-selected', 'true')
          await expectSheetGrid(workbookView.locator('[data-structured-artifact-body="sheet"]'), sheet)
        }
      } else {
        await expectSheetGrid(page.locator('[data-structured-artifact-body="sheet"]'), imported.body)
      }
    }
    console.log('[desktop-artifact-sheet-import-smoke] exact saved sheet identities + bodies survive full relaunch without source CSV/TSV/XLSX files')
    console.log('[desktop-artifact-import-smoke] exact saved document identities + rendered bodies survive full relaunch without source files')
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
    await chooseNativeConnectionFolder(run.app, folderPath)
    const { picker: folderPicker, native: nativeFolderPicker } = await openNativeLocalFolderPicker(page)
    await nativeFolderPicker.getByRole('button', { name: /Choose a folder from this computer/ }).click()
    await expect(nativeFolderPicker.getByRole('button', { name: 'Attach folder-import', exact: true })).toBeVisible()
    await nativeFolderPicker.getByRole('button', { name: 'Attach folder-import', exact: true }).click()
    // Folder intake counts independent folder identities, not its file rows.
    await expect(folderPicker).toContainText('1 added', { timeout: TIMEOUT_MS })
    await folderPicker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('[data-folder-snapshot-preview]')).toContainText(folderText)
    await page.locator('[data-overlay-dock="narrow"]').getByRole('button', { name: 'Close', exact: true }).click()
    await send(page, 'Read the imported folder.', 'native-folder-snapshot-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [
      { name: 'folder-import/notes.md', status: 'ready', text: folderText },
      { name: 'folder-import/photo.png', status: 'unavailable' },
    ])
    assert.equal(JSON.stringify(endpoint.requests).includes('HIDDEN_FOLDER_SECRET'), false)
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    const folderManagePicker = await openNativeLocalFolderPicker(page)
    await folderManagePicker.native.getByRole('button', { name: 'Manage folder-import', exact: true }).click()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(page.getByText('This connection is not available to this account on this device. Saved snapshots remain in their conversations.', { exact: true })).toBeVisible({ timeout: TIMEOUT_MS })

    // The persistent native connection flow is separate from one-shot folder
    // intake: choosing a root only grants access; Attach and Refresh are the
    // content-read boundaries. The remember checkbox starts unchecked.
    const ephemeralFolder = join(fixtureRoot, 'folder-ephemeral')
    const rememberedFolder = join(fixtureRoot, 'folder-remembered')
    await mkdir(ephemeralFolder)
    await mkdir(rememberedFolder)
    const initialLocalText = 'native-local-folder-initial\n'
    const refreshedLocalText = 'native-local-folder-refreshed\n'
    const rememberedLocalText = 'native-local-folder-after-relaunch\n'
    await writeFile(join(ephemeralFolder, 'local-note.md'), initialLocalText)
    await writeFile(join(rememberedFolder, 'remembered-note.md'), 'before connection; never captured automatically\n')
    const localSession = await page.evaluate(async (providerId) => {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(`Local-folder conversation precondition: HTTP ${response.status}`)
      return response.json()
    }, session.providerId)
    const localSessionPath = `/s/${encodeURIComponent(localSession.id)}`
    await page.goto(`${origin}${localSessionPath}`)

    await chooseNativeConnectionFolder(run.app, ephemeralFolder)
    let localPicker = await openNativeLocalFolderPicker(page)
    const rememberCheckbox = localPicker.native.getByRole('checkbox', { name: /Remember this connection/ })
    await expect(rememberCheckbox).toHaveAttribute('aria-checked', 'false')
    await localPicker.native.getByRole('button', { name: /Choose a folder from this computer/ }).click()
    await expect(localPicker.native.getByRole('button', { name: 'Attach folder-ephemeral', exact: true })).toBeVisible()
    let nativeConnections = await readNativeConnections(page)
    assert.deepEqual(nativeConnections.map(({ name, remembered }) => [name, remembered]), [['folder-ephemeral', false]])
    const ephemeralConnectionId = nativeConnections[0].id
    assert.match(ephemeralConnectionId, /^LOCAL_[A-F0-9]{32}$/)
    const beforeExplicitAttach = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error('Local-folder saved-state read failed.')
      return (await response.json()).workspace
    }, localSession.id)
    assert.equal(JSON.stringify(beforeExplicitAttach ?? {}).includes('folder-ephemeral'), false,
      'connect and metadata listing save no folder contents into the conversation')

    await localPicker.native.getByRole('button', { name: 'Attach folder-ephemeral', exact: true }).click()
    await expect(localPicker.picker).toContainText('1 added', { timeout: TIMEOUT_MS })
    await localPicker.picker.getByRole('button', { name: 'Done', exact: true }).click()
    const ephemeralGroup = visibleLocalWorkspaceFolder(page, ephemeralConnectionId)
    await expect(ephemeralGroup).toBeVisible()
    await ephemeralGroup.getByRole('button', { name: /local-note\.md/ }).click()
    const localPreview = page.locator('[data-folder-snapshot-preview]:visible')
    await expect(localPreview).toContainText(initialLocalText)
    await writeFile(join(ephemeralFolder, 'local-note.md'), refreshedLocalText)
    await ephemeralGroup.getByRole('button', { name: /Refresh folder-ephemeral\// }).click()
    await expect(localPreview).toContainText(refreshedLocalText, { timeout: TIMEOUT_MS })

    // Move only our generated source aside. A real missing-source refusal must
    // cross the packaged IPC/preload boundary without an Electron error wrapper,
    // while the shared recovery controls preserve the exact saved workspace.
    const beforeFailedRefresh = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error('Pre-refusal saved-state read failed.')
      return (await response.json()).workspace
    }, localSession.id)
    await rename(ephemeralFolder, `${ephemeralFolder}-held`)
    try {
      await ephemeralGroup.getByRole('button', { name: /Refresh folder-ephemeral\// }).click()
      const message = 'Couldn’t confirm the context update. The local folder is unavailable. Your saved snapshots have not been changed.'
      await expect(page.getByText(message, { exact: true }).filter({ visible: true }).first()).toBeVisible()
      await expect(localPreview).toContainText(refreshedLocalText)
      const evidenceRoot = await mkdtemp(join(tmpdir(), 'agent-commons-local-folder-recovery-'))
      for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
        await page.setViewportSize({ width, height })
        await settledAttachmentPreview(page, '[data-folder-snapshot-preview]')
        const status = page.locator('[data-context-panel-status]').filter({ visible: true })
        await expect(status.getByRole('button', { name: 'Use saved state', exact: true })).toBeInViewport({ ratio: 1 })
        await expect(status.getByText(message, { exact: true })).toBeInViewport({ ratio: 1 })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: join(evidenceRoot, `missing-source-${width}x${height}.png`) })
      }
      console.log(`[desktop-local-folder-recovery-smoke] exact path-free error + five-viewport recovery evidence: ${evidenceRoot}`)
      await page.getByRole('button', { name: 'Use saved state', exact: true }).filter({ visible: true }).first().click()
      const afterFailedRefresh = await page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
        if (!response.ok) throw new Error('Post-refusal saved-state read failed.')
        return (await response.json()).workspace
      }, localSession.id)
      assert.deepEqual(afterFailedRefresh, beforeFailedRefresh, 'failed native refresh and Use saved state preserve the exact saved workspace')
      await page.setViewportSize({ width: 375, height: 812 })
      await settledAttachmentPreview(page, '[data-folder-snapshot-preview]')
    } finally {
      await rename(`${ephemeralFolder}-held`, ephemeralFolder)
    }
    await closePreview(page, localPreview)
    await send(page, 'Read the refreshed local folder snapshot.', 'native-local-folder-refreshed')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [
      { name: 'folder-ephemeral/local-note.md', status: 'ready', text: refreshedLocalText },
    ])

    await chooseNativeConnectionFolder(run.app, rememberedFolder)
    localPicker = await openNativeLocalFolderPicker(page)
    const rememberedCheckbox = localPicker.native.getByRole('checkbox', { name: /Remember this connection/ })
    await expect(rememberedCheckbox).toHaveAttribute('aria-checked', 'false')
    await rememberedCheckbox.click()
    await expect(rememberedCheckbox).toHaveAttribute('aria-checked', 'true')
    await localPicker.native.getByRole('button', { name: /Choose a folder from this computer/ }).click()
    await expect(localPicker.native.getByRole('button', { name: 'Attach folder-remembered', exact: true })).toBeVisible()
    nativeConnections = await readNativeConnections(page)
    assert.deepEqual(nativeConnections.map(({ name, remembered }) => [name, remembered]), [
      ['folder-ephemeral', false], ['folder-remembered', true],
    ])
    const rememberedConnectionId = nativeConnections.find(({ name }) => name === 'folder-remembered')?.id
    assert.equal(typeof rememberedConnectionId, 'string')
    await writeFile(join(rememberedFolder, 'remembered-note.md'), rememberedLocalText)

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
    await finishReadyTextIntake(page, pdfPicker, 1)
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
    await finishReadyTextIntake(page, docxPicker, 1)
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
    await finishReadyTextIntake(page, xlsxPicker, 1)
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
    const pptxPath = join(fixtureRoot, 'native-presentation.pptx')
    const pptxText = 'Slide 1: native-slide-body\nA\tB'
    await writeFile(pptxPath, pptxFixture({
      slides: [{ shapes: ['native-slide-body'], table: [['A', 'B']], notes: ['speaker note must not enter input'] }],
    }), { mode: 0o600 })
    const pptxSession = await page.evaluate(async (providerId) => {
      const response = await fetch('/api/v1/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(`PPTX conversation precondition: HTTP ${response.status}`)
      return response.json()
    }, session.providerId)
    const pptxRoute = `/s/${encodeURIComponent(pptxSession.id)}`
    await page.goto(`${origin}${pptxRoute}`)
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (!options.properties.includes('openFile')) throw new Error('Expected PPTX file selection')
        return { canceled: false, filePaths: [path] }
      }
    }, pptxPath)
    const pptxPicker = await openFilesPicker(page)
    await pptxPicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await finishReadyTextIntake(page, pptxPicker, 1)
    await expect(page.locator('[data-document-import="ready"]')).toContainText('Visible slide text')
    await expect(page.locator('[data-attachment-preview]')).toContainText(pptxText)
    await expect(page.locator('[data-attachment-preview]')).not.toContainText('speaker note must not enter input')
    const pptxId = await page.locator('[data-attachment-preview]').getAttribute('data-attachment-preview')
    const pptxAttachmentBeforeReload = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.find((attachment) => attachment.label === 'native-presentation.pptx')
    }, pptxSession.id)
    assert.equal(pptxAttachmentBeforeReload.documentImport?.format, 'pptx')
    assert.equal(pptxAttachmentBeforeReload.documentImport?.status, 'ready')
    assert.equal(pptxAttachmentBeforeReload.previewText, pptxText)
    await closePreview(page)
    await send(page, 'Read the presentation text.', 'native-slide-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-presentation.pptx', status: 'ready', text: pptxText,
      extraction: { format: 'pptx' },
    }])
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    await run.app.close()
    run = undefined
    await rm(folderPath, { recursive: true })
    await rm(ephemeralFolder, { recursive: true })
    await rm(pdfPath)
    await rm(docxPath)
    await rm(xlsxPath)
    await rm(pptxPath)
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await page.goto(`${origin}${localSessionPath}`)
    nativeConnections = await readNativeConnections(page)
    assert.deepEqual(nativeConnections.map(({ name, remembered }) => [name, remembered]), [
      ['folder-remembered', true],
    ], 'full relaunch drops the unchecked grant but reopens the explicit remembered grant')
    assert.equal(nativeConnections[0].id, rememberedConnectionId, 'relaunch restores the exact original remembered grant')
    const localWorkspaceBeforeAttach = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error('Restored local-folder saved-state read failed.')
      return (await response.json()).workspace
    }, localSession.id)
    const foldersBeforeAttach = localWorkspaceBeforeAttach?.workspaces?.flatMap((workspace) => workspace.folders ?? []) ?? []
    assert.equal(foldersBeforeAttach.some((folder) => folder.id === `ui-host::${rememberedConnectionId}`), false,
      'remembering and relaunch do not automatically attach the remembered folder')
    let reopenedPicker = await openNativeLocalFolderPicker(page)
    await expect(reopenedPicker.native.getByRole('button', { name: 'Attach folder-remembered', exact: true })).toBeVisible()
    await reopenedPicker.native.getByRole('button', { name: 'Attach folder-remembered', exact: true }).click()
    await expect(reopenedPicker.picker).toContainText('1 added', { timeout: TIMEOUT_MS })
    await reopenedPicker.picker.getByRole('button', { name: 'Done', exact: true }).click()
    const rememberedGroup = visibleLocalWorkspaceFolder(page, rememberedConnectionId)
    await expect(rememberedGroup.getByRole('button', { name: /remembered-note\.md/ })).toBeVisible()
    await rememberedGroup.getByRole('button', { name: /remembered-note\.md/ }).click()
    const rememberedPreview = page.locator('[data-folder-snapshot-preview]:visible')
    await expect(rememberedPreview).toContainText(rememberedLocalText)
    await closePreview(page, rememberedPreview)

    reopenedPicker = await openNativeLocalFolderPicker(page)
    await reopenedPicker.native.getByRole('button', { name: 'Manage folder-remembered', exact: true }).click()
    await expect(page.locator('[data-local-folder-detail]')).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(page.getByText('This connection is not available to this account on this device. Saved snapshots remain in their conversations.', { exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
    await page.goto(`${origin}${localSessionPath}`)
    const savedAfterDisconnect = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error('Disconnected local-folder snapshot read failed.')
      return (await response.json()).workspace
    }, localSession.id)
    const foldersAfterDisconnect = savedAfterDisconnect?.workspaces?.flatMap((workspace) => workspace.folders ?? []) ?? []
    const rememberedCopy = foldersAfterDisconnect.find((folder) => folder.id === `ui-host::${rememberedConnectionId}`)
    assert.equal(rememberedCopy?.localSnapshot?.files?.find((file) => file.name === 'remembered-note.md')?.snapshot?.text,
      rememberedLocalText, 'disconnect retains the explicitly saved conversation copy byte-for-byte')
    await send(page, 'Read the saved local snapshots after disconnect.', 'native-local-folder-refreshed')
    assert.deepEqual((endpoint.documents.at(-1)?.attached_files ?? []).map(({ name, status, text }) => ({ name, status, text }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0), [
      { name: 'folder-ephemeral/local-note.md', status: 'ready', text: refreshedLocalText },
      { name: 'folder-remembered/remembered-note.md', status: 'ready', text: rememberedLocalText },
    ], 'the explicit saved copies from before and after relaunch remain usable after disconnect')
    console.log('[desktop-local-folder-connection-smoke] Connect remains non-reading by default · Attach and Refresh capture explicitly · unchecked grants expire · remembered grants survive relaunch · disconnect preserves saved copies')

    run = await smokePackagedLocalGit({
      executable, fixtureRoot, userDataPath, run, providerId: session.providerId, endpoint,
      relaunch: (appExecutable, profilePath) => launch(appExecutable, profilePath),
    })
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
    await page.goto(`${origin}${pptxRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-presentation.pptx' }).click()
    await expect(page.locator('[data-attachment-preview]')).toHaveAttribute('data-attachment-preview', pptxId)
    await expect(page.locator('[data-attachment-preview]')).toContainText(pptxText)
    await expect(page.locator('[data-document-import="ready"]')).toContainText('Visible slide text')
    const savedPptx = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.find((attachment) => attachment.label === 'native-presentation.pptx')
    }, pptxSession.id)
    assert.equal(savedPptx.previewText, pptxText)
    assert.deepEqual(savedPptx.documentImport, { format: 'pptx', status: 'ready' })
    assert.equal(savedPptx.pptxBytes, undefined)
    await closePreview(page)
    await send(page, 'Read the saved presentation again.', 'native-slide-body')
    assert.deepEqual(endpoint.documents.at(-1)?.attached_files, [{
      name: 'native-presentation.pptx', status: 'ready', text: pptxText,
      extraction: { format: 'pptx' },
    }])
    await page.getByTitle('Open in sidebar').filter({ hasText: 'native-presentation.pptx' }).click()
    await page.getByTitle('Remove file', { exact: true }).click()
    try {
      await send(page, 'Check detached presentation.', 'No supplied attachment text.')
    } catch (error) {
      await preserveSmokeFailure(error, () => captureDetachFailure(page, pptxSession.id, endpoint, 'pptx-detach-reply'))
    }
    const detachedPptxInput = endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content
    assert.equal(JSON.stringify(detachedPptxInput).includes('native-slide-body'), false)
    console.log('[desktop-pptx-smoke] real native PPTX bytes + IPC · packaged worker extraction · model body text and metadata · full relaunch without source · detach')
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
    const imageInputs = [
      { name: 'native-image.png', bytes: imageFixture(240, 120), width: 240, height: 120 },
      { name: 'native-image.bmp', bytes: bitmapFixture(160, 80), width: 160, height: 80 },
      { name: 'native-image.ico', bytes: iconFixture(96, 64), width: 96, height: 64 },
      { name: 'native-image.svg', bytes: svgFixture(320, 160), width: 320, height: 160 },
    ].map((input) => ({ ...input, path: join(fixtureRoot, input.name) }))
    await Promise.all(imageInputs.map(({ path, bytes }) => writeFile(path, bytes, { mode: 0o600 })))
    await run.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async (_owner, options) => {
        if (!options.properties.includes('openFile') || !options.properties.includes('multiSelections')) throw new Error('Expected image file selection')
        return { canceled: false, filePaths: path }
      }
    }, imageInputs.map(({ path }) => path))
    const imagePicker = await openFilesPicker(page)
    await imagePicker.getByRole('button', { name: /Add files from this computer/ }).click()
    await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute(
      'data-attachment-image-ready', String(imageInputs.length), { timeout: TIMEOUT_MS },
    )
    await imagePicker.getByRole('button', { name: 'Done', exact: true }).click()
    const imagePreview = page.locator('[data-attachment-preview]')
    await expect(imagePreview).toHaveAttribute('data-attachment-input-status', 'image-ready')
    await expect.poll(() => imagePreview.locator('img').last().evaluate((image, expectedWidths) => image.complete && expectedWidths.includes(image.naturalWidth), imageInputs.map(({ width }) => width))).toBe(true)
    const imageRefs = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.filter((attachment) => attachment.image).map((attachment) => ({
        id: attachment.id, label: attachment.label, image: attachment.image, previewUrl: attachment.previewUrl,
      }))
    }, pdfSession.id)
    assert.equal(imageRefs.length, imageInputs.length)
    assert.equal(new Set(imageRefs.map(({ image }) => image.id)).size, imageInputs.length)
    for (const { image, previewUrl } of imageRefs) {
      assert.match(image.id, /^img-[a-f0-9]{64}$/)
      assert.equal(image.mimeType, 'image/png')
      assert.equal(image.data, undefined)
      assert.equal(previewUrl, undefined)
      assert.deepEqual(Object.keys(image).sort(), ['byteLength', 'height', 'id', 'mimeType', 'width'])
    }
    assert.deepEqual(imageRefs.map(({ label }) => label), imageInputs.map(({ name }) => name))
    for (const [{ image }, { width, height }] of imageRefs.map((entry, index) => [entry, imageInputs[index]])) {
      assert.equal(image.mimeType, 'image/png')
      assert.equal(image.width, width)
      assert.equal(image.height, height)
    }
    const imageIdByName = new Map(imageRefs.map(({ id, label }) => [label, id]))
    const authorizedImageData = await page.evaluate(async (ids) => {
      const encoded = []
      for (const id of ids) {
        const response = await fetch(`/api/v1/image-assets/${encodeURIComponent(id)}/content`)
        if (!response.ok) throw new Error(`Image asset content fetch failed: HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        encoded.push(btoa(binary))
      }
      return encoded
    }, imageRefs.map(({ image }) => image.id))
    assert.deepEqual(imageRefs.map(({ image }) => image.byteLength), authorizedImageData.map((data) => Buffer.from(data, 'base64').byteLength))
    await closePreview(page)
    await send(page, 'Describe the native images.', `Received ${imageInputs.length} supplied image(s).`)
    const imageBlocks = endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content
    const sentImageBlocks = imageBlocks.filter((block) => block.type === 'image')
    assert.equal(sentImageBlocks.length, imageInputs.length)
    assert.deepEqual(sentImageBlocks.map((block) => block.source.media_type), imageRefs.map(({ image }) => image.mimeType))
    assert.deepEqual(sentImageBlocks.map((block) => block.source.data), authorizedImageData)
    assert.equal(JSON.stringify(endpoint.requests).includes(fixtureRoot), false)
    await run.app.close()
    run = undefined
    await Promise.all(imageInputs.map(({ path }) => rm(path)))
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await page.goto(`${origin}${pdfRoute}`)
    const restoredImages = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/v1/sessions/${id}`)).json()
      return detail.workspace.attachments.filter((attachment) => attachment.image).map((attachment) => ({ id: attachment.id, label: attachment.label, image: attachment.image }))
    }, pdfSession.id)
    assert.deepEqual(restoredImages.map(({ label, image }) => ({ label, image })), imageRefs.map(({ label, image }) => ({ label, image })))
    for (const [index, { name, width, height }] of imageInputs.entries()) {
      const remaining = imageInputs.length - index
      if (remaining > 1) {
        await page.getByTitle(`Photos (${remaining})`, { exact: true }).click()
        await page.getByRole('menu', { name: 'Photos', exact: true }).getByRole('button', { name, exact: true }).click()
      } else {
        await page.getByTitle('Open in sidebar', { exact: true }).filter({ hasText: name }).click()
      }
      const restoredPreview = page.locator('[data-attachment-preview]')
      await expect(restoredPreview).toHaveAttribute('data-attachment-preview', imageIdByName.get(name))
      await expect.poll(() => restoredPreview.locator('img').last().evaluate((image, expected) => image.complete && image.naturalWidth === expected.width && image.naturalHeight === expected.height, { width, height })).toBe(true)
      await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
    }
    await send(page, 'Check detached images.', 'No supplied attachment text.')
    const detachedInput = endpoint.requests.at(-1).messages.filter((message) => message.role === 'user').at(-1).content
    assert.equal(typeof detachedInput, 'string', 'detachment excludes image blocks from future turns')
    console.log('[desktop-image-smoke] real native image bytes + IPC · renderer raster conversion · durable asset upload · model image blocks · full relaunch without source · detach')
  } finally {
    await run?.app.close()
    await endpoint?.close()
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}
