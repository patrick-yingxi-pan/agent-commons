import { ZipReader, Uint8ArrayReader, type FileEntry } from '@zip.js/zip.js/lib/zip-core-custom.js'
import { SaxesParser, type SaxesTagNS } from 'saxes'

export type OfficeExtractionStatus = 'invalid' | 'unsupported' | 'structure-limit' | 'text-limit'

/** Fixed, non-reflective failure used by bounded Office package readers. */
export class OfficeExtractionError extends Error {
  readonly status: OfficeExtractionStatus

  constructor(status: OfficeExtractionStatus) {
    super('Office package extraction was refused.')
    this.name = 'OfficeExtractionError'
    this.status = status
  }
}

export type OfficeXmlHandlers = {
  open(tag: SaxesTagNS, depth: number): void
  close?(tag: SaxesTagNS, depth: number): void
  text?(value: string): void
}

/** The strict SAX reader shared by Office package projections. */
export function parseOfficeXml(xml: string, handlers: OfficeXmlHandlers): void {
  const parser = new SaxesParser({ xmlns: true })
  let depth = 0
  let nodes = 0
  parser.on('error', () => { throw new OfficeExtractionError('invalid') })
  parser.on('doctype', () => { throw new OfficeExtractionError('unsupported') })
  parser.on('opentag', (tag) => {
    if (++depth > 128 || ++nodes > 100_000 || Object.keys(tag.attributes).length > 128) {
      throw new OfficeExtractionError('structure-limit')
    }
    handlers.open(tag, depth)
  })
  parser.on('closetag', (tag) => {
    handlers.close?.(tag, depth)
    depth -= 1
  })
  parser.on('text', (text) => handlers.text?.(text))
  parser.on('cdata', (text) => handlers.text?.(text))
  for (let offset = 0; offset < xml.length; offset += 4096) parser.write(xml.slice(offset, offset + 4096))
  parser.close()
}

export function officeAttribute(tag: SaxesTagNS, name: string): string | undefined {
  const value = tag.attributes[name]
  return value?.uri === '' ? value.value : undefined
}

/** Resolve only an internal package URI. This is identity, not an I/O path. */
function normalizePartName(value: string, decodeUri: boolean): string {
  let decoded: string
  try { decoded = decodeUri ? decodeURIComponent(value) : value } catch { throw new OfficeExtractionError('invalid') }
  if (!decoded || /[\\:#?\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) {
    throw new OfficeExtractionError('invalid')
  }
  const segments: string[] = []
  for (const segment of decoded.replace(/^\//, '').split('/')) {
    if (segment === '.') continue
    if (!segment) throw new OfficeExtractionError('invalid')
    if (segment === '..') {
      if (!segments.length) throw new OfficeExtractionError('invalid')
      segments.pop()
    } else segments.push(segment)
  }
  if (!segments.length) throw new OfficeExtractionError('invalid')
  return segments.join('/')
}

/** Resolve an internal package URI exactly once. */
export function packagePartName(value: string): string {
  return normalizePartName(value, true)
}

/** Resolve one relationship target against an already-canonical package part. */
export function resolvePackagePartName(source: string, target: string): string {
  let decodedTarget: string
  try { decodedTarget = decodeURIComponent(target) } catch { throw new OfficeExtractionError('invalid') }
  const resolved = decodedTarget.startsWith('/')
    ? decodedTarget
    : `${source.slice(0, source.lastIndexOf('/') + 1)}${decodedTarget}`
  return normalizePartName(resolved, false)
}

const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_DOCUMENT = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
])
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'

export function officeMainPart(xml: string): string {
  let main: string | undefined
  parseOfficeXml(xml, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== PACKAGE || tag.local !== 'Relationships')) {
      throw new OfficeExtractionError('invalid')
    }
    if (depth !== 2 || tag.uri !== PACKAGE || tag.local !== 'Relationship' ||
      !OFFICE_DOCUMENT.has(officeAttribute(tag, 'Type') ?? '')) return
    if (main !== undefined || (officeAttribute(tag, 'TargetMode') ?? 'Internal') !== 'Internal') {
      throw new OfficeExtractionError('unsupported')
    }
    main = packagePartName(officeAttribute(tag, 'Target') ?? '')
  } })
  if (!main) throw new OfficeExtractionError('invalid')
  return main
}

