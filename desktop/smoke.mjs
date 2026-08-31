import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
      Object.keys(window.agentCommonsDesktop.data).sort().join(',') === 'createBackup,revealBackups',
    )
    if (!hasDataBridge) throw new Error('The narrow desktop data bridge was not available.')
    const backup = await page.evaluate(() => window.agentCommonsDesktop.data.createBackup())
    if (
      !/^backup-.*\.json$/.test(backup?.fileName ?? '') ||
      !Number.isSafeInteger(backup?.sizeBytes) ||
      Object.keys(backup ?? {}).sort().join(',') !== 'createdAt,fileName,sizeBytes'
    ) {
      throw new Error('The desktop backup bridge returned unbounded or invalid metadata.')
    }
    const backupPath = join(userDataPath, 'snapshots', backup.fileName)
    if (!existsSync(backupPath)) throw new Error('The packaged desktop did not create its managed portable backup.')
    const backupState = JSON.parse(await readFile(backupPath, 'utf8'))
    if (!Number.isSafeInteger(backupState.version) || !Array.isArray(backupState.sessions)) {
      throw new Error('The packaged desktop backup was not a canonical portable snapshot.')
    }
    if (output.includes('· secure credentials') && !hasCredentialBridge) {
      throw new Error('OS-backed credential storage was available but its narrow preload bridge was not.')
    }
    if (hasCredentialBridge) {
      const smokeSecret = 'agent-commons-smoke-key-not-a-real-credential'
      const replacementSecret = 'agent-commons-smoke-rotated-key-not-a-real-credential'
      await page.goto(`${origin}/models`)
      await page.getByRole('button', { name: 'New provider', exact: true }).click()
      await page.getByPlaceholder('e.g. Anthropic (prod)', { exact: true }).fill('Packaged credential smoke')
      await page.getByPlaceholder('https://models.example.com/v1', { exact: true }).fill(modelOrigin)
      await page.getByPlaceholder('Paste API key', { exact: true }).fill(smokeSecret)
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByRole('dialog', { name: 'New provider' }).waitFor({ state: 'hidden' })

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
      const removed = await page.evaluate(async (providerId) => {
        const response = await fetch(`/api/v1/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE' })
        if (!response.ok) return false
        await window.agentCommonsDesktop.credentials.removeProvider(providerId)
        return true
      }, created.id)
      if (!removed) throw new Error('The packaged provider workflow could not remove its temporary provider.')
      const pruned = JSON.parse(await readFile(vaultPath, 'utf8'))
      if (Object.keys(pruned.entries ?? {}).length !== 0) throw new Error('Provider deletion left a credential in the packaged vault.')
    }
    console.log(
      `[desktop-smoke] ready ${origin} · isolated SQLite · managed portable backup · built renderer · ${hasCredentialBridge ? 'OS-encrypted provider create/rotate/delete' : 'secure-storage fallback refused'}`,
    )
  } finally {
    await browser?.close().catch(() => {})
    await stop(child)
    await new Promise((resolve) => modelServer.close(resolve)).catch(() => {})
    await rm(userDataPath, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedDesktop()
