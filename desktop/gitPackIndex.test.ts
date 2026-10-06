import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_GIT_PACK_INDEX_BYTES, parseGitPackIndex } from './gitPackIndex.mjs'
import { bundledGitDirectory, bundledGitProbeEnvironment } from './bundledGit.mjs'

function hashBytes(format: string) {
  return format === 'sha1' ? 20 : 32
}

function writeU32(buffer: Buffer, offset: number, value: number) {
  buffer.writeUInt32BE(value, offset)
}

function makeFanout(oids: Buffer[]) {
  const counts = new Uint32Array(256)
  for (const oid of oids) counts[oid[0]] += 1
  let total = 0
  return Array.from(counts, (count) => (total += count))
}

function checksumIndex(buffer: Buffer, hashLength: number, format: string) {
  createHash(format).update(buffer.subarray(0, buffer.length - hashLength)).digest().copy(buffer, buffer.length - hashLength)
  return buffer
}

function makeIndex({
  format = 'sha1',
  version = 2,
  oids = [Buffer.alloc(20, 0x10), Buffer.alloc(20, 0x80)],
  offsets,
  largeOffsets = [],
}: {
  format?: string
  version?: 1 | 2
  oids?: Buffer[]
  offsets?: number[]
  largeOffsets?: bigint[]
} = {}) {
  const ordered = oids.map((oid) => Buffer.from(oid)).sort(Buffer.compare)
  const hlen = hashBytes(format)
  const normalOffsets = offsets ?? ordered.map((_oid, index) => 12 + index * 11)
  const packChecksum = Buffer.alloc(hlen, 0x5a)
  if (version === 1) {
    const length = 1024 + ordered.length * (4 + hlen) + 2 * hlen
    const result = Buffer.alloc(length)
    for (const [index, value] of makeFanout(ordered).entries()) writeU32(result, index * 4, value)
    for (let index = 0; index < ordered.length; index += 1) {
      const position = 1024 + index * (4 + hlen)
      writeU32(result, position, normalOffsets[index])
      ordered[index].copy(result, position + 4)
    }
    packChecksum.copy(result, length - 2 * hlen)
    return checksumIndex(result, hlen, format)
  }

  const length = 8 + 1024 + ordered.length * (hlen + 8) + largeOffsets.length * 8 + 2 * hlen
  const result = Buffer.alloc(length)
  Buffer.from([0xff, 0x74, 0x4f, 0x63]).copy(result)
  writeU32(result, 4, 2)
  for (const [index, value] of makeFanout(ordered).entries()) writeU32(result, 8 + index * 4, value)
  const oidStart = 8 + 1024
  const crcStart = oidStart + ordered.length * hlen
  const offsetStart = crcStart + ordered.length * 4
  const largeStart = offsetStart + ordered.length * 4
  ordered.forEach((oid, index) => oid.copy(result, oidStart + index * hlen))
  for (let index = 0; index < ordered.length; index += 1) {
    writeU32(result, crcStart + index * 4, index)
    const offset = normalOffsets[index]
    writeU32(result, offsetStart + index * 4, offset)
  }
  if (largeOffsets.length) {
    const lastOffsetPosition = offsetStart + (ordered.length - 1) * 4
    writeU32(result, lastOffsetPosition, 0x80000000)
    largeOffsets.forEach((offset, index) => result.writeBigUInt64BE(offset, largeStart + index * 8))
  }
  packChecksum.copy(result, length - 2 * hlen)
  return checksumIndex(result, hlen, format)
}

function git(args: string[], input?: Buffer) {
  return spawnSync(join(bundledGitDirectory({ packaged: false }), 'git'), args, {
    input,
    env: bundledGitProbeEnvironment(),
    encoding: 'buffer',
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
  })
}

