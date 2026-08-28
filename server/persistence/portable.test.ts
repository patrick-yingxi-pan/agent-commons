/** Failure-path locks for explicit portable recovery. Cross-backend behavior is
 * exercised through the public CLI helpers in snapshot.test.ts; these tests pin
 * the stronger guarantee that restore reports failure unless read-back proves it
 * landed. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { STORE_VERSION, type PersistedState, type PersistenceBackend } from './format.ts'
import {
  restoreBackendSnapshot,
  writePortableSnapshot,
} from './portable.ts'

const DIR = join(tmpdir(), `agent-commons-portable-${process.pid}`)
const FILE = join(DIR, 'snapshot.json')

function state(title: string): PersistedState {
  return {
    version: STORE_VERSION,
    sessions: [{ id: 's1', title, caps: ['chat'], preview: title, messages: [] }],
    bindings: [],
    workspaces: [],
    schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 1, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  } as PersistedState
}

after(() => rmSync(DIR, { recursive: true, force: true }))

test('restore fails loudly when a backend swallows the write', () => {
  const before = state('before')
  const incoming = state('incoming')
  writePortableSnapshot(FILE, incoming)
  const backend: PersistenceBackend = {
    name: 'swallowing-test-double',
    load: () => before,
    save: () => {},
    close: () => {},
  }

  assert.throws(
    () => restoreBackendSnapshot(backend, FILE),
    /did not retain the restored snapshot/,
  )
})

test('unsupported exports are rejected before save is called', () => {
  writeFileSync(FILE, JSON.stringify({ ...state('future'), version: STORE_VERSION + 1 }))
  let saves = 0
  const backend: PersistenceBackend = {
    name: 'mutation-spy',
    load: () => state('unchanged'),
    save: () => { saves += 1 },
    close: () => {},
  }

  assert.throws(() => restoreBackendSnapshot(backend, FILE), /unsupported or invalid/)
  assert.equal(saves, 0, 'validation happens before the backend mutation')
})

test('a current-version export missing required slices is still invalid', () => {
  writeFileSync(FILE, JSON.stringify({ version: STORE_VERSION }))
  let saves = 0
  const backend: PersistenceBackend = {
    name: 'shape-spy',
    load: () => state('unchanged'),
    save: () => { saves += 1 },
    close: () => {},
  }

  assert.throws(() => restoreBackendSnapshot(backend, FILE), /unsupported or invalid/)
  assert.equal(saves, 0)
})

test('the real server checkpoints persistence on orderly process exit', () => {
  const entry = readFileSync(join(process.cwd(), 'server', 'index.ts'), 'utf8')
  assert.match(entry, /process\.on\('exit', closePersistence\)/)
})
