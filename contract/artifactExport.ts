import type { ArtifactContent } from './content.ts'

export interface ArtifactDocumentExport {
  artifactId: string
  filename: string
  mediaType: 'text/markdown;charset=utf-8'
  content: string
  revision: number
}

export type ArtifactExportFormat = 'markdown' | 'xlsx' | 'pptx' | 'docx'
export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** A saved values-only workbook, not a formula calculation or original upload. */
export interface ArtifactSpreadsheetExport {
  artifactId: string
  filename: string
  mediaType: typeof XLSX_MEDIA_TYPE
  encoding: 'base64'
  content: string
  revision: number
}
/** Editable saved slide text. Dense content may use continuation slides. */
export interface ArtifactPresentationExport extends Omit<ArtifactSpreadsheetExport, 'mediaType'> {
  mediaType: typeof PPTX_MEDIA_TYPE
}
/** Editable saved document blocks, not a reconstruction of an imported file. */
export interface ArtifactWordExport extends Omit<ArtifactSpreadsheetExport, 'mediaType'> {
  mediaType: typeof DOCX_MEDIA_TYPE
}
export type ArtifactExport = ArtifactDocumentExport | ArtifactSpreadsheetExport | ArtifactPresentationExport | ArtifactWordExport

type DocumentBody = Extract<ArtifactContent, { type: 'doc' }>

const MAX_FILENAME_STEM_CODE_POINTS = 96
const MAX_FILENAME_STEM_BYTES = 240
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0001}]/gu
const PORTABLE_FILENAME_PUNCTUATION = /[\\/:*?"<>|]/gu
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const ASCII_MARKDOWN_PUNCTUATION = "\\!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Escape user text as literal Markdown. Non-empty line breaks use a hard break
 * by default; empty lines use a visible entity so CommonMark cannot treat the
 * line as a blank-block separator. Headings use entity breaks because a literal
 * second line must not become a new paragraph. */
function literalInline(text: string, lineBreak: 'hard' | 'entity' = 'hard'): string {
  const encodeWhitespace = (value: string) => [...value].map((char) => char === '\t' ? '&#9;' : '&#32;').join('')
  const lines = normalizeText(text).split('\n')
  const escaped = lines.map((line) => {
    if (line.length === 0) return '&#10;'
    const leading = line.match(/^[ \t]*/u)?.[0] ?? ''
    const trailing = line.match(/[ \t]*$/u)?.[0] ?? ''
    if (leading.length === line.length) return encodeWhitespace(line)
    const core = line.slice(leading.length, line.length - trailing.length)
    const escaped = [...core].map((char) => ASCII_MARKDOWN_PUNCTUATION.includes(char) ? `\\${char}` : char).join('')
    return `${encodeWhitespace(leading)}${escaped}${encodeWhitespace(trailing)}`
  })
  return escaped.join(lineBreak === 'entity' ? '&#10;' : '  \n')
}

function literalLines(text: string): string[] {
  return normalizeText(text).split('\n')
}

function codeFence(lines: string[]): string {
  let longest = 0
  for (const line of lines) {
    for (const run of line.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  }
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${lines.join('\n')}\n${fence}`
}

function blockMarkdown(block: DocumentBody['blocks'][number]): string {
  if ('h' in block) return `## ${literalInline(block.h, 'entity')}`
  if ('p' in block) return literalInline(block.p)
  if ('ul' in block) {
    return block.ul.map((item) => {
      const lines = literalInline(item).split('  \n')
      return [`- ${lines[0]}`, ...lines.slice(1).map((line) => `  ${line}`)].join('  \n')
    }).join('\n')
  }
  if ('code' in block) return codeFence(block.code.map(normalizeText).flatMap(literalLines))
  return `To: ${literalInline(block.email.to, 'entity')}\nSubject: ${literalInline(block.email.subject, 'entity')}`
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

export function artifactExportFilename(name: string, format: ArtifactExportFormat): string {
  const extension = format === 'markdown' ? 'md' : format
  const leaf = normalizeText(name).split(/[\\/]/u).at(-1) ?? ''
  const clean = leaf.replace(CONTROL_OR_BIDI, '').replace(PORTABLE_FILENAME_PUNCTUATION, '_')
  const withoutExtension = clean.replace(/\.[^.]*$/u, '').replace(/[. ]+$/u, '')
  const bounded = Array.from(withoutExtension)
    .slice(0, MAX_FILENAME_STEM_CODE_POINTS)
    .reduce((stem, char) => utf8ByteLength(`${stem}${char}`) <= MAX_FILENAME_STEM_BYTES ? `${stem}${char}` : stem, '')
    .trim()
  let stem = bounded || 'artifact'
  if (WINDOWS_RESERVED.test(`${stem}.${extension}`)) stem = `_${stem}`
  return `${stem}.${extension}`
}

export function documentMarkdown(
  name: string,
  body: DocumentBody,
): Omit<ArtifactDocumentExport, 'artifactId'> {
  return {
    filename: artifactExportFilename(name, 'markdown'),
    mediaType: 'text/markdown;charset=utf-8',
    content: [`# ${literalInline(body.title, 'entity')}`, ...body.blocks.map(blockMarkdown)].join('\n\n') + '\n',
    revision: body.revision ?? 0,
  }
}
