import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect } from '@playwright/test'
import { exactLoopbackOrigin } from './runtime.mjs'
import { SMOKE_MODEL_ID, startAttachmentSmokeEndpoint } from './attachmentSmokeFixture.mjs'

const TIMEOUT_MS = 30_000
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
  await composer.fill(text)
  await composer.press('Enter')
  await expect(page.locator('[data-turn]').filter({ hasText: expectedReply })).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
}

async function readMessages(page, sessionId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`Native attachment conversation read: HTTP ${response.status}`)
    return (await response.json()).messages
  }, sessionId)
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
    await run.app.close()
    run = undefined
    await rm(folderPath, { recursive: true })
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await page.goto(`${origin}${folderRoute}`)
    await page.getByTitle('Open in sidebar').filter({ hasText: 'folder-import/' }).click()
    await expect(page.locator('[data-folder-snapshot-preview]')).toContainText(folderText)
    console.log('[desktop-folder-smoke] real native folder reader + IPC · hidden-file exclusion · bounded snapshot preview + model input · full relaunch without source folder')
  } finally {
    await run?.app.close()
    await endpoint?.close()
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}
