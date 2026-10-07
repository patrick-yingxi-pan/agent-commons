import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { STORE_VERSION, type PersistedState } from './persist.ts'
import { SqliteBackend } from './sqlite.ts'
import { restoreDamagedSqlite } from './sqliteRestore.ts'

function state(): PersistedState {
  return {
    version: STORE_VERSION,
    sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 1, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  } as PersistedState
}

test('a staged SQLite write failure preserves damaged database and sidecar bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-sqlite-restore-test-'))
  const database = join(directory, 'store.db')
  const databaseBytes = Buffer.from('damaged original database')
  const walBytes = Buffer.from('original WAL bytes')
  writeFileSync(database, databaseBytes)
  writeFileSync(`${database}-wal`, walBytes)
  let closeCount = 0

  try {
    assert.throws(() => restoreDamagedSqlite(database, state(), () => ({
      name: 'sqlite',
      load: () => null,
      save: () => { throw new Error('staged write failed') },
      close: () => { closeCount += 1 },
    })), /staged write failed/)
    assert.equal(closeCount, 1, 'the failed stage backend is always closed')
    assert.deepEqual(readFileSync(database), databaseBytes,
      'a failed staged write never removes or rewrites the damaged main database')
    assert.deepEqual(readFileSync(`${database}-wal`), walBytes,
      'a failed staged write leaves every original sidecar byte-for-byte unchanged')
    assert.deepEqual(readdirSync(directory), ['store.db', 'store.db-wal'],
      'failed staging leaves no abandoned database, sidecar, or backup copy')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a final SQLite read-back failure removes replacement sidecars and durably restores old files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-sqlite-rollback-test-'))
  const database = join(directory, 'store.db')
  const databaseBytes = Buffer.from('damaged original database')
  const walBytes = Buffer.from('original WAL bytes')
  writeFileSync(database, databaseBytes)
  writeFileSync(`${database}-wal`, walBytes)
  let backendCount = 0

  try {
    assert.throws(() => restoreDamagedSqlite(database, state(), path => {
      backendCount += 1
      if (backendCount === 1) return new SqliteBackend(path)
      return {
        name: 'sqlite',
        save: () => {},
        load: () => {
          writeFileSync(`${database}-wal`, 'replacement WAL')
          writeFileSync(`${database}-shm`, 'replacement SHM')
          return null
        },
        close: () => {},
      }
    }), /did not retain the selected backup/)
    assert.equal(backendCount, 2, 'the failure occurs during independent final-path verification')
    assert.deepEqual(readFileSync(database), databaseBytes,
      'final read-back failure atomically restores the previous damaged main bytes')
    assert.deepEqual(readFileSync(`${database}-wal`), walBytes,
      'final read-back failure restores the prior sidecar after removing the replacement WAL')
    assert.equal(existsSync(`${database}-shm`), false,
      'final read-back failure removes replacement shared-memory state before rollback')
    assert.deepEqual(readdirSync(directory).sort(), ['store.db', 'store.db-wal'],
      'rollback fsyncs restored names before removing the private staging area')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
