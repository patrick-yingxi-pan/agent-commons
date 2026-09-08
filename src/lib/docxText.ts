import { SaxesParser, type SaxesTagNS } from 'saxes'
import { MAX_DOCX_TEXT_BYTES, type DocxImportStatus } from '../../contract/docxImport.mjs'

export class DocxExtractionError extends Error {
  readonly status: Exclude<DocxImportStatus, 'ready' | 'no-text'>
  constructor(status: Exclude<DocxImportStatus, 'ready' | 'no-text'>) {
    super('Word text extraction was refused.')
    this.status = status
  }
}

const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'])
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'
const COMPATIBILITY = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const OFFICE_DOCUMENT = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'])
const MAIN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'

/** The strict SAX reader, not regular expressions, owns XML syntax, namespace
 * identity, entity validity and document completeness. Never admit DTDs. */
function parseXml(xml: string, handlers: { open(tag: SaxesTagNS, depth: number): void; close?(tag: SaxesTagNS, depth: number): void; text?(value: string): void }) {
  const parser = new SaxesParser({ xmlns: true })
  let depth = 0
  let nodes = 0
  parser.on('error', () => { throw new DocxExtractionError('invalid') })
  parser.on('doctype', () => { throw new DocxExtractionError('unsupported') })
  parser.on('opentag', (tag) => {
    if (++depth > 128 || ++nodes > 100_000 || Object.keys(tag.attributes).length > 128) throw new DocxExtractionError('structure-limit')
    handlers.open(tag, depth)
  })
  parser.on('closetag', (tag) => { handlers.close?.(tag, depth); depth -= 1 })
  parser.on('text', (text) => handlers.text?.(text))
  parser.on('cdata', (text) => handlers.text?.(text))
  // Feed incrementally; individual XML tokens may still span writes. The
  // bounded raw part caps buffering, and the worker deadline bounds CPU time.
  for (let offset = 0; offset < xml.length; offset += 4096) parser.write(xml.slice(offset, offset + 4096))
  parser.close()
}

function attribute(tag: SaxesTagNS, name: string): string | undefined {
  const value = tag.attributes[name]
  return value?.uri === '' ? value.value : undefined
}

/** Resolve only an internal package URI. This is identity, not an I/O path:
 * no network or filesystem API ever receives this value. */
export function packagePartName(value: string): string {
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { throw new DocxExtractionError('invalid') }
  if (!decoded || /[\\:#?\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) throw new DocxExtractionError('invalid')
  const segments: string[] = []
  for (const segment of decoded.replace(/^\//, '').split('/')) {
    if (segment === '.') continue
    if (!segment) throw new DocxExtractionError('invalid')
    if (segment === '..') {
      if (!segments.length) throw new DocxExtractionError('invalid')
      segments.pop()
    } else segments.push(segment)
  }
  if (!segments.length) throw new DocxExtractionError('invalid')
  return segments.join('/')
}

export function docxMainPart(xml: string): string {
  let main: string | undefined
  parseXml(xml, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== PACKAGE || tag.local !== 'Relationships')) throw new DocxExtractionError('invalid')
    if (depth !== 2 || tag.uri !== PACKAGE || tag.local !== 'Relationship' || !OFFICE_DOCUMENT.has(attribute(tag, 'Type') ?? '')) return
    if (main !== undefined || (attribute(tag, 'TargetMode') ?? 'Internal') !== 'Internal') throw new DocxExtractionError('unsupported')
    main = packagePartName(attribute(tag, 'Target') ?? '')
  } })
  if (!main) throw new DocxExtractionError('invalid')
  return main
}

export function assertDocxContentType(xml: string, main: string): void {
  const types = new Map<string, string>()
  parseXml(xml, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== CONTENT_TYPES || tag.local !== 'Types')) throw new DocxExtractionError('invalid')
    if (depth !== 2 || tag.uri !== CONTENT_TYPES || tag.local !== 'Override') return
    const name = packagePartName(attribute(tag, 'PartName') ?? '')
    if (types.has(name)) throw new DocxExtractionError('invalid')
    types.set(name, attribute(tag, 'ContentType') ?? '')
  } })
  if (types.get(main) !== MAIN_CONTENT_TYPE) throw new DocxExtractionError('unsupported')
}

