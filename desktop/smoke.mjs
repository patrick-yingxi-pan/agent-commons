import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { startModelServer } from '../server/model/index.ts'
import { CREDENTIAL_VAULT_FILE } from './credentialVault.mjs'
import { AUTH_ROOT_FILE } from './authRoot.mjs'
import { smokePackagedAttachments } from './attachmentSmoke.mjs'
import { smokePackagedMcpCredentials } from './mcpCredentialSmoke.mjs'
import { smokePackagedMcpSchema } from './mcpSchemaSmoke.mjs'
import { smokePackagedRestore } from './restoreSmoke.mjs'
import { smokePackagedProfileAdmission } from './profileAdmissionSmoke.mjs'
import { smokePackagedBundledGit } from './bundledGitSmoke.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { findAvailableLoopbackPort, loopbackOrigin } from './runtime.mjs'

export { packagedExecutable } from './smokePaths.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 16_384
const USER_DATA_SENTINEL = '.user-data-permissions-smoke'
const USER_DATA_SENTINEL_BYTES = Buffer.from('preserve this user-data file across private startup\0\x01')

function appendTail(current, chunk) {
  return `${current}${chunk}`.slice(-OUTPUT_LIMIT)
}

function storedUsage(userDataPath, tenantId) {
  // Read the actual committed WAL without importing a source-only store or
  // mutating the running artifact's database through a fixture.
  const database = new DatabaseSync(join(userDataPath, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?').get('usageMeters', tenantId)
    return row ? JSON.parse(row.json) : undefined
  } finally {
    database.close()
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), 5_000)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))])
  }
}

async function waitForCdp(origin) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The packaged renderer did not expose its isolated smoke-test debugging endpoint.')
}

async function launchPackagedDesktop(executable, userDataPath) {
  const debuggingOrigin = loopbackOrigin(await findAvailableLoopbackPort())
  let output = ''
  const child = spawn(executable, [
    `--user-data-dir=${userDataPath}`,
    `--remote-debugging-port=${new URL(debuggingOrigin).port}`,
  ], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output = appendTail(output, chunk) })
  child.stderr.on('data', (chunk) => { output = appendTail(output, chunk) })
  let browser = null

  try {
    const origin = await new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.stdout.off('data', inspect)
        child.stderr.off('data', inspect)
        child.off('error', onError)
        child.off('exit', onExit)
        error ? reject(error) : resolve(value)
      }
      const inspect = () => {
        const match = output.match(/\[desktop\] ready (http:\/\/127\.0\.0\.1:\d+)/)
        if (!match) return
        finish(null, match[1])
      }
      const onError = (error) => finish(error)
      const onExit = (code, signal) => finish(
        new Error(`Packaged desktop exited before readiness (${signal ?? `code ${code}`}).\n\n${output}`),
      )
      const timeout = setTimeout(
        () => finish(new Error(`Packaged desktop did not become ready.\n\n${output}`)),
        TIMEOUT_MS,
      )
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('error', onError)
      child.once('exit', onExit)
      inspect()
    })
    await waitForCdp(debuggingOrigin)
    browser = await chromium.connectOverCDP(debuggingOrigin)
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(origin))
    if (!page) throw new Error('Packaged Electron did not expose the trusted renderer page.')
    return { child, browser, page, origin, output }
  } catch (error) {
    await browser?.close().catch(() => {})
    await stop(child)
    throw error
  }
}

async function closePackagedDesktop(run) {
  if (!run) return
  await run.browser.close().catch(() => {})
  await stop(run.child)
}

async function assertPrivateUserDataFixture(userDataPath, phase) {
  if (process.platform === 'win32') return
  const [directoryStat, sentinel] = await Promise.all([
    stat(userDataPath),
    readFile(join(userDataPath, USER_DATA_SENTINEL)),
  ])
  if ((directoryStat.mode & 0o777) !== 0o700) {
    throw new Error(`Packaged desktop did not preserve the private user-data directory after ${phase}.`)
  }
  if (!USER_DATA_SENTINEL_BYTES.equals(sentinel)) {
    throw new Error(`Packaged desktop changed the user-data sentinel during ${phase}.`)
  }
}