test('pack index parser accepts v1/v2 with SHA-1 and SHA-256, including 64-bit offsets', () => {
  for (const format of ['sha1', 'sha256']) {
    const hlen = hashBytes(format)
    const oids = [Buffer.alloc(hlen, 0x00), Buffer.alloc(hlen, 0x31), Buffer.alloc(hlen, 0xff)]
    const v2 = makeIndex({ format, version: 2, oids, offsets: [12, 24, 36] })
    const parsed = parseGitPackIndex(v2, format)
    assert.equal(parsed.objectCount, 3)
    assert.equal(parsed.packChecksum, Buffer.alloc(hlen, 0x5a).toString('hex'))
    for (const oid of oids) assert.equal(parsed.has(oid.toString('hex')), true)
    assert.equal(parsed.has(''), false)
    assert.equal(parsed.has('A'.repeat(hlen * 2)), false)
    assert.equal(parsed.has('f'.repeat(hlen * 2 - 2)), false)
    assert.equal(parsed.has('e'.repeat(hlen * 2)), false)
    assert.equal(Object.isFrozen(parsed), true)

    const large = makeIndex({ format, version: 2, oids, offsets: [12, 24, 36], largeOffsets: [0x1_0000_0000n] })
    assert.equal(parseGitPackIndex(large, format).objectCount, 3)
  }

  const sha1Oids = [Buffer.alloc(20, 0x10), Buffer.alloc(20, 0x80)]
  const v1 = makeIndex({ format: 'sha1', version: 1, oids: sha1Oids })
  const parsedV1 = parseGitPackIndex(v1)
  assert.equal(parsedV1.objectCount, 2)
  assert.equal(parsedV1.has(sha1Oids[0].toString('hex')), true)
  assert.throws(() => parseGitPackIndex(v1, 'sha256'), /invalid/i)

  const sha256V1 = makeIndex({ format: 'sha256', version: 1, oids: [Buffer.alloc(32, 0x11)] })
  assert.equal(parseGitPackIndex(sha256V1, 'sha256').objectCount, 1)
})

test('pack index parser rejects malformed length, checksums, fanout, object ordering, and offsets', () => {
  const good = makeIndex()
  const hlen = 20
  const oidStart = 8 + 1024
  const crcStart = oidStart + 2 * hlen
  const offsetStart = crcStart + 2 * 4
  const cases: Array<[string, Buffer]> = []

  cases.push(['truncated index', good.subarray(0, good.length - 1)])
  cases.push(['trailing bytes', Buffer.concat([good, Buffer.from([0])])])
  cases.push(['v2 index with unsupported version', Buffer.from(good)])
  writeU32(cases[cases.length - 1][1], 4, 3)
  const checksum = Buffer.from(good)
  checksum[checksum.length - 1] ^= 1
  cases.push(['bad index checksum', checksum])

  const nonMonotone = Buffer.from(good)
  writeU32(nonMonotone, 8, 1)
  cases.push(['nonmonotone fanout', checksumIndex(nonMonotone, hlen, 'sha1')])

  const wrongBucket = Buffer.from(good)
  writeU32(wrongBucket, 8 + 0x10 * 4, 2)
  cases.push(['fanout not matching OID first bytes', checksumIndex(wrongBucket, hlen, 'sha1')])

  const wrongCount = Buffer.from(good)
  writeU32(wrongCount, 8 + 255 * 4, 3)
  cases.push(['object count inconsistent with exact file length', checksumIndex(wrongCount, hlen, 'sha1')])

  const duplicatedOid = Buffer.from(good)
  duplicatedOid.copy(duplicatedOid, oidStart + hlen, oidStart, oidStart + hlen)
  cases.push(['duplicate or unsorted OIDs', checksumIndex(duplicatedOid, hlen, 'sha1')])

  const lowOffset = Buffer.from(good)
  writeU32(lowOffset, offsetStart, 11)
  cases.push(['offset before pack header', checksumIndex(lowOffset, hlen, 'sha1')])

  const lowV1Offset = Buffer.from(makeIndex({ version: 1 }))
  writeU32(lowV1Offset, 1024, 11)
  cases.push(['v1 offset before pack header', checksumIndex(lowV1Offset, hlen, 'sha1')])

  const badLargeReference = makeIndex({ largeOffsets: [0x1_0000_0000n] })
  writeU32(badLargeReference, offsetStart, 0x80000001)
  cases.push(['large-offset reference out of range', checksumIndex(badLargeReference, hlen, 'sha1')])

  const lowLargeOffset = makeIndex({ largeOffsets: [10n] })
  cases.push(['large offset before pack header', lowLargeOffset])

  const extraLargeOffset = Buffer.from(makeIndex({ largeOffsets: [0x1_0000_0000n] }))
  const trailer = extraLargeOffset.subarray(extraLargeOffset.length - 2 * hlen)
  const extended = Buffer.concat([extraLargeOffset.subarray(0, extraLargeOffset.length - 2 * hlen), Buffer.alloc(8), trailer])
  checksumIndex(extended, hlen, 'sha1')
  cases.push(['unreferenced large-offset table slot', extended])

  for (const [name, malformed] of cases) {
    assert.throws(() => parseGitPackIndex(malformed), /invalid/i, name)
  }

  assert.throws(() => parseGitPackIndex(good, 'sha512'), /format/i)
  assert.throws(() => parseGitPackIndex(new Uint8Array(MAX_GIT_PACK_INDEX_BYTES + 1)), /byte limit/i)
  assert.throws(() => parseGitPackIndex(new ArrayBuffer(10) as unknown as Uint8Array), /invalid/i)
})

