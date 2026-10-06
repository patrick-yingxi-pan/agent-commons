import { createHash } from 'node:crypto'

export const MAX_GIT_PACK_INDEX_BYTES = 16 * 1024 * 1024

const V2_SIGNATURE = Buffer.from([0xff, 0x74, 0x4f, 0x63])
const INVALID_INDEX = 'The Git pack index is invalid.'

function invalid() {
  throw new Error(INVALID_INDEX)
}

function compareOidAt(oidTable, offset, needle) {
  return Buffer.compare(oidTable.subarray(offset, offset + needle.length), needle)
}

/** Parse the bounded, on-disk index for one Git pack without decoding its pack. */
export function parseGitPackIndex(bytes, objectFormat = 'sha1') {
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') throw new Error('Unsupported Git object format.')
  if (!(bytes instanceof Uint8Array)) throw new Error(INVALID_INDEX)
  if (bytes.byteLength > MAX_GIT_PACK_INDEX_BYTES) throw new Error('The Git pack index exceeds its byte limit.')

  // Keep a private copy: membership remains tied to the checked bytes even if
  // the caller reuses or mutates its input after this function returns.
  const data = Buffer.from(bytes)
  const hashBytes = objectFormat === 'sha1' ? 20 : 32
  const digestName = objectFormat === 'sha1' ? 'sha1' : 'sha256'
  if (data.length < 1024 + 2 * hashBytes) invalid()

  const isV2 = data.length >= 8 && data.subarray(0, 4).equals(V2_SIGNATURE)
  let fanoutOffset = 0
  let oidStart = 0
  let objectCount
  let trailerStart = data.length - hashBytes * 2

  if (isV2) {
    if (data.readUInt32BE(4) !== 2) invalid()
    fanoutOffset = 8
  }

  const fanout = new Uint32Array(256)
  let prior = 0
  for (let bucket = 0; bucket < 256; bucket += 1) {
    const value = data.readUInt32BE(fanoutOffset + bucket * 4)
    if (value < prior) invalid()
    fanout[bucket] = value
    prior = value
  }
  objectCount = fanout[255]

  let oidTable
  let offsetTableStart = 0
  let largeOffsetTableStart = 0
  let largeOffsetCount = 0
  if (isV2) {
    oidStart = 8 + 1024
    const crcStart = oidStart + objectCount * hashBytes
    offsetTableStart = crcStart + objectCount * 4
    largeOffsetTableStart = offsetTableStart + objectCount * 4
    const remaining = trailerStart - largeOffsetTableStart
    if (remaining < 0 || remaining % 8 !== 0) invalid()
    largeOffsetCount = remaining / 8
    oidTable = data.subarray(oidStart, crcStart)
  } else {
    const expectedLength = 1024 + objectCount * (4 + hashBytes) + 2 * hashBytes
    if (!Number.isSafeInteger(expectedLength) || data.length !== expectedLength) invalid()
    const compactOids = Buffer.alloc(objectCount * hashBytes)
    for (let index = 0; index < objectCount; index += 1) {
      const entryOffset = 1024 + index * (4 + hashBytes)
      const offset = data.readUInt32BE(entryOffset)
      if (offset < 12) invalid()
      data.copy(compactOids, index * hashBytes, entryOffset + 4, entryOffset + 4 + hashBytes)
    }
    oidTable = compactOids
  }

  const expectedEnd = isV2
    ? largeOffsetTableStart + largeOffsetCount * 8 + 2 * hashBytes
    : data.length
  if (expectedEnd !== data.length || oidTable.length !== objectCount * hashBytes) invalid()

  const bucketCounts = new Uint32Array(256)
  let previousOid = null
  for (let index = 0; index < objectCount; index += 1) {
    const oidOffset = index * hashBytes
    const oid = oidTable.subarray(oidOffset, oidOffset + hashBytes)
    if (previousOid && Buffer.compare(previousOid, oid) >= 0) invalid()
    previousOid = oid
    bucketCounts[oid[0]] += 1
  }
  let cumulative = 0
  for (let bucket = 0; bucket < 256; bucket += 1) {
    cumulative += bucketCounts[bucket]
    if (fanout[bucket] !== cumulative) invalid()
  }

  if (isV2) {
    const referencedLargeOffsets = new Set()
    for (let index = 0; index < objectCount; index += 1) {
      const encoded = data.readUInt32BE(offsetTableStart + index * 4)
      if ((encoded & 0x80000000) === 0) {
        if (encoded < 12) invalid()
        continue
      }
      const reference = encoded & 0x7fffffff
      if (reference >= largeOffsetCount || referencedLargeOffsets.has(reference)) invalid()
      referencedLargeOffsets.add(reference)
    }
    if (referencedLargeOffsets.size !== largeOffsetCount) invalid()
    for (let index = 0; index < largeOffsetCount; index += 1) {
      if (data.readBigUInt64BE(largeOffsetTableStart + index * 8) < 12n) invalid()
    }
  }

  const expectedIndexChecksum = createHash(digestName).update(data.subarray(0, data.length - hashBytes)).digest()
  const storedIndexChecksum = data.subarray(data.length - hashBytes)
  if (!expectedIndexChecksum.equals(storedIndexChecksum)) invalid()
  const packChecksum = data.subarray(data.length - hashBytes * 2, data.length - hashBytes).toString('hex')
  const oidPattern = new RegExp(`^[0-9a-f]{${hashBytes * 2}}$`)

  const has = (oid) => {
    if (typeof oid !== 'string' || oid.length !== hashBytes * 2 || !oidPattern.test(oid)) return false
    const needle = Buffer.from(oid, 'hex')
    let low = 0
    let high = objectCount
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      const comparison = compareOidAt(oidTable, middle * hashBytes, needle)
      if (comparison < 0) low = middle + 1
      else high = middle
    }
    return low < objectCount && compareOidAt(oidTable, low * hashBytes, needle) === 0
  }

  return Object.freeze({ objectCount, packChecksum, has })
}
