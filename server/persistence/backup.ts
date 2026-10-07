/** Managed portable backups shared by the CLI and the desktop utility process.
 *
 * The renderer never supplies a path. A backup is written into the configured
 * snapshots directory through the selected backend's canonical state port, so
 * JSON and SQLite remain interchangeable and backend-private bytes never leak.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backendKind, selectBackend, type BackendKind } from './index.ts'
import { restoreDamagedSqlite } from './sqliteRestore.ts'
import { dataFile, databaseFile } from './persist.ts'
import {
  exportBackendSnapshot,
  readPortableSnapshot,
  restoreBackendState,
} from './portable.ts'

export const RECOVERY_SNAPSHOT_RETENTION = 7
const RECOVERY_SNAPSHOT_PATTERN = /^recovery-(\d{4}-\d{2}-\d{2})\.json$/

/** The live store path — the same resolvers the server backends use. */
export function storageFilePath(kind: BackendKind = backendKind()): string {
  return kind === 'sqlite' ? databaseFile() : dataFile()
}

/** Managed backups live beside the live store unless the shell overrides it. */
export function snapshotsDir(): string {
  return process.env.SNAPSHOT_DIR ?? join(dirname(storageFilePath()), 'snapshots')
}

/** Restrict names so no caller can escape the managed snapshots directory. */
export function snapshotPath(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`invalid snapshot name: ${JSON.stringify(name)} (use letters, digits, . _ -)`)
  }
  return join(snapshotsDir(), `${name}.json`)
}

function ensureSnapshotsDir(): string {
  const directory = snapshotsDir()
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(directory, 0o700)
  return directory
}

function saveSnapshotWithKind(
  name = 'backup',
  { overwrite = true, recovery = false }: { overwrite?: boolean; recovery?: boolean } = {},
): { from: string; to: string } {
  const recoveryName = RECOVERY_SNAPSHOT_PATTERN.test(`${name}.json`)
  if (recoveryName !== recovery) {
    throw new Error(recoveryName ? 'the recovery snapshot name family is reserved' : 'invalid recovery snapshot name')
  }
  const from = storageFilePath()
  if (!existsSync(from)) {
    throw new Error(`no live store at ${from} — run the server once so it writes one`)
  }
  ensureSnapshotsDir()
  const to = snapshotPath(name)
  if (!overwrite && existsSync(to)) throw new Error(`refusing to replace existing snapshot ${name}`)
  const selected = selectBackend()
  try {
    exportBackendSnapshot(selected, to)
  } finally {
    selected.close()
  }
  return { from, to }
}

/** Export the live backend into one canonical portable manual snapshot. */
export function saveSnapshot(
  name = 'backup',
  { overwrite = true }: { overwrite?: boolean } = {},
): { from: string; to: string } {
  return saveSnapshotWithKind(name, { overwrite, recovery: false })
}

/** One stable UTC-day name makes repeated launches idempotent. Automatic
 * recovery files have their own reserved name family so retention cannot touch a
 * manual snapshot, even when a user gives it a backup-like name. */
export function recoverySnapshotName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10)
  const name = `recovery-${stamp}`
  if (!RECOVERY_SNAPSHOT_PATTERN.test(`${name}.json`)) throw new Error('could not create a recovery snapshot name')
  return name
}

export type DailyRecoverySnapshot = {
  created: boolean
  from: string
  to: string
}

/** Ensure today's recovery point and retain only the seven latest automatic
 * copies. Old recovery files are pruned before a new one is written, so a
 * cleanup failure cannot grow storage without bound. Manual snapshots are
 * outside the exact recovery name family and are never considered. */
export function ensureDailyRecoverySnapshot(now = new Date()): DailyRecoverySnapshot {
  const directory = ensureSnapshotsDir()
  const name = recoverySnapshotName(now)
  const to = snapshotPath(name)
  const from = storageFilePath()
  const recoveryFiles = readdirSync(directory)
    .filter((file) => RECOVERY_SNAPSHOT_PATTERN.test(file))
    .sort()

  if (existsSync(to)) {
    for (const file of recoveryFiles.slice(0, -RECOVERY_SNAPSHOT_RETENTION)) rmSync(join(directory, file))
    return { created: false, from, to }
  }

  for (const file of recoveryFiles.slice(0, -(RECOVERY_SNAPSHOT_RETENTION - 1))) rmSync(join(directory, file))
  return { created: true, ...saveSnapshotWithKind(name, { overwrite: false, recovery: true }) }
}

/** Restore a portable snapshot into the live backend. Caller must restart it. */
export function restoreSnapshot(name = 'backup'): { from: string; to: string } {
  const from = snapshotPath(name)
  if (!existsSync(from)) {
    throw new Error(`no snapshot named "${name}" at ${from} — run \`snapshot list\` to see what exists`)
  }
  const to = storageFilePath()
  // Validate before selecting the backend: opening SQLite creates the DB file,
  // and a malformed import must not touch live storage at all.
  const state = readPortableSnapshot(from)
  let selected: ReturnType<typeof selectBackend>
  try {
    selected = selectBackend()
  } catch (error) {
    if (backendKind() !== 'sqlite') throw error
    // A valid portable backup is already fully parsed and checked. Do not
    // discard the existing database: prove the replacement separately first.
    restoreDamagedSqlite(to, state)
    return { from, to }
  }
  try {
    restoreBackendState(selected, state)
  } finally {
    selected.close()
  }
  return { from, to }
}

/** Every managed backup, newest first. */
export function listSnapshots(): { name: string; sizeKB: number; modified: Date }[] {
  const dir = snapshotsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const stat = statSync(join(dir, file))
      return {
        name: file.replace(/\.json$/, ''),
        sizeKB: Math.round((stat.size / 1024) * 10) / 10,
        modified: new Date(stat.mtimeMs),
      }
    })
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
}
