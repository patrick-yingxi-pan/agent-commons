/** Startup integrity boundary for existing unusable storage.
 *
 * Only a genuinely absent store may seed. If bytes already exist but cannot be
 * parsed, migrated, or validated, the real store bootstrap must throw before it
 * enables persistence or mutates those bytes. This suite owns its process and
 * throwaway path because `initPersistence` is intentionally a once-per-process act. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { store } from '../store/index.ts'
import { closePersistence, PersistenceLoadError } from './persist.ts'

const FILE = join(tmpdir(), `agent-commons-startup-integrity-${process.pid}.json`)
const acknowledgedBytes = '{"version":5,"sessions":['
const previousDataFile = process.env.DATA_FILE
const previousBackend = process.env.PERSIST_BACKEND

after(() => {
  closePersistence()
  if (previousDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = previousDataFile
  if (previousBackend === undefined) delete process.env.PERSIST_BACKEND
  else process.env.PERSIST_BACKEND = previousBackend
  rmSync(FILE, { force: true })
  rmSync(`${FILE}.tmp`, { force: true })
  rmSync(`${FILE}.corrupt`, { force: true })
})

test('existing unreadable storage stops bootstrap without reseeding or moving data', () => {
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = FILE
  writeFileSync(FILE, acknowledgedBytes)

  assert.throws(
    () => store.initPersistence(),
    (error: unknown) =>
      error instanceof PersistenceLoadError
      && error.backend === 'json'
      && /Refusing to replace existing data/.test(error.message)
      && /existing JSON store/.test(error.message),
  )
  assert.equal(readFileSync(FILE, 'utf8'), acknowledgedBytes, 'the recovery source remains intact')
  store.createSession('must remain memory-only after failed bootstrap')
  assert.equal(readFileSync(FILE, 'utf8'), acknowledgedBytes, 'failed bootstrap never enables later persistence')
  assert.equal(existsSync(`${FILE}.tmp`), false, 'bootstrap never attempted a replacement write')
  assert.equal(existsSync(`${FILE}.corrupt`), false, 'bootstrap never renamed the live recovery source')
})

test('the real entrypoint completes storage bootstrap before constructing its listener', () => {
  const source = readFileSync(join(process.cwd(), 'server/index.ts'), 'utf8')
  const persistence = source.indexOf('store.initPersistence()')
  const listener = source.indexOf('const server = createServer(')
  assert.ok(persistence >= 0 && listener >= 0 && persistence < listener, 'a load failure exits before any port can bind')
})
