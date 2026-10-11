import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as fs from 'node:fs/promises'
import { openPrivateTextFile, PrivateTextFileError } from './privateTextFile.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-private-text-'))
  const directory = join(root, 'profile')
  await mkdir(directory, { mode: 0o700 })
  try { await run({ root, directory, filePath: join(directory, 'state.txt') }) }
  finally { await rm(root, { recursive: true, force: true }) }
}

const rejectsCode = code => error => error instanceof PrivateTextFileError && error.code === code

test('private text snapshots are bounded strict UTF-8 and advance only after replacement acknowledgement', async () => fixture(async ({ directory, filePath }) => {
  const state = await openPrivateTextFile({ filePath, maxBytes: 64 })
  assert.equal(state.text, undefined)
  assert.equal(state.unavailable, false)
  await state.replace('first🙂')
  assert.equal(await readFile(filePath, 'utf8'), 'first🙂')
  assert.equal(state.text, 'first🙂')
  const info = await fs.stat(filePath)
  assert.equal(info.mode & 0o777, 0o600)
  await state.replace('second')
  assert.equal(state.text, 'second')
  await assert.rejects(openPrivateTextFile({ filePath, maxBytes: 2 }), rejectsCode('unavailable'))
  await assert.rejects(state.replace('x'.repeat(65)), rejectsCode('invalid'))
  await assert.rejects(state.replace('\ud800'), rejectsCode('invalid'))
  assert.equal(state.text, 'second')
  assert.equal(state.unavailable, false)
  assert.equal(await fs.stat(directory).then(value => value.mode & 0o777), 0o700)
}))

test('Windows policy retains file identity and CAS checks without POSIX ownership or directory fsync', async t => fixture(async ({ directory, filePath }) => {
  const originalGeteuid = Object.getOwnPropertyDescriptor(process, 'geteuid')
  let geteuidCalls = 0
  Object.defineProperty(process, 'geteuid', { configurable: true, value: () => { geteuidCalls += 1; throw new Error('must not inspect POSIX ownership') } })
  t.after(() => {
    if (originalGeteuid) Object.defineProperty(process, 'geteuid', originalGeteuid)
    else delete (process as NodeJS.Process & { geteuid?: () => number }).geteuid
  })

  let directorySyncs = 0
  const io = {
    ...fs,
    async open(path: fs.PathLike, ...args: any[]) {
      const handle = await fs.open(path, ...args as [any])
      if (String(path) !== directory) return handle
      return new Proxy(handle, { get(target, property) {
        const value = Reflect.get(target, property, target)
        if (property === 'sync') return async () => { directorySyncs += 1; return value.call(target) }
        return typeof value === 'function' ? value.bind(target) : value
      } })
    },
  }
  const state = await openPrivateTextFile({ filePath, maxBytes: 64, platform: 'win32', fsApi: io })
  await state.replace('windows-compatible')
  assert.equal(state.text, 'windows-compatible')
  assert.equal(directorySyncs, 0, 'Windows preserves its prior no-directory-fsync behavior')
  assert.equal(geteuidCalls, 0, 'Windows relies on the already admitted OS-managed profile ACL')

  const outside = join(directory, 'replacement.txt')
  await writeFile(outside, 'external', { mode: 0o600 })
  await rename(outside, filePath)
  await assert.rejects(state.replace('overwrite'), rejectsCode('stale'), 'Windows still enforces pinned file identity/CAS')
  assert.equal(state.unavailable, true)
}))

test('beforePublish is a final synchronous exact-true fence and refusal preserves the prior file', async () => fixture(async ({ filePath }) => {
  const state = await openPrivateTextFile({ filePath, maxBytes: 64 })
  await state.replace('before')
  const raw = await readFile(filePath, 'utf8')
  let optionGetterCalls = 0
  const unsafeOptions = {}
  Object.defineProperty(unsafeOptions, 'beforePublish', { enumerable: true, get() { optionGetterCalls += 1; return () => true } })
  await assert.rejects(state.replace('after', unsafeOptions), rejectsCode('invalid'))
  assert.equal(optionGetterCalls, 0)
  for (const beforePublish of [() => false, () => { throw new Error('/private/secret') }, async () => true,
    () => Promise.reject(new Error('/private/rejected'))]) {
    await assert.rejects(state.replace('after', { beforePublish }), rejectsCode('stale'))
    assert.equal(await readFile(filePath, 'utf8'), raw)
    assert.equal(state.text, 'before')
    assert.equal(state.unavailable, false)
  }
  await state.replace('after', { beforePublish: () => true })
  assert.equal(state.text, 'after')
}))

