import { deflateRawSync } from 'node:zlib'

const TRANSITIONAL_WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const STRICT_WORD_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main'
const TRANSITIONAL_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TRANSITIONAL_OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const STRICT_OFFICE_DOCUMENT_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

function bodyFromParagraphs(paragraphs) {
  return paragraphs.map((paragraph) => {
    const text = xmlEscape(paragraph)
    return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  }).join('')
}

function normalizeDocumentPath(documentPath) {
  const path = String(documentPath ?? 'word/document.xml').replace(/^\/+/, '')
  if (!path || path.includes('..') || path.startsWith('/') || path.endsWith('/') || !path.endsWith('.xml')) {
    throw new TypeError('documentPath must be a safe XML part path without traversal')
  }
  return path
}

function asBytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError('DOCX fixture entries must be strings or Uint8Arrays')
}

// CRC-32 is intentionally kept here, next to the tiny deterministic archive
// writer. This writer is fixture-only; production code uses the pinned ZIP
// implementation.
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value) {
  const result = Buffer.alloc(2)
  result.writeUInt16LE(value, 0)
  return result
}

function u32(value) {
  const result = Buffer.alloc(4)
  result.writeUInt32LE(value >>> 0, 0)
  return result
}

function zipArchive(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const [name, source] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const plain = asBytes(source)
    const compressed = plain.length === 0 ? plain : deflateRawSync(plain, { level: 9 })
    const method = plain.length === 0 ? 0 : 8
    const crc = crc32(plain)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc),
      u32(compressed.length), u32(plain.length), u16(nameBytes.length), u16(0), nameBytes, compressed,
    ])
    locals.push(local)
    const directory = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc),
      u32(compressed.length), u32(plain.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBytes,
    ])
    central.push(directory)
    offset += local.length
  }
  const centralBytes = Buffer.concat(central)
  const localBytes = Buffer.concat(locals)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(localBytes.length), u16(0),
  ])
  return Buffer.concat([localBytes, centralBytes, end])
}

function compoundOfficeFixture() {
  // An encrypted/legacy Office document is an OLE compound container, not a
  // ZIP. This deliberately minimal CFB signature fixture exercises the
  // unsupported compound-container branch without claiming encryption.
  const result = Buffer.alloc(512, 0)
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(result, 0)
  Buffer.from('EncryptedPackage').copy(result, 80)
  return result
}

/**
 * Build a deterministic, real OOXML package for browser and parser tests.
 * `bodyXml` is the children of w:body; use it for tabs, breaks, tables and
 * omitted WordprocessingML subtrees. `entries` replaces generated parts and
 * may add arbitrary package members for adversarial ZIP tests. Set
 * `compoundContainer` to produce an unsupported OLE compound container.
 */
export function docxFixture({
  paragraphs,
  bodyXml,
  documentPath = 'word/document.xml',
  strict = false,
  entries = {},
  compoundContainer = false,
} = {}) {
  if (compoundContainer) return compoundOfficeFixture()
  const path = normalizeDocumentPath(documentPath)
  const wordNamespace = strict ? STRICT_WORD_NS : TRANSITIONAL_WORD_NS
  // OPC package relationships retain the transitional namespace even in a
  // Strict OOXML package. Only the WordprocessingML and relationship Type
  // namespaces switch to the strict purl.oclc.org forms.
  const relationshipsNamespace = TRANSITIONAL_REL_NS
  const officeDocumentRelationship = strict ? STRICT_OFFICE_DOCUMENT_REL : TRANSITIONAL_OFFICE_DOCUMENT_REL
  const children = bodyXml ?? bodyFromParagraphs(paragraphs ?? [])
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${wordNamespace}" xmlns:r="${strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships' : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}">` +
    `<w:body>${children}<w:sectPr/></w:body></w:document>`
  const contentType = strict
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/${path}" ContentType="${contentType}"/>` +
    `</Types>`
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${relationshipsNamespace}">` +
    `<Relationship Id="rId1" Type="${officeDocumentRelationship}" Target="${path}"/>` +
    `</Relationships>`
  const generated = new Map([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRelationships],
    [path, documentXml],
  ])
  for (const [name, value] of Object.entries(entries ?? {})) generated.set(String(name), value)
  const ordered = [...generated.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return zipArchive(ordered)
}

export { crc32 }
