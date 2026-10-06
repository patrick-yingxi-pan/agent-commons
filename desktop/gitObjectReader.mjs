import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { readGitFile, readGitFileRange, listGitPackIndexes, MAX_GIT_FILE_BYTES } from './gitFileRead.mjs'
import { parseGitPackIndex } from './gitPackIndex.mjs'
import { inspectLocalFolderRoot } from './localFolderReader.mjs'

const FAILURE = 'The Git baseline is unavailable, changed or exceeds its read limits.'
const fail = () => { throw new Error(FAILURE) }
const MAX_OBJECT_BYTES = 1024 * 1024
const MAX_DECODED_BYTES = 8 * 1024 * 1024
const MAX_INDEX_BYTES = 32 * 1024 * 1024
const MAX_STAGED_BYTES = 512 * 1024 * 1024
const RANGE_BYTES = 4 * 1024 * 1024
const PACK_SIGNATURE = Buffer.from([0x50, 0x41, 0x43, 0x4b])
const TYPES = new Set(['blob', 'tree', 'commit', 'tag'])
const signature = (value) => [value.status === 'too-large' ? 'file' : value.status, value.sizeBytes, value.version]

/** Private, operation-scoped object store. The callback may construct a result,
 * but must not publish it: only the outer return has passed the final source
 * fence. No source path/configuration is ever passed to Git. */
