import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createDesktopBackup,
  desktopDataAvailable,
  revealDesktopBackups,
  restoreDesktopBackup,
} from './desktopData.ts'
import type { DesktopBridge } from './desktopCredentials.ts'

test('the desktop data adapter exposes backup, reveal, and path-free native restore intent', async () => {
  const calls: string[] = []
  const backup = {
    fileName: 'backup-2026-08-31T18-25-43-210Z-a1b2c3d4e5f60718.json',
    sizeBytes: 4096,
    createdAt: '2026-08-31T18:25:43.210Z',
  }
  const agentCommonsDesktop: DesktopBridge = {
    data: {
      async createBackup() { calls.push('createBackup'); return backup },
      async revealBackups() { calls.push('revealBackups') },
      async restoreBackup() { calls.push('restoreBackup'); return { status: 'cancelled' } },
    },
  }
  const scope = { agentCommonsDesktop }
  assert.equal(desktopDataAvailable(scope), true)
  assert.deepEqual(await createDesktopBackup(scope), backup)
  await revealDesktopBackups(scope)
  assert.deepEqual(await restoreDesktopBackup(scope), { status: 'cancelled' })
  assert.deepEqual(calls, ['createBackup', 'revealBackups', 'restoreBackup'])
  assert.deepEqual(Object.keys(agentCommonsDesktop.data!).sort(), ['createBackup', 'restoreBackup', 'revealBackups'])
})

test('the web build has no desktop data capability', async () => {
  const scope = {}
  assert.equal(desktopDataAvailable(scope), false)
  await assert.rejects(() => createDesktopBackup(scope), /unavailable/)
  await assert.rejects(() => revealDesktopBackups(scope), /unavailable/)
  await assert.rejects(() => restoreDesktopBackup(scope), /unavailable/)
})

test('Customize renders the native backup workflow only through the adapter', () => {
  const source = readFileSync(new URL('../components/DesktopDataCard.tsx', import.meta.url), 'utf8')
  assert.match(source, /desktopDataAvailable\(\)/)
  assert.match(source, /createDesktopBackup\(\)/)
  assert.match(source, /revealDesktopBackups\(\)/)
  assert.match(source, /restoreDesktopBackup\(\)/)
  assert.match(source, /Seven daily recovery copies are kept automatically/)
  assert.match(source, /no provider API keys/)
  assert.match(source, /fresh safety copy/)
  assert.match(source, /restarts the app/)
  assert.doesNotMatch(source, /ipcRenderer|SNAPSHOT_DIR|filePath/)
})
