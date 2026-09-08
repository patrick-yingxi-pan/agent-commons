import { MAX_DOCX_TEXT_BYTES } from '../../contract/docxImport.mjs'
import {
  OfficeExtractionError, parseOfficeXml, officeMainPart, assertOfficeContentType,
} from './officePackage.ts'

export {
  OfficeExtractionError as DocxExtractionError,
  packagePartName,
} from './officePackage.ts'

const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'])
const COMPATIBILITY = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const MAIN_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'

export function docxMainPart(xml: string): string {
  return officeMainPart(xml)
}

export function assertDocxContentType(xml: string, main: string): void {
  assertOfficeContentType(xml, main, MAIN_CONTENT_TYPE)
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
    if (used + size > MAX_DOCX_TEXT_BYTES) throw new OfficeExtractionError('text-limit')
    used += size
    if (separators) parts.push(separators)
    separators = ''
    parts.push(text)
  }
  // Keep structural separators pending until another body value arrives: a
  // final paragraph terminator is not saved text and must not consume its last
  // byte of budget. Literal whitespace inside w:t remains untouched.
  const separate = (text: string) => {
    if (separators.length + text.length > MAX_DOCX_TEXT_BYTES) throw new OfficeExtractionError('text-limit')
    separators += text
  }
  const removeSeparator = (text: string) => {
    if (separators.endsWith(text)) separators = separators.slice(0, -text.length)
  }
  parseOfficeXml(xml, {
    open(tag, depth) {
      if (depth === 1) {
        if (!WORD.has(tag.uri) || tag.local !== 'document') throw new OfficeExtractionError('invalid')
        wordNamespace = tag.uri
      }
      const word = tag.uri === wordNamespace
      const parent = stack.at(-1)
      const skipped = parent?.skipped === true || (word && (['del', 'moveFrom'].includes(tag.local) || tag.local.endsWith('Pr'))) ||
        (tag.uri === COMPATIBILITY && tag.local === 'Choice')
      const frame: (typeof stack)[number] = { skipped, text: word && tag.local === 't' }
      if (tag.uri === COMPATIBILITY && tag.local === 'AlternateContent' && !skipped) frame.alternate = { fallback: false }
      if (tag.uri === COMPATIBILITY && tag.local === 'Fallback' && !skipped) {
        if (!parent?.alternate || parent.alternate.fallback) throw new OfficeExtractionError('invalid')
        parent.alternate.fallback = true
      }
      stack.push(frame)
      if (word && tag.local === 'body') {
        if (depth !== 2 || ++bodies !== 1) throw new OfficeExtractionError('invalid')
        bodyDepth = depth
      }
      if (!bodyDepth || skipped || !word) return
      if (tag.local === 'tab') append('\t')
      if (tag.local === 'br' || tag.local === 'cr') append('\n')
      if (tag.local === 'noBreakHyphen') append('\u2011')
      if (tag.local === 'softHyphen') append('\u00ad')
      // altChunk imports an external/embedded document rather than body XML.
      // Refuse instead of calling an incomplete body a successful extraction.
      if (tag.local === 'altChunk' || tag.local === 'subDoc') throw new OfficeExtractionError('unsupported')
    },
    close(tag) {
      const frame = stack.pop()!
      if (frame.alternate && !frame.alternate.fallback) throw new OfficeExtractionError('unsupported')
      if (!bodyDepth || frame.skipped || tag.uri !== wordNamespace) return
      if (tag.local === 'p') separate('\n')
      if (tag.local === 'tc') { removeSeparator('\n'); separate('\t') }
      if (tag.local === 'tr') { removeSeparator('\t'); separate('\n') }
      if (tag.local === 'body') bodyDepth = 0
    },
    text(value) { if (bodyDepth && stack.at(-1)?.text && !stack.at(-1)?.skipped) append(value) },
  })
  if (bodies !== 1) throw new OfficeExtractionError('invalid')
  return parts.join('')
}
