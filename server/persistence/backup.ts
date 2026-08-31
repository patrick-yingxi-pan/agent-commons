/** Managed portable backups shared by the CLI and the desktop utility process.
 *
 * The renderer never supplies a path. A backup is written into the configured
 * snapshots directory through the selected backend's canonical state port, so
 * JSON and SQLite remain interchangeable and backend-private bytes never leak.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backendKind, selectBackend, type BackendKind } from './index.ts'
import { dataFile, databaseFile } from './persist.ts'
import {
  exportBackendSnapshot,
  readPortableSnapshot,
  restoreBackendState,
} from './portable.ts'

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

/** Export the live backend into one canonical portable snapshot. */
export function saveSnapshot(
  name = 'backup',
  { overwrite = true }: { overwrite?: boolean } = {},
): { from: string; to: string } {
  const from = storageFilePath()
  if (!existsSync(from)) {
    throw new Error(`no live store at ${from} — run the server once so it writes one`)
  }
  const directory = snapshotsDir()
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(directory, 0o700)
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
  const selected = selectBackend()
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