export async function smokePackagedDesktop({ executable = packagedExecutable() } = {}) {
  if (!existsSync(executable)) throw new Error(`Packaged desktop executable is missing: ${executable}`)
  await smokePackagedBundledGit({ executable })
  await smokePackagedProfileAdmission({ executable })
  const userDataPath = await mkdtemp(join(tmpdir(), 'agent-commons-desktop-smoke-'))
  const modelOrigin = loopbackOrigin(await findAvailableLoopbackPort())
  const modelServer = startModelServer(Number(new URL(modelOrigin).port), '127.0.0.1')
  let run
  try {
    await writeFile(join(userDataPath, USER_DATA_SENTINEL), USER_DATA_SENTINEL_BYTES, { mode: 0o600, flag: 'wx' })
    await assertPrivateUserDataFixture(userDataPath, 'fixture creation')
    await new Promise((resolve, reject) => {
      if (modelServer.listening) return resolve()
      modelServer.once('listening', resolve)
      modelServer.once('error', reject)
    })
    run = await launchPackagedDesktop(executable, userDataPath)
    await assertPrivateUserDataFixture(userDataPath, 'initial startup')
    let { origin, page } = run
    const response = await fetch(origin, { redirect: 'error' })
    const html = await response.text()
    if (!response.ok || !html.includes('<title>Agent Commons</title>')) {
      throw new Error(`Packaged renderer probe failed with HTTP ${response.status}.`)
    }
    if (!existsSync(join(userDataPath, 'store.db'))) {
      throw new Error('Packaged desktop did not create its SQLite store under isolated OS user data.')
    }
    const hasCredentialBridge = await page.evaluate(() =>
      typeof window.agentCommonsDesktop?.credentials?.provision === 'function' &&
      Object.keys(window.agentCommonsDesktop.credentials).sort().join(',') === 'bind,discard,provision,removeProvider',
    )
    const hasDataBridge = await page.evaluate(() =>
      typeof window.agentCommonsDesktop?.data?.createBackup === 'function' &&
      typeof window.agentCommonsDesktop?.data?.getRecoveryStatus === 'function' &&
      typeof window.agentCommonsDesktop?.data?.restoreBackup === 'function' &&
      Object.keys(window.agentCommonsDesktop.data).sort().join(',') === 'createBackup,getRecoveryStatus,restoreBackup,revealBackups',
    )
    if (!hasDataBridge) throw new Error('The narrow desktop data bridge was not available.')
    const hasContextBridge = await page.evaluate(() =>
      typeof window.agentCommonsDesktop?.context?.pickFiles === 'function' &&
      typeof window.agentCommonsDesktop?.context?.pickFolder === 'function' &&
      typeof window.agentCommonsDesktop?.context?.localFolders?.list === 'function' &&
      typeof window.agentCommonsDesktop?.context?.localFolders?.connect === 'function' &&
      typeof window.agentCommonsDesktop?.context?.localFolders?.snapshot === 'function' &&
      typeof window.agentCommonsDesktop?.context?.localFolders?.disconnect === 'function' &&
      Object.keys(window.agentCommonsDesktop.context).sort().join(',') === 'localFolders,pickFiles,pickFolder' &&
      Object.keys(window.agentCommonsDesktop.context.localFolders).sort().join(',') === 'connect,disconnect,list,snapshot',
    )
    if (!hasContextBridge) throw new Error('The narrow native context picker bridge was not available.')
    const recoveryDirectory = join(userDataPath, 'snapshots')
    const automaticFiles = await readdir(recoveryDirectory)
    const automaticFile = automaticFiles.find((file) => /^recovery-\d{4}-\d{2}-\d{2}\.json$/.test(file))
    if (!automaticFile) throw new Error('Packaged desktop startup did not create its daily recovery point.')
    const recoveryStatus = await page.evaluate(() => window.agentCommonsDesktop.data.getRecoveryStatus())
    if (
      recoveryStatus?.status !== 'ready' ||
      recoveryStatus.backup?.fileName !== automaticFile ||
      Object.keys(recoveryStatus.backup ?? {}).sort().join(',') !== 'createdAt,fileName,sizeBytes'
    ) {
      throw new Error('The packaged desktop did not disclose its path-free automatic recovery status.')
    }
    const automaticState = JSON.parse(await readFile(join(recoveryDirectory, automaticFile), 'utf8'))
    if (!Number.isSafeInteger(automaticState.version) || !Array.isArray(automaticState.sessions)) {
      throw new Error('The packaged daily recovery point was not a canonical portable snapshot.')
    }
    const backup = await page.evaluate(() => window.agentCommonsDesktop.data.createBackup())
    if (
      !/^backup-.*\.json$/.test(backup?.fileName ?? '') ||
      !Number.isSafeInteger(backup?.sizeBytes) ||
      Object.keys(backup ?? {}).sort().join(',') !== 'createdAt,fileName,sizeBytes'
    ) {
      throw new Error('The desktop backup bridge returned unbounded or invalid metadata.')
    }
    const backupPath = join(recoveryDirectory, backup.fileName)
    if (!existsSync(backupPath)) throw new Error('The packaged desktop did not create its managed portable backup.')
    const backupState = JSON.parse(await readFile(backupPath, 'utf8'))
    if (!Number.isSafeInteger(backupState.version) || !Array.isArray(backupState.sessions)) {
      throw new Error('The packaged desktop backup was not a canonical portable snapshot.')
    }
    if (process.platform !== 'win32') {
      const [directoryStat, backupStat, automaticStat] = await Promise.all([
        stat(recoveryDirectory),
        stat(backupPath),
        stat(join(recoveryDirectory, automaticFile)),
      ])
      if ((directoryStat.mode & 0o777) !== 0o700 || (backupStat.mode & 0o777) !== 0o600 || (automaticStat.mode & 0o777) !== 0o600) {
        throw new Error('Packaged desktop recovery files were not private to the OS user.')
      }
    }
    if (run.output.includes('· secure credentials') && !hasCredentialBridge) {
      throw new Error('OS-backed credential storage was available but its narrow preload bridge was not.')
    }

    // Exercise real cookie, account-stack, and personal-token authority. These
    // must remain the same identity across independent native process lifetimes.
    const identity = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Desktop Smoke', email: 'desktop-smoke@example.test', password: 'isolated-smoke-password' }),
      })
      if (!response.ok) throw new Error(`packaged signup returned ${response.status}`)
      return response.json()
    })
    await page.reload()
    const token = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/token', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'packaged-restart-token' },
        body: JSON.stringify({ label: 'Packaged restart smoke' }),
      })
      if (!response.ok) throw new Error(`packaged token mint returned ${response.status}`)
      return response.json()
    })
    if (!token.token || token.identity.user.id !== identity.user.id) throw new Error('The smoke token has the wrong identity.')
    const directArtifacts = await page.evaluate(async () => {
      const name = 'Packaged direct output'
      const definitions = [
        { key: 'packaged-artifact-document', kind: 'doc', body: 'A direct packaged document.' },
        { key: 'packaged-artifact-sheet', kind: 'sheet', body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Launch', '=SUM(A1:A2)']] } },
        { key: 'packaged-artifact-slides', kind: 'slide', body: { type: 'slides', slides: [{ title: 'Packaged launch', bullets: ['Direct creation'] }] } },
      ]
      const created = []
      for (const definition of definitions) {
        const response = await fetch('/api/v1/artifacts', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': definition.key },
          body: JSON.stringify({ name, kind: definition.kind, body: definition.body }),
        })
        if (response.status !== 201) throw new Error(`direct ${definition.kind} creation returned ${response.status}`)
        const payload = await response.json()
        if (payload.artifact?.name !== name || payload.artifact?.kind !== definition.kind) {
          throw new Error(`direct ${definition.kind} creation returned the wrong Artifact`)
        }
        created.push({ ...definition, name, id: payload.artifact.id })
      }
      if (new Set(created.map(({ id }) => id)).size !== created.length) {
        throw new Error('Same-name direct artifact keys did not remain distinct.')
      }
      const retry = await fetch('/api/v1/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': definitions[1].key },
        body: '{"changed":',
      })
      const represented = await retry.json()
      if (retry.status !== 200 || represented.artifact?.id !== created[1].id) {
        throw new Error('A changed-payload Retry did not recover the exact direct Artifact.')
      }
      const contentsResponse = await fetch('/api/v1/artifact-content')
      const contents = await contentsResponse.json()
      if (!contentsResponse.ok || created.some(({ id, name, kind, body }) => JSON.stringify(contents[id]) !== JSON.stringify(
        kind === 'doc'
          ? { type: 'doc', title: name, blocks: [{ p: body }], revision: 0 }
          : { ...body, revision: 0 },
      ))) {
        throw new Error('Direct Artifact creation did not expose each exact canonical body.')
      }
      return created
    })
    const rootPath = join(userDataPath, AUTH_ROOT_FILE)
    const encryptedRoot = await readFile(rootPath, 'utf8')
    const ciphertext = JSON.parse(encryptedRoot).ciphertext
    if ([automaticState, backupState].some((snapshot) => JSON.stringify(snapshot).includes(ciphertext))) {
      throw new Error('A portable product backup included the device authentication root.')
    }
    if (process.platform !== 'win32' && ((await stat(rootPath)).mode & 0o777) !== 0o600) {
      throw new Error('The device authentication root was not private to the OS user.')
    }

    // The isolated user-data directory is a genuine clean release world. Prove
    // the renderer explains the blocked first draft and that its one action
    // reaches the canonical provider form through pane-local navigation.
    await page.getByRole('heading', { name: 'Connect a model to begin' }).waitFor()
    const blockedComposer = page.getByPlaceholder('Connect a model provider to begin…')
    if (!(await blockedComposer.isDisabled())) throw new Error('The clean desktop composer invited an impossible first turn.')
    await page.getByRole('button', { name: 'Connect a model', exact: true }).click()
    await page.waitForURL(`${origin}/models`)
    const firstProviderDialog = page.getByRole('dialog', { name: 'New provider' })
    await firstProviderDialog.waitFor()

    if (hasCredentialBridge) {
      const smokeSecret = 'agent-commons-smoke-key-not-a-real-credential'
      const replacementSecret = 'agent-commons-smoke-rotated-key-not-a-real-credential'
      await page.getByPlaceholder('e.g. Anthropic (prod)', { exact: true }).fill('Packaged credential smoke')
      await page.getByPlaceholder('https://models.example.com/v1', { exact: true }).fill(modelOrigin)
      await page.getByPlaceholder('Paste API key', { exact: true }).fill(smokeSecret)
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await firstProviderDialog.waitFor({ state: 'hidden' })
      await page.waitForURL(`${origin}/`)
      await page.getByRole('heading', { name: 'What should we work on?' }).waitFor()
      if (await page.getByPlaceholder('Reply to Claude…').isDisabled()) {
        throw new Error('A verified packaged provider did not reopen an executable first draft.')
      }

      const providers = await page.evaluate(async () => {
        const response = await fetch('/api/v1/providers')
        if (!response.ok) throw new Error(`provider read returned ${response.status}`)
        return response.json()
      })
      const created = providers.find((provider) => provider.label === 'Packaged credential smoke')
      if (!created || !/^provider-/.test(created.id)) throw new Error('The packaged provider workflow did not create its provider.')
      const configuredPreference = await page.evaluate(async () => {
        const response = await fetch('/api/v1/viewer-preferences/model')
        if (!response.ok) throw new Error(`packaged model preference read returned ${response.status}`)
        return response.json()
      })
      if (
        configuredPreference.userId !== identity.user.id ||
        configuredPreference.tenantId !== identity.tenant.id ||
        !Number.isSafeInteger(configuredPreference.revision) ||
        configuredPreference.revision < 1 ||
        configuredPreference.preferences?.providerId !== created.id
      ) {
        throw new Error('The packaged first-run handoff did not durably select its exact personal model provider.')
      }
      await expect(page.getByRole('button', { name: 'Model and effort' })).toContainText(created.label)
      if (JSON.stringify(providers).includes(smokeSecret) || providers.some((provider) => provider.config || provider.apiKeyEnv)) {
        throw new Error('A packaged provider read exposed write-only credential configuration.')
      }
      const vaultPath = join(userDataPath, CREDENTIAL_VAULT_FILE)
      const vault = await readFile(vaultPath, 'utf8')
      if (vault.includes(smokeSecret)) throw new Error('The packaged credential vault wrote a raw secret to disk.')
      const beforeRotation = JSON.parse(vault)
      const [previousReference] = Object.keys(beforeRotation.entries ?? {})
      if (!previousReference) throw new Error('The packaged provider workflow did not bind its encrypted credential.')

      assert.equal(storedUsage(userDataPath, identity.tenant.id)?.fiveHour.consumed ?? 0, 0, 'a new desktop account has no fictional usage')
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Say hello from this saved desktop conversation.')
      await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
      await page.waitForURL(/\/s\/[^/]+$/)
      await expect(page.getByText('The model here is a local mock', { exact: false }).first()).toBeVisible({ timeout: TIMEOUT_MS })
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
      const sessionPath = new URL(page.url()).pathname
      const savedSession = await page.evaluate(async (path) => {
        const response = await fetch(`/api/v1/sessions/${path.split('/').at(-1)}`)
        if (!response.ok) throw new Error(`packaged session read returned ${response.status}`)
        return response.json()
      }, sessionPath)
      if (!savedSession.messages?.some((message) => message.role === 'assistant' && message.content.includes('local mock'))) {
        throw new Error('The packaged conversation did not persist its completed provider reply.')
      }
      const recordedUsage = storedUsage(userDataPath, identity.tenant.id)
      assert.ok(recordedUsage?.fiveHour.consumed > 0, 'a completed packaged model turn must durably record usage')
      assert.equal(recordedUsage.weekly.consumed, recordedUsage.fiveHour.consumed, 'both windows record the same first-turn spend')

      const firstOrigin = origin
      await closePackagedDesktop(run)
      // A port-zero allocation may legally reuse the previous port. Occupy it
      // only in this test while launching B so the different-origin proof is
      // deterministic without changing production origin policy.
      const retiredOrigin = createServer((socket) => socket.destroy())
      try {
        await new Promise((resolve, reject) => {
          retiredOrigin.once('error', reject)
          retiredOrigin.listen(Number(new URL(firstOrigin).port), '127.0.0.1', resolve)
        })
        await assertPrivateUserDataFixture(userDataPath, 'before relaunch')
        run = await launchPackagedDesktop(executable, userDataPath)
      } finally {
        await new Promise((resolve) => retiredOrigin.close(resolve))
      }
      await assertPrivateUserDataFixture(userDataPath, 'relaunch')
      ;({ origin, page } = run)
      if (origin === firstOrigin) throw new Error('The packaged relaunch did not exercise a different loopback origin.')
      const reopenedIdentity = await page.evaluate(async () => (await fetch('/api/v1/me')).json())
      if (reopenedIdentity.via !== 'session' || reopenedIdentity.user.id !== identity.user.id) {
        throw new Error('The packaged relaunch lost its signed-in account.')
      }
      const remembered = await page.evaluate(async () => (await fetch('/api/v1/auth/accounts')).json())
      if (!remembered.some((account) => account.user.id === identity.user.id)) {
        throw new Error('The packaged relaunch lost its remembered-account stack.')
      }
      const bearerResponse = await fetch(`${origin}/api/v1/me`, { headers: { authorization: `Bearer ${token.token}` } })
      const bearerIdentity = await bearerResponse.json()
      if (!bearerResponse.ok || bearerIdentity.via !== 'session' || bearerIdentity.user.id !== identity.user.id) {
        throw new Error('A personal token stopped working after the packaged relaunch.')
      }
      const recoveredToken = await page.evaluate(async () => {
        const response = await fetch('/api/v1/auth/token', { headers: { 'idempotency-key': 'packaged-restart-token' } })
        if (!response.ok) throw new Error(`token recovery returned ${response.status}`)
        return response.json()
      })
      if (recoveredToken.session?.token !== token.token) throw new Error('The relaunched app could not recover its exact original token.')
      const reopenedPreference = await page.evaluate(async () => {
        const response = await fetch('/api/v1/viewer-preferences/model')
        if (!response.ok) throw new Error(`relaunched model preference read returned ${response.status}`)
        return response.json()
      })
      if (JSON.stringify(reopenedPreference) !== JSON.stringify(configuredPreference)) {
        throw new Error('The packaged relaunch changed the exact personal model preference.')
      }
      await page.goto(`${origin}/`)
      await page.getByRole('heading', { name: 'What should we work on?' }).waitFor()
      await expect(page.getByRole('button', { name: 'Model and effort' })).toContainText(created.label)
      if (await page.getByPlaceholder('Reply to Claude…').isDisabled()) {
        throw new Error('The packaged relaunch lost its configured provider on a fresh draft.')
      }
      const reopenedDirectArtifacts = await page.evaluate(async (created) => {
        const [artifactsResponse, contentsResponse] = await Promise.all([
          fetch('/api/v1/artifacts'),
          fetch('/api/v1/artifact-content'),
        ])
        const artifacts = await artifactsResponse.json()
        const contents = await contentsResponse.json()
        if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('Relaunched direct Artifact reads failed.')
        for (const { id, name, kind, body } of created) {
          const artifact = artifacts.find((candidate) => candidate.id === id)
          if (artifact?.name !== name || artifact?.kind !== kind) {
            throw new Error('The packaged relaunch lost an exact direct Artifact row.')
          }
          const expectedBody = kind === 'doc'
            ? { type: 'doc', title: name, blocks: [{ p: body }], revision: 0 }
            : { ...body, revision: 0 }
          if (JSON.stringify(contents[id]) !== JSON.stringify(expectedBody)) {
            throw new Error('The packaged relaunch changed a direct Artifact body.')
          }
        }
        const retry = await fetch('/api/v1/artifacts', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': created[1].key },
          body: '{"changed":',
        })
        const represented = await retry.json()
        return { status: retry.status, id: represented.artifact?.id }
      }, directArtifacts)
      if (reopenedDirectArtifacts.status !== 200 || reopenedDirectArtifacts.id !== directArtifacts[1].id) {
        throw new Error('The packaged relaunch could not recover the exact keyed direct Artifact.')
      }
      const revoked = await page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/auth/tokens/${id}`, { method: 'DELETE' })
        return response.status
      }, token.tokenId)
      const afterRevocation = await fetch(`${origin}/api/v1/auth/tokens`, { headers: { authorization: `Bearer ${token.token}` } })
      if (revoked !== 200 || afterRevocation.status !== 401) throw new Error('Persisting the signing root weakened token revocation.')
      if (await readFile(rootPath, 'utf8') !== encryptedRoot) throw new Error('An ordinary relaunch replaced the authentication root.')
      await page.goto(`${origin}${sessionPath}`)
      await expect(page.getByText('The model here is a local mock', { exact: false }).first()).toBeVisible()
      const reopenedSession = await page.evaluate(async (id) => (await fetch(`/api/v1/sessions/${id}`)).json(), savedSession.id)
      if (JSON.stringify(reopenedSession.messages) !== JSON.stringify(savedSession.messages)) {
        throw new Error('The packaged relaunch changed the saved conversation.')
      }
      assert.deepEqual(storedUsage(userDataPath, identity.tenant.id), recordedUsage, 'packaged relaunch must preserve exact usage counters and reset anchors')
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()

      await page.goto(`${origin}/models/${encodeURIComponent(created.id)}`)
      await page.getByRole('button', { name: 'Update connection', exact: true }).click()
      await page.getByPlaceholder('Paste replacement API key', { exact: true }).fill(replacementSecret)
      await page.getByRole('button', { name: 'Verify & update', exact: true }).click()
      await page.getByRole('dialog', { name: 'Update connection' }).waitFor({ state: 'hidden' })
      const afterRotationRaw = await readFile(vaultPath, 'utf8')
      const afterRotation = JSON.parse(afterRotationRaw)
      const replacementReferences = Object.keys(afterRotation.entries ?? {})
      if (afterRotationRaw.includes(replacementSecret) || afterRotationRaw.includes(smokeSecret)) {
        throw new Error('The packaged credential rotation wrote a raw secret to disk.')
      }
      if (replacementReferences.length !== 1 || replacementReferences[0] === previousReference) {
        throw new Error('The packaged credential rotation did not retire the previous provider key.')
      }
      await page.getByRole('button', { name: 'Remove provider', exact: true }).click()
      const removal = page.getByRole('dialog', { name: 'Remove Packaged credential smoke?', exact: true })
      await removal.waitFor()
      await removal.getByRole('button', { name: 'Remove provider', exact: true }).click()
      await page.waitForURL(`${origin}/models`)
      const pruned = JSON.parse(await readFile(vaultPath, 'utf8'))
      if (Object.keys(pruned.entries ?? {}).length !== 0) throw new Error('Provider deletion left a credential in the packaged vault.')
    } else {
      throw new Error('A clean packaged app with a protected authentication root must also expose secure provider setup.')
    }
    console.log(
      `[desktop-smoke] ready ${origin} · isolated SQLite · first-run model handoff + different-origin personal default recovery · native context picker · daily recovery + managed portable backup · built renderer · direct document/sheet/slides creation + keyed relaunch recovery · OS-encrypted provider create/rotate/delete · signed-in relaunch + personal-token recovery/revocation + saved conversation + exact durable usage`,
    )
  } finally {
    await closePackagedDesktop(run)
    await new Promise((resolve) => modelServer.close(resolve)).catch(() => {})
    await rm(userDataPath, { recursive: true, force: true })
  }
  // Sequential and independently isolated: the ordinary launch above proves
  // real OS-backed storage; Playwright's main-process dialog fixture below must
  // neither reuse that profile nor compete with its single-instance lock.
  await smokePackagedAttachments({ executable })
  await smokePackagedMcpCredentials({ executable })
  await smokePackagedMcpSchema({ executable })
  await smokePackagedRestore({ executable })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedDesktop()