/** A text projection of the current Word body, not a layout renderer. Preserve
 * real paragraph/cell/line/tab boundaries; never concatenate deleted revisions,
 * field instructions, comments, auxiliary parts, or two compatibility variants. */
export function docxBodyText(xml: string): string {
  const parts: string[] = []
  const encoder = new TextEncoder()
  let used = 0
  let separators = ''
  let bodyDepth = 0
  let bodies = 0
  let wordNamespace = ''
  const stack: Array<{ skipped: boolean; text: boolean; alternate?: { fallback: boolean } }> = []
  const append = (text: string) => {
    if (!text) return
    const size = separators.length + encoder.encode(text).byteLength
    if (used + size > MAX_DOCX_TEXT_BYTES) throw new DocxExtractionError('text-limit')
    used += size
    if (separators) parts.push(separators)
    separators = ''
    parts.push(text)
  }
  // Keep structural separators pending until another body value arrives: a
  // final paragraph terminator is not saved text and must not consume its last
  // byte of budget. Literal whitespace inside w:t remains untouched.
  const separate = (text: string) => {
    if (separators.length + text.length > MAX_DOCX_TEXT_BYTES) throw new DocxExtractionError('text-limit')
    separators += text
  }
  const removeSeparator = (text: string) => {
    if (separators.endsWith(text)) separators = separators.slice(0, -text.length)
  }
  parseXml(xml, {
    open(tag, depth) {
      if (depth === 1) {
        if (!WORD.has(tag.uri) || tag.local !== 'document') throw new DocxExtractionError('invalid')
        wordNamespace = tag.uri
      }
      const word = tag.uri === wordNamespace
      const parent = stack.at(-1)
      const skipped = parent?.skipped === true || (word && (['del', 'moveFrom'].includes(tag.local) || tag.local.endsWith('Pr'))) ||
        (tag.uri === COMPATIBILITY && tag.local === 'Choice')
      const frame: (typeof stack)[number] = { skipped, text: word && tag.local === 't' }
      if (tag.uri === COMPATIBILITY && tag.local === 'AlternateContent' && !skipped) frame.alternate = { fallback: false }
      if (tag.uri === COMPATIBILITY && tag.local === 'Fallback' && !skipped) {
        if (!parent?.alternate || parent.alternate.fallback) throw new DocxExtractionError('invalid')
        parent.alternate.fallback = true
      }
      stack.push(frame)
      if (word && tag.local === 'body') {
        if (depth !== 2 || ++bodies !== 1) throw new DocxExtractionError('invalid')
        bodyDepth = depth
      }
      if (!bodyDepth || skipped || !word) return
      if (tag.local === 'tab') append('\t')
      if (tag.local === 'br' || tag.local === 'cr') append('\n')
      if (tag.local === 'noBreakHyphen') append('\u2011')
      if (tag.local === 'softHyphen') append('\u00ad')
      // altChunk imports an external/embedded document rather than body XML.
      // Refuse instead of calling an incomplete body a successful extraction.
      if (tag.local === 'altChunk' || tag.local === 'subDoc') throw new DocxExtractionError('unsupported')
    },
    close(tag) {
      const frame = stack.pop()!
      if (frame.alternate && !frame.alternate.fallback) throw new DocxExtractionError('unsupported')
      if (!bodyDepth || frame.skipped || tag.uri !== wordNamespace) return
      if (tag.local === 'p') separate('\n')
      if (tag.local === 'tc') { removeSeparator('\n'); separate('\t') }
      if (tag.local === 'tr') { removeSeparator('\t'); separate('\n') }
      if (tag.local === 'body') bodyDepth = 0
    },
    text(value) { if (bodyDepth && stack.at(-1)?.text && !stack.at(-1)?.skipped) append(value) },
  })
  if (bodies !== 1) throw new DocxExtractionError('invalid')
  return parts.join('')
}
