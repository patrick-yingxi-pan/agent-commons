import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startModelServer } from '../server/model/index.ts'
import { CREDENTIAL_VAULT_FILE } from './credentialVault.mjs'
import { findAvailableLoopbackPort, loopbackOrigin } from './runtime.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 16_384

export function packagedExecutable(root = ROOT, targetPlatform = platform(), targetArch = arch()) {
  const artifact = join(root, 'out', `Agent Commons-${targetPlatform}-${targetArch}`)
  if (targetPlatform === 'darwin') return join(artifact, 'Agent Commons.app', 'Contents', 'MacOS', 'Agent Commons')
  if (targetPlatform === 'win32') return join(artifact, 'Agent Commons.exe')
  return join(artifact, 'Agent Commons')
}

function appendTail(current, chunk) {
  return `${current}${chunk}`.slice(-OUTPUT_LIMIT)
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
      const response = await fetch(`${origin}/json/version`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The packaged renderer did not expose its isolated smoke-test debugging endpoint.')
}

export async function smokePackagedDesktop({ executable = packagedExecutable() } = {}) {
  if (!existsSync(executable)) throw new Error(`Packaged desktop executable is missing: ${executable}`)

  const userDataPath = await mkdtemp(join(tmpdir(), 'agent-commons-desktop-smoke-'))
  const debuggingOrigin = loopbackOrigin(await findAvailableLoopbackPort())
  const modelOrigin = loopbackOrigin(await findAvailableLoopbackPort())
  const modelServer = startModelServer(Number(new URL(modelOrigin).port), '127.0.0.1')
  await new Promise((resolve, reject) => {
    if (modelServer.listening) return resolve()
    modelServer.once('listening', resolve)
    modelServer.once('error', reject)
  })
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
    })

    const response = await fetch(origin, { redirect: 'error' })
    const html = await response.text()
    if (!response.ok || !html.includes('<title>Agent Commons</title>')) {
      throw new Error(`Packaged renderer probe failed with HTTP ${response.status}.`)
    }
    if (!existsSync(join(userDataPath, 'store.db'))) {
      throw new Error('Packaged desktop did not create its SQLite store under isolated OS user data.')
    }
    await waitForCdp(debuggingOrigin)
    browser = await chromium.connectOverCDP(debuggingOrigin)
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(origin))
    if (!page) throw new Error('Packaged Electron did not expose the trusted renderer page.')
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
      Object.keys(window.agentCommonsDesktop.context).sort().join(',') === 'pickFiles,pickFolder',
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
    if (output.includes('· secure credentials') && !hasCredentialBridge) {
      throw new Error('OS-backed credential storage was available but its narrow preload bridge was not.')
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
      if (JSON.stringify(providers).includes(smokeSecret) || providers.some((provider) => provider.config || provider.apiKeyEnv)) {
        throw new Error('A packaged provider read exposed write-only credential configuration.')
      }
      const vaultPath = join(userDataPath, CREDENTIAL_VAULT_FILE)
      const vault = await readFile(vaultPath, 'utf8')
      if (vault.includes(smokeSecret)) throw new Error('The packaged credential vault wrote a raw secret to disk.')
      const beforeRotation = JSON.parse(vault)
      const [previousReference] = Object.keys(beforeRotation.entries ?? {})
      if (!previousReference) throw new Error('The packaged provider workflow did not bind its encrypted credential.')

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
      await firstProviderDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    console.log(
      `[desktop-smoke] ready ${origin} · isolated SQLite · first-run model handoff · native context picker · daily recovery + managed portable backup · built renderer · ${hasCredentialBridge ? 'OS-encrypted provider create/rotate/delete' : 'secure-storage fallback refused'}`,
    )
  } finally {
    await browser?.close().catch(() => {})
    await stop(child)
    await new Promise((resolve) => modelServer.close(resolve)).catch(() => {})
    await rm(userDataPath, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedDesktop()