test('authority is sampled after the final asynchronous compare and just before rename', async () => fixture(async ({ filePath }) => {
  const held = await openPrivateTextFile({ filePath, maxBytes: 64 })
  await held.replace('before')
  let reads = 0
  let announceFinalRead
  let releaseFinalRead
  const finalReadStarted = new Promise(resolve => { announceFinalRead = resolve })
  const finalReadHeld = new Promise(resolve => { releaseFinalRead = resolve })
  const io = {
    ...fs,
    async open(path, flags, ...args) {
      if (path === filePath && typeof flags === 'number') {
        reads += 1
        if (reads === 3) { announceFinalRead(); await finalReadHeld }
      }
      return fs.open(path, flags, ...args)
    },
  }
  const state = await openPrivateTextFile({ filePath, maxBytes: 64, fsApi: io })
  let current = true
  const pending = state.replace('after', { beforePublish: () => current })
  await finalReadStarted
  current = false
  releaseFinalRead()
  await assert.rejects(pending, rejectsCode('stale'))
  assert.equal(await readFile(filePath, 'utf8'), 'before')
  assert.equal(state.text, 'before')
  assert.equal(state.unavailable, false)
}))

test('a replacement with identical text still poisons the pinned file identity', async () => fixture(async ({ directory, filePath }) => {
  await writeFile(filePath, 'same', { mode: 0o600 })
  const state = await openPrivateTextFile({ filePath, maxBytes: 64 })
  const replacement = join(directory, 'replacement.txt')
  await writeFile(replacement, 'same', { mode: 0o600 })
  await rename(replacement, filePath)
  await assert.rejects(state.replace('new'), rejectsCode('stale'))
  assert.equal(state.unavailable, true)
  await assert.rejects(state.replace('new'), rejectsCode('unavailable'))
  assert.equal(await readFile(filePath, 'utf8'), 'same')
}))

test('external edits and parent replacement poison future writes without repair', async () => fixture(async ({ root, directory, filePath }) => {
  const state = await openPrivateTextFile({ filePath, maxBytes: 64 })
  await state.replace('owned')
  await writeFile(filePath, 'external', { mode: 0o600 })
  await assert.rejects(state.replace('overwrite'), rejectsCode('stale'))
  assert.equal(state.unavailable, true)
  assert.equal(await readFile(filePath, 'utf8'), 'external')

  const parentState = await openPrivateTextFile({ filePath, maxBytes: 64 })
  const moved = join(root, 'moved-profile')
  await rename(directory, moved)
  await mkdir(directory, { mode: 0o700 })
  await assert.rejects(parentState.replace('new'), rejectsCode('stale'))
  assert.equal(parentState.unavailable, true)
}))

test('unsafe parents, files, links, and malformed launch options fail closed without repair', async () => fixture(async ({ root, directory, filePath }) => {
  let optionGetterCalls = 0
  const getterOptions = {}
  Object.defineProperty(getterOptions, 'filePath', { enumerable: true, get() { optionGetterCalls += 1; return filePath } })
  for (const options of [
    null,
    getterOptions,
    { filePath: 'relative', maxBytes: 10 },
    { filePath, maxBytes: 0 },
    { filePath, maxBytes: 17 * 1024 * 1024 },
  ]) await assert.rejects(openPrivateTextFile(options), rejectsCode('invalid'))
  assert.equal(optionGetterCalls, 0)

  const linkPath = join(directory, 'link.txt')
  await writeFile(join(root, 'target.txt'), 'preserve', { mode: 0o600 })
  await symlink(join(root, 'target.txt'), linkPath)
  await assert.rejects(openPrivateTextFile({ filePath: linkPath, maxBytes: 64 }), rejectsCode('unavailable'))
  assert.equal(await readFile(join(root, 'target.txt'), 'utf8'), 'preserve')

  await fs.writeFile(filePath, Buffer.from([0xff]), { mode: 0o600 })
  await assert.rejects(openPrivateTextFile({ filePath, maxBytes: 64 }), rejectsCode('unavailable'))
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600)
  await chmod(directory, 0o755)
  await assert.rejects(openPrivateTextFile({ filePath, maxBytes: 64 }), rejectsCode('unavailable'))
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o755)
}))

test('overlapping replacements reject busy and temporary cleanup failures poison the handle', async () => fixture(async ({ filePath }) => {
  let releaseWrite
  let announceWrite
  const writeStarted = new Promise(resolve => { announceWrite = resolve })
  const writeHeld = new Promise(resolve => { releaseWrite = resolve })
  let armed = false
  const io = {
    ...fs,
    async open(path, flags, ...args) {
      const handle = await fs.open(path, flags, ...args)
      if (flags !== 'wx' || !armed) return handle
      return new Proxy(handle, { get(target, key) {
        const value = Reflect.get(target, key, target)
        if (key === 'writeFile') return async (...values) => { announceWrite(); await writeHeld; return value.apply(target, values) }
        return typeof value === 'function' ? value.bind(target) : value
      } })
    },
    async unlink(path) {
      if (armed) { const error = new Error('private cleanup'); error.code = 'EACCES'; throw error }
      return fs.unlink(path)
    },
  }
  const state = await openPrivateTextFile({ filePath, maxBytes: 64, fsApi: io })
  await state.replace('base')
  armed = true
  const pending = state.replace('next', { beforePublish: () => false })
  await writeStarted
  await assert.rejects(state.replace('overlap'), rejectsCode('busy'))
  releaseWrite()
  await assert.rejects(pending, rejectsCode('unavailable'))
  assert.equal(state.unavailable, true)
}))