test('pack membership owns an immutable copy of caller bytes', () => {
  const source = makeIndex()
  const expectedOid = Buffer.alloc(20, 0x10).toString('hex')
  const parsed = parseGitPackIndex(source)
  source.fill(0)
  assert.equal(parsed.has(expectedOid), true)
})

test('bundled Git-generated v1/v2 indexes are accepted for SHA-1 and SHA-256 repositories', { skip: process.platform !== 'darwin' }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'agent-commons-pack-index-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  let generatedSha1Versions = 0
  let generatedSha256Versions = 0

  for (const format of ['sha1', 'sha256']) {
    const repository = join(temporary, format)
    const initialized = git(['init', '--bare', `--object-format=${format}`, repository])
    assert.equal(initialized.status, 0, `Could not initialize a ${format} repository: ${initialized.stderr?.toString()}`)

    const objectIds = []
    for (const content of [Buffer.from('first generated pack object'), Buffer.from('second generated pack object')]) {
      const written = git(['--git-dir', repository, 'hash-object', '-w', '--stdin'], content)
      assert.equal(written.status, 0, written.stderr.toString())
      objectIds.push(written.stdout.toString('ascii').trim())
    }

    for (const version of [1, 2]) {
      const base = join(repository, 'objects', 'pack', `fixture-v${version}`)
      const packed = git(['--git-dir', repository, 'pack-objects', `--index-version=${version}`, base], Buffer.from(`${objectIds.join('\n')}\n`))
      assert.equal(packed.status, 0, `Could not generate ${format} pack-index v${version}: ${packed.stderr?.toString()}`)
      const packId = packed.stdout.toString('ascii').trim()
      const index = await readFile(`${base}-${packId}.idx`)
      const parsed = parseGitPackIndex(index, format)
      assert.equal(parsed.objectCount, objectIds.length, `${format} index v${version}`)
      for (const objectId of objectIds) assert.equal(parsed.has(objectId), true, `${format} index v${version}`)
      if (format === 'sha1') generatedSha1Versions += 1
      else generatedSha256Versions += 1
    }
  }

  assert.equal(generatedSha1Versions, 2, 'actual SHA-1 v1 and v2 indexes must be exercised')
  assert.equal(generatedSha256Versions, 2, 'actual SHA-256 v1 and v2 indexes must be exercised')
})