export async function withGitObjectReader(root, {
  objectFormat = 'sha1', fileExecutable, runGit, signal: callerSignal,
  readFile = readGitFile, readRange = readGitFileRange, listPackIndexes = listGitPackIndexes,
} = {}, callback) {
  const lifetime = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000), ...(callerSignal ? [callerSignal] : [])])
  let staging
  let active = true
  let poisoned = false
  let queue = Promise.resolve()
  const check = () => { if (!active || poisoned || signal.aborted) fail() }
  try {
    if (!['sha1', 'sha256'].includes(objectFormat) || typeof runGit !== 'function' || typeof callback !== 'function') fail()
    const width = objectFormat === 'sha1' ? 20 : 32
    const validOid = (oid) => typeof oid === 'string' && oid.length === width * 2 && /^[a-f0-9]+$/.test(oid)
    check()
    if (!isDeepStrictEqual(await inspectLocalFolderRoot(root?.path), root)) fail()
    const observations = new Map()
    const load = async (name, maxBytes) => {
      check()
      const value = await readFile(root, name, { maxBytes, signal, executable: fileExecutable })
      const before = observations.get(name)
      if (before && !isDeepStrictEqual(before, signature(value))) fail()
      observations.set(name, signature(value))
      check()
      return value
    }
    // Borrowed stores and remote sources are never traversed. Even a locally
    // available object must not silently turn this into alternate-store access.
    for (const name of ['objects/info/alternates', 'objects/info/http-alternates']) {
      const value = await load(name, null)
      if (value.status !== 'missing' && !(value.status === 'file' && value.sizeBytes === 0)) fail()
    }
    staging = await mkdtemp(join(tmpdir(), 'agent-commons-git-objects-'))
    const metadata = join(staging, 'metadata')
    await mkdir(join(metadata, 'objects', 'pack'), { recursive: true, mode: 0o700 })
    await mkdir(join(metadata, 'refs'), { mode: 0o700 })
    await writeFile(join(metadata, 'HEAD'), 'ref: refs/heads/main\n', { mode: 0o600, flag: 'wx' })
    await writeFile(join(metadata, 'config'), `[core]\nrepositoryformatversion=${width === 32 ? 1 : 0}\nbare=true\n${width === 32 ? '[extensions]\nobjectformat=sha256\n' : ''}`, { mode: 0o600, flag: 'wx' })
    let stagedBytes = 0
    const reserve = (size) => {
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_STAGED_BYTES - stagedBytes) fail()
      stagedBytes += size
    }
    let packNames
    let indexBytes = 0
    const indexes = new Map()
    const copiedPacks = new Set()
    const objects = new Map()
    const probeInfo = new Map()
    let decodedBytes = 0

    async function indexFor(name) {
      if (indexes.has(name)) return indexes.get(name)
      const value = await load(`objects/pack/${name}`, MAX_GIT_FILE_BYTES)
      if (value.status !== 'file' || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== value.sizeBytes) fail()
      indexBytes += value.sizeBytes
      if (indexBytes > MAX_INDEX_BYTES) fail()
      const parsed = parseGitPackIndex(value.bytes, objectFormat)
      if (parsed.packChecksum !== name.slice(5, -4)) fail()
      const result = { parsed, bytes: value.bytes }
      indexes.set(name, result)
      return result
    }

    async function copyPack(name, index) {
      if (copiedPacks.has(name)) return
      const prefix = `objects/pack/${name.slice(0, -4)}`
      const promisor = await load(`${prefix}.promisor`, null)
      if (promisor.status !== 'missing') fail()
      const path = `${prefix}.pack`
      const value = await load(path, null)
      if (value.status !== 'file' || value.sizeBytes < 12 + width) fail()
      reserve(value.sizeBytes + index.bytes.byteLength)
      const destination = join(metadata, path)
      const file = await open(destination, 'wx', 0o600)
      const hash = createHash(objectFormat)
      let tail = Buffer.alloc(0)
      try {
        for (let offset = 0; offset < value.sizeBytes; offset += RANGE_BYTES) {
          check()
          const length = Math.min(RANGE_BYTES, value.sizeBytes - offset)
          const slice = await readRange(root, path, { offset, length, signal, executable: fileExecutable })
          if (slice.status !== 'file' || slice.offset !== offset || !(slice.bytes instanceof Uint8Array) ||
            slice.bytes.byteLength !== length || !isDeepStrictEqual(signature(slice), signature(value))) fail()
          const bytes = Buffer.from(slice.bytes)
          if (offset === 0 && (!bytes.subarray(0, 4).equals(PACK_SIGNATURE) || ![2, 3].includes(bytes.readUInt32BE(4)) ||
            bytes.readUInt32BE(8) !== index.parsed.objectCount)) fail()
          hash.update(bytes.subarray(0, Math.max(0, Math.min(length, value.sizeBytes - width - offset))))
          tail = Buffer.concat([tail, bytes]).subarray(-width)
          await file.writeFile(bytes)
        }
      } finally { await file.close() }
      if (hash.digest('hex') !== index.parsed.packChecksum || tail.toString('hex') !== index.parsed.packChecksum) fail()
      await load(path, null)
      await writeFile(join(metadata, `objects/pack/${name}`), index.bytes, { mode: 0o600, flag: 'wx' })
      copiedPacks.add(name)
    }

    async function copyObject(oid) {
      const path = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`
      const loose = await load(path, MAX_GIT_FILE_BYTES)
      if (loose.status === 'file') {
        if (!(loose.bytes instanceof Uint8Array) || loose.bytes.byteLength !== loose.sizeBytes) fail()
        reserve(loose.sizeBytes)
        await mkdir(dirname(join(metadata, path)), { recursive: true, mode: 0o700 })
        await writeFile(join(metadata, path), loose.bytes, { mode: 0o600, flag: 'wx' })
        return
      }
      if (loose.status !== 'missing') fail()
      packNames ??= await listPackIndexes(root, { signal, executable: fileExecutable })
      if (!Array.isArray(packNames) || packNames.length > 64 || new Set(packNames).size !== packNames.length ||
        packNames.some(name => typeof name !== 'string' || !/^pack-(?:[a-f0-9]{40}|[a-f0-9]{64})\.idx$/.test(name))) fail()
      for (const name of packNames) {
        if (name.length !== 9 + width * 2) continue
        const index = await indexFor(name)
        if (!index.parsed.has(oid)) continue
        await copyPack(name, index)
        return
      }
      fail()
    }

    async function probeObjectNow(oid) {
      check()
      if (!validOid(oid)) fail()
      if (probeInfo.has(oid)) return { ...probeInfo.get(oid) }
      if (probeInfo.size >= 1024) fail()
      await copyObject(oid)
      const info = await runGit(['--no-replace-objects', `--git-dir=${metadata}`, 'cat-file',
        '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      { cwd: staging, signal, input: Buffer.from(`${oid}\n`) })
      if (info.status !== 0 || !(info.stdout instanceof Uint8Array)) fail()
      const match = /^([a-f0-9]+) (blob|tree|commit|tag) (0|[1-9]\d*)\n$/.exec(Buffer.from(info.stdout).toString('utf8'))
      const sizeBytes = Number(match?.[3])
      if (!match || match[1] !== oid || !Number.isSafeInteger(sizeBytes)) fail()
      const result = { typeHint: match[2], sizeHintBytes: sizeBytes, contentVerified: false }
      probeInfo.set(oid, result)
      check()
      return { ...result }
    }

    async function readObjectNow(oid, expectedType, maxBytes) {
      check()
      if (!validOid(oid) || !TYPES.has(expectedType) || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_OBJECT_BYTES) fail()
      if (objects.has(oid)) {
        const cached = objects.get(oid)
        if (cached.type !== expectedType || cached.bytes.length > maxBytes) fail()
        return new Uint8Array(cached.bytes)
      }
      const info = await probeObjectNow(oid)
      const prefix = ['--no-replace-objects', `--git-dir=${metadata}`, 'cat-file']
      const size = info.sizeHintBytes
      if (info.typeHint !== expectedType || size > maxBytes || size > MAX_DECODED_BYTES - decodedBytes) fail()
      const result = await runGit([...prefix, expectedType, oid], { cwd: staging, signal })
      if (result.status !== 0 || !(result.stdout instanceof Uint8Array) || result.stdout.byteLength !== size) fail()
      const bytes = Buffer.from(result.stdout)
      if (createHash(objectFormat).update(`${expectedType} ${size}\0`).update(bytes).digest('hex') !== oid) fail()
      decodedBytes += size
      objects.set(oid, { type: expectedType, bytes })
      check()
      return new Uint8Array(bytes)
    }
    const enqueue = (operation) => {
      const result = queue.then(operation).catch(() => { poisoned = true; fail() })
      queue = result.then(() => {}, () => {})
      return result
    }
    /** Metadata-only preflight: hints may drive allocation/omission decisions,
     * never equality or content claims. readObject independently checks type,
     * exact size and the full object hash before returning bytes. */
    const result = await callback(Object.freeze({
      readObject: (oid, expectedType, maxBytes = MAX_OBJECT_BYTES) => enqueue(() => readObjectNow(oid, expectedType, maxBytes)),
      probeObject: (oid) => enqueue(() => probeObjectNow(oid)),
    }))
    await queue
    check()
    for (const [name, before] of observations) {
      const current = await readFile(root, name, { maxBytes: null, signal, executable: fileExecutable })
      if (!isDeepStrictEqual(before, signature(current))) fail()
      check()
    }
    if (packNames && !isDeepStrictEqual(packNames, await listPackIndexes(root, { signal, executable: fileExecutable }))) fail()
    if (!isDeepStrictEqual(await inspectLocalFolderRoot(root.path), root)) fail()
    check()
    return result
  } catch { fail() }
  finally {
    active = false
    lifetime.abort()
    await queue
    if (staging) await rm(staging, { recursive: true, force: true })
  }
}
