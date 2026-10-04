/** Packaged managed-restore acceptance over an exclusively owned throwaway profile.
 * Dialog answers and the relaunch spawn are test fixtures. The rendered controls,
 * trusted IPC, safety backup, backend shutdown, ASAR utility worker, SQLite restore,
 * and subsequent independent application process are real. This phase does not
 * replace ordinary smoke's OS-backed storage or manual native-dialog acceptance.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, expect } from '@playwright/test'
import { AUTH_ROOT_FILE } from './authRoot.mjs'
import { CREDENTIAL_VAULT_FILE } from './credentialVault.mjs'
import { desktopBackupName } from './dataProtocol.mjs'
import { SMOKE_MODEL_ID, startAttachmentSmokeEndpoint } from './attachmentSmokeFixture.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { exactLoopbackOrigin } from './runtime.mjs'

const TIMEOUT_MS = 40_000
const TRACE = '[desktop-restore-fixture] '

async function launch(executable, userDataPath) {
  const app = await _electron.launch({
    executablePath: executable, args: [`--user-data-dir=${userDataPath}`],
    chromiumSandbox: true, timeout: TIMEOUT_MS,
  })
  let output = ''
  app.process().stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-32_768) })
  app.process().stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-32_768) })
  try {
    const page = await app.firstWindow({ timeout: TIMEOUT_MS })
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: TIMEOUT_MS })
    const origin = exactLoopbackOrigin(new URL(page.url()).origin)
    const posture = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, userData: app.getPath('userData'),
      preferences: BrowserWindow.getAllWindows().map(window => {
        const { sandbox, contextIsolation, nodeIntegration } = window.webContents.getLastWebPreferences()
        return { sandbox, contextIsolation, nodeIntegration }
      }),
    }))
    assert.equal(posture.packaged, true)
    assert.equal(posture.userData, userDataPath)
    assert.deepEqual(posture.preferences, [{ sandbox: true, contextIsolation: true, nodeIntegration: false }])
    return { app, page, origin, output: () => output }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function post(page, path, body, key) {
  return page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Restore smoke precondition ${path}: HTTP ${response.status}`)
    return response.json()
  }, { path, body, key })
}

async function readWorkspace(page) {
  return page.evaluate(async () => {
    const get = async path => {
      const response = await fetch(path)
      if (!response.ok) throw new Error(`Restore smoke read ${path}: HTTP ${response.status}`)
      return response.json()
    }
    const [identity, artifacts, contents, sessions] = await Promise.all([
      get('/api/v1/me'), get('/api/v1/artifacts'), get('/api/v1/artifact-content'), get('/api/v1/sessions'),
    ])
    const conversations = await Promise.all(sessions.map(session => get(`/api/v1/sessions/${encodeURIComponent(session.id)}`)))
    return {
      userId: identity.user.id, tenantId: identity.tenant.id,
      artifacts: artifacts.map(({ id, name, kind }) => ({ id, name, kind })).sort((a, b) => a.id.localeCompare(b.id)),
      contents,
      conversations: conversations.map(({ id, title, messages }) => ({ id, title, messages }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }
  })
}

async function backup(run, userDataPath) {
  const directory = join(userDataPath, 'snapshots')
  const before = new Set(await readdir(directory))
  await run.page.getByRole('button', { name: 'Back up now', exact: true }).click()
  await expect(run.page.getByRole('status').filter({ hasText: /^Saved backup-/ })).toBeVisible()
  const added = (await readdir(directory)).filter(name => !before.has(name))
  assert.equal(added.length, 1, 'one rendered backup action creates exactly one managed copy')
  const fileName = added[0]
  assert.match(fileName, /^backup-.*\.json$/)
  return { fileName, path: join(directory, fileName), state: JSON.parse(await readFile(join(directory, fileName), 'utf8')) }
}

async function installDialogs(run, selectedPath) {
  return run.app.evaluateHandle(({ app, dialog }, { selectedPath, tracePrefix }) => {
    const state = { selectedPath, cancelPicker: false, response: 0, calls: [], errors: [], relaunches: 0 }
    dialog.showOpenDialog = async (_owner, options) => {
      state.calls.push({ kind: 'picker', options })
      if (options.title !== 'Restore Agent Commons from backup') throw new Error('Unexpected restore-smoke picker')
      return state.cancelPicker ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [state.selectedPath] }
    }
    dialog.showMessageBox = async (_owner, options) => {
      state.calls.push({ kind: 'confirmation', options })
      if (options.title !== 'Restore Agent Commons?') throw new Error('Unexpected restore-smoke confirmation')
      return { response: state.response }
    }
    dialog.showErrorBox = (title, content) => { state.errors.push({ title, content }) }
    // Playwright owns the inspector connection. Record the production restart
    // request, let the real process exit, then let the test launch its successor.
    // No restart hook or fixture is included in the shipped application.
    app.relaunch = () => { state.relaunches += 1 }
    const exit = app.exit.bind(app)
    app.exit = code => {
      console.log(tracePrefix + JSON.stringify({ ...state, exitCode: code }))
      exit(code)
    }
    return state
  }, { selectedPath, tracePrefix: TRACE })
}

async function setAnswer(handle, values) {
  await handle.evaluate((state, values) => { Object.assign(state, values); state.calls = []; state.errors = [] }, values)
}

function assertConfirmation(trace, fileName) {
  assert.equal(trace.calls.length, 2)
  assert.equal(trace.calls[0].kind, 'picker')
  const options = trace.calls[1].options
  assert.equal(trace.calls[1].kind, 'confirmation')
  assert.equal(options.message, `Restore “${fileName}”?`)
  assert.deepEqual(options.buttons, ['Cancel', 'Restore and restart'])
  assert.equal(options.defaultId, 0)
  assert.equal(options.cancelId, 0)
  assert.match(options.detail, /first save a fresh safety backup/)
}

async function restoreAndExit(run, fileName, expectedExitCode) {
  const child = run.app.process()
  let timer
  let onExit
  let onError
  const exited = new Promise((resolve, reject) => {
    onExit = (code, signal) => resolve({ code, signal })
    onError = reject
    // 'close' also proves the final restart trace drained from stdout/stderr.
    child.once('close', onExit)
    child.once('error', onError)
    timer = setTimeout(() => reject(new Error(`Packaged restore did not exit.\n${run.output()}`)), TIMEOUT_MS)
  })
  try {
    await run.page.getByRole('button', { name: 'Restore backup…', exact: true }).click()
    const result = await Promise.race([
      exited,
      run.page.getByRole('alert').filter({ hasText: 'The backup could not be restored. Your current app data was not changed.' })
        .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
        .then(() => { throw new Error(`Packaged restore was refused before shutdown.\n${run.output()}`) }, error => {
          if (run.page.isClosed()) return exited
          throw error
        }),
    ])
    assert.deepEqual(result, { code: expectedExitCode, signal: null })
    const traceLine = run.output().split('\n').find(line => line.startsWith(TRACE))
    assert.ok(traceLine, 'the packaged shell reached its restart boundary')
    const trace = JSON.parse(traceLine.slice(TRACE.length))
    assertConfirmation(trace, fileName)
    assert.equal(trace.relaunches, 1, 'the real restore lifecycle requested exactly one whole-app restart')
    assert.equal(trace.exitCode, expectedExitCode)
    if (expectedExitCode === 0) assert.deepEqual(trace.errors, [])
    else {
      assert.equal(trace.errors.length, 1)
      assert.equal(trace.errors[0].title, 'Couldn’t restore backup')
      assert.match(trace.errors[0].content, /pre-restore safety copy/)
    }
    await assert.rejects(fetch(`${run.origin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }),
      'the old local service is stopped before a replacement process starts')
  } finally {
    clearTimeout(timer)
    child.off('close', onExit)
    child.off('error', onError)
  }
}

async function newSafetyCopy(directory, before, expectedWorkspace) {
  const added = (await readdir(directory)).filter(name => !before.has(name))
  assert.equal(added.length, 1, 'restore creates exactly one fresh safety backup')
  const fileName = added[0]
  assert.match(fileName, /^backup-.*\.json$/)
  const state = JSON.parse(await readFile(join(directory, fileName), 'utf8'))
  assert.deepEqual(state.graph.extraArtifacts.map(({ id, name, kind }) => ({ id, name, kind }))
    .sort((a, b) => a.id.localeCompare(b.id)), expectedWorkspace.artifacts,
  'the safety copy contains the actual pre-restore artifact registry')
  for (const artifact of expectedWorkspace.artifacts) {
    assert.deepEqual(state.artifactBodies.find(([id]) => id === artifact.id)?.[1], expectedWorkspace.contents[artifact.id],
      'the safety copy preserves each exact pre-restore body')
  }
  return { fileName, path: join(directory, fileName) }
}

export async function smokePackagedRestore({ executable = packagedExecutable() } = {}) {
  const userDataPath = await realpath(await mkdtemp(join(tmpdir(), 'agent-commons-native-restore-')))
  const directory = join(userDataPath, 'snapshots')
  let run
  let endpoint
  try {
    endpoint = await startAttachmentSmokeEndpoint()
    run = await launch(executable, userDataPath)
    const identity = await post(run.page, '/api/v1/auth/signup', {
      name: 'Restore Smoke', email: 'restore-smoke@example.test', password: 'isolated-restore-password',
    })
    const token = await post(run.page, '/api/v1/auth/token', { label: 'Pre-backup token' }, 'restore-smoke-token')
    assert.equal(token.identity.user.id, identity.user.id)
    const secret = 'restore-smoke-local-fixture-key'
    const reference = await run.page.evaluate(secret => window.agentCommonsDesktop.credentials.provision(secret), secret)
    const provider = await post(run.page, '/api/v1/providers', {
      label: 'Restore credential fixture', modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.origin, model: SMOKE_MODEL_ID, apiKeyEnv: reference },
    })
    await run.page.evaluate(({ reference, providerId }) => window.agentCommonsDesktop.credentials.bind(reference, providerId),
      { reference, providerId: provider.id })
    for (const [kind, body] of [
      ['doc', 'Before restore: exact document body.'],
      ['sheet', { type: 'sheet', columns: ['Phase', 'Literal'], rows: [['Before', '=1+2']] }],
      ['slide', { type: 'slides', slides: [{ title: 'Before restore', bullets: ['Exact slide content'] }] }],
    ]) await post(run.page, '/api/v1/artifacts', { name: `Restore ${kind}`, kind, body }, `restore-smoke-${kind}`)
    await post(run.page, '/api/v1/sessions', { firstMessage: 'Saved before restore', persistFirstMessage: true })
    await run.page.goto(`${run.origin}/customize`)
    const baseline = await readWorkspace(run.page)
    assert.equal(baseline.artifacts.length, 3)
    assert.equal(baseline.conversations.length, 1)
    assert.equal(baseline.conversations[0].messages.length, 1)
    const selected = await backup(run, userDataPath)
    const encryptedRoot = await readFile(join(userDataPath, AUTH_ROOT_FILE), 'utf8')
    const vaultPath = join(userDataPath, CREDENTIAL_VAULT_FILE)
    const encryptedVault = await readFile(vaultPath, 'utf8')
    assert.equal(JSON.parse(encryptedVault).entries[reference].providerId, provider.id)
    assert.ok(!encryptedVault.includes(secret), 'the test key is not plaintext in the device vault')
    assert.ok(!JSON.stringify(selected.state).includes(secret), 'the portable backup excludes the provider key')
    assert.ok(!JSON.stringify(selected.state).includes(JSON.parse(encryptedRoot).ciphertext))

    await post(run.page, '/api/v1/artifacts', { name: 'Only in safety copy', kind: 'doc', body: 'After backup: do not lose this safety copy.' }, 'restore-smoke-later')
    await post(run.page, '/api/v1/sessions', { firstMessage: 'Saved after backup', persistFirstMessage: true })
    const current = await readWorkspace(run.page)
    assert.equal(current.artifacts.length, 4)
    assert.equal(current.conversations.length, 2)
    let dialogs = await installDialogs(run, selected.path)
    const beforeCancel = new Set(await readdir(directory))
    await setAnswer(dialogs, { cancelPicker: true })
    await run.page.getByRole('button', { name: 'Restore backup…', exact: true }).click()
    await expect(run.page.getByRole('button', { name: 'Restore backup…', exact: true })).toBeEnabled()
    let trace = await dialogs.jsonValue()
    assert.equal(trace.calls.length, 1)
    assert.equal(trace.relaunches, 0)
    await setAnswer(dialogs, { cancelPicker: false, response: 0 })
    await run.page.getByRole('button', { name: 'Restore backup…', exact: true }).click()
    await expect(run.page.getByRole('button', { name: 'Restore backup…', exact: true })).toBeEnabled()
    trace = await dialogs.jsonValue()
    assertConfirmation(trace, selected.fileName)
    assert.equal(trace.relaunches, 0)
    assert.deepEqual(await readWorkspace(run.page), current, 'both cancellations preserve the current workspace')
    assert.deepEqual(new Set(await readdir(directory)), beforeCancel, 'cancellation makes no safety copy or replacement')
    console.log('[desktop-restore-smoke] picker and confirmation cancellation preserve current state')

    await setAnswer(dialogs, { response: 1 })
    await restoreAndExit(run, selected.fileName, 0)
    const safety = await newSafetyCopy(directory, beforeCancel, current)
    run = await launch(executable, userDataPath)
    assert.deepEqual(await readWorkspace(run.page), baseline, 'restored workspace exactly matches the chosen backup')
    assert.equal(await readFile(join(userDataPath, AUTH_ROOT_FILE), 'utf8'), encryptedRoot)
    assert.equal(await readFile(vaultPath, 'utf8'), encryptedVault, 'restore preserves the existing pre-backup provider vault')
    const tokenResponse = await fetch(`${run.origin}/api/v1/me`, { headers: { authorization: `Bearer ${token.token}` } })
    assert.equal(tokenResponse.status, 200)
    assert.equal((await tokenResponse.json()).user.id, baseline.userId, 'pre-backup personal-token authority survives restore')
    console.log('[desktop-restore-smoke] selected backup restored exact artifact bodies, conversations and pre-backup token')

    // Prove the safety copy is usable, not merely a file with a plausible name.
    await run.page.goto(`${run.origin}/customize`)
    dialogs = await installDialogs(run, safety.path)
    await setAnswer(dialogs, { response: 1 })
    const beforeUndo = new Set(await readdir(directory))
    await restoreAndExit(run, safety.fileName, 0)
    await newSafetyCopy(directory, beforeUndo, baseline)
    run = await launch(executable, userDataPath)
    assert.deepEqual(await readWorkspace(run.page), current, 'the safety copy recovers the complete pre-restore workspace')
    console.log('[desktop-restore-smoke] safety-copy restore recovers exact post-backup work')

    // A well-named but malformed snapshot must fail without replacing live data.
    const invalidName = `${desktopBackupName()}.json`
    const invalidPath = join(directory, invalidName)
    await writeFile(invalidPath, '{"version":', { flag: 'wx', mode: 0o600 })
    await run.page.goto(`${run.origin}/customize`)
    dialogs = await installDialogs(run, invalidPath)
    await setAnswer(dialogs, { response: 1 })
    const beforeInvalid = new Set(await readdir(directory))
    await restoreAndExit(run, invalidName, 1)
    await newSafetyCopy(directory, beforeInvalid, current)
    run = await launch(executable, userDataPath)
    assert.deepEqual(await readWorkspace(run.page), current, 'invalid backup refusal preserves the entire tested workspace')
    assert.equal(await readFile(join(userDataPath, AUTH_ROOT_FILE), 'utf8'), encryptedRoot)
    assert.equal(await readFile(vaultPath, 'utf8'), encryptedVault)
    console.log('[desktop-restore-smoke] rendered controls · picker/confirmation cancellation · real safety backup + backend stop + ASAR restore worker · exact document/sheet/slides/conversation recovery · usable safety copy · malformed backup refusal · independent relaunch · unchanged pre-backup provider vault + device auth root + personal token')
  } finally {
    await run?.app.close().catch(() => {})
    await endpoint?.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedRestore()