export function assertOfficeContentType(xml: string, main: string, expectedType: string): void {
  const types = new Map<string, string>()
  parseOfficeXml(xml, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== CONTENT_TYPES || tag.local !== 'Types')) {
      throw new OfficeExtractionError('invalid')
    }
    if (depth !== 2 || tag.uri !== CONTENT_TYPES || tag.local !== 'Override') return
    const name = packagePartName(officeAttribute(tag, 'PartName') ?? '')
    if (types.has(name)) throw new OfficeExtractionError('invalid')
    types.set(name, officeAttribute(tag, 'ContentType') ?? '')
  } })
  if (types.get(main) !== expectedType) throw new OfficeExtractionError('unsupported')
}

export type OfficePackageLimits = {
  maxEntries: number
  maxPartBytes: number
  maxExpandedBytes: number
}

export type OfficePackage = {
  readPart(name: string): Promise<string>
  close(): Promise<void>
}

const COMPOUND_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function decodeXml(bytes: Uint8Array): string {
  const encoding = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)
    ? 'utf-16le'
    : (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)
      ? 'utf-16be' : 'utf-8'
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) } catch {
    throw new OfficeExtractionError('invalid')
  }
}

function isValidLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function asOfficeError(error: unknown): OfficeExtractionError {
  return error instanceof OfficeExtractionError ? error : new OfficeExtractionError('invalid')
}

async function closeQuietly(reader: ZipReader<Uint8ArrayReader>): Promise<void> {
  try { await reader.close() } catch { /* preserve the admission error */ }
}

/** Admit one bounded ZIP package and expose only decoded XML parts. */
export async function readOfficePackage(bytes: Uint8Array, limits: OfficePackageLimits): Promise<OfficePackage> {
  if (!isValidLimit(limits.maxEntries) || !isValidLimit(limits.maxPartBytes) || !isValidLimit(limits.maxExpandedBytes)) {
    throw new OfficeExtractionError('invalid')
  }
  if (COMPOUND_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new OfficeExtractionError('unsupported')
  }

  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: 'strict', useWebWorkers: false, useCompressionStream: true,
  })
  try {
    const entries = new Map<string, FileEntry>()
    let count = 0
    let declared = 0
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > limits.maxEntries) throw new OfficeExtractionError('structure-limit')
      if (entry.encrypted || ![0, 8].includes(entry.compressionMethod)) {
        throw new OfficeExtractionError('unsupported')
      }
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new OfficeExtractionError('invalid')
      }
      declared += entry.uncompressedSize
      if (declared > limits.maxExpandedBytes) throw new OfficeExtractionError('structure-limit')
      if (entry.directory) continue
      // ZIP entry names are already package paths, not URI references. Keep a
      // literal percent escape in the archive distinct from its URI-decoded
      // relationship target; the latter is canonicalized exactly once above.
      const name = normalizePartName(entry.filename, false)
      if (entries.has(name)) throw new OfficeExtractionError('invalid')
      entries.set(name, entry)
    }

    let closed = false
    const budget = { used: 0 }
    const readPart = async (requested: string): Promise<string> => {
      if (closed) throw new OfficeExtractionError('invalid')
      // Callers pass canonical names returned by packagePartName/resolver;
      // decoding here would make `%2520` targets alias a space-named entry.
      const name = normalizePartName(requested, false)
      const entry = entries.get(name)
      if (!entry) throw new OfficeExtractionError('invalid')
      if (entry.uncompressedSize > limits.maxPartBytes) throw new OfficeExtractionError('structure-limit')
      const chunks: Uint8Array[] = []
      let used = 0
      try {
        await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
          used += chunk.byteLength
          budget.used += chunk.byteLength
          if (used > limits.maxPartBytes || budget.used > limits.maxExpandedBytes) {
            throw new OfficeExtractionError('structure-limit')
          }
          chunks.push(chunk.slice())
        } }), {
          checkCrc32: true, checkOverlappingEntry: true, strictness: 'strict',
          useWebWorkers: false, useCompressionStream: true,
        })
      } catch (error) {
        throw asOfficeError(error)
      }
      if (used !== entry.uncompressedSize) throw new OfficeExtractionError('invalid')
      const part = new Uint8Array(used)
      let offset = 0
      for (const chunk of chunks) { part.set(chunk, offset); offset += chunk.byteLength }
      return decodeXml(part)
    }
    const close = async () => {
      if (closed) return
      closed = true
      await reader.close()
    }
    return { readPart, close }
  } catch (error) {
    await closeQuietly(reader)
    throw asOfficeError(error)
  }
}
