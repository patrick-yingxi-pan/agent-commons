/** Export-only WordprocessingML writer for the canonical saved document body.
 * The package is deliberately small and self-contained: it has no metadata,
 * media, macros, fields, hyperlinks, external relationships, or archive reads.
 * The generated paragraphs and runs remain natively editable in Word. */
import { writeOfficeZip } from './artifactOfficeZip.ts'
import {
  artifactExportFilename,
  DOCX_MEDIA_TYPE,
  MAX_ARTIFACT_BLOCK_CHARS,
  MAX_AUTHORED_DOCUMENT_BLOCKS,
  MAX_AUTHORED_DOCUMENT_CHARS,
  type ArtifactWordExport,
  type ArtifactContent,
} from '../contract/index.ts'

type DocumentBody = Extract<ArtifactContent, { type: 'doc' }>
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** XML 1.0 admits tabs, line feeds, carriage returns, and the specified
 * Unicode ranges only. Check UTF-16 units explicitly so lone surrogates are
 * refused instead of being replaced by a transport or XML encoder. */
function hasWordprocessingText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false
      index += 1
      continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return false
    if (unit === 0x09 || unit === 0x0a || unit === 0x0d || (unit >= 0x20 && unit <= 0xd7ff) || (unit >= 0xe000 && unit <= 0xfffd)) continue
    return false
  }
  return true
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function textRuns(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n')
  return normalized.split(/([\n\t])/u).map((part) => {
    if (part === '\n') return '<w:r><w:br/></w:r>'
    if (part === '\t') return '<w:r><w:tab/></w:r>'
    if (!part) return ''
    const preserve = /^\s|\s$/u.test(part) ? ' xml:space="preserve"' : ''
    return `<w:r><w:t${preserve}>${escapeXml(part)}</w:t></w:r>`
  }).join('')
}

function paragraph(value: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${textRuns(value)}</w:p>`
}

function emailParagraph(label: string, value: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${label}</w:t></w:r>${textRuns(value)}</w:p>`
}

function validBody(body: ArtifactContent): body is DocumentBody {
  if (!body || typeof body !== 'object' || body.type !== 'doc' || typeof body.title !== 'string' || !Array.isArray(body.blocks) || body.blocks.length > MAX_AUTHORED_DOCUMENT_BLOCKS) return false
  if (body.title.length > MAX_ARTIFACT_BLOCK_CHARS || !hasWordprocessingText(body.title)) return false
  let chars = 0
  for (const block of body.blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block) || Object.keys(block).length !== 1) return false
    let values: string[]
    if ('h' in block && typeof block.h === 'string') values = [block.h]
    else if ('p' in block && typeof block.p === 'string') values = [block.p]
    else if ('ul' in block && Array.isArray(block.ul) && block.ul.length <= MAX_AUTHORED_DOCUMENT_BLOCKS && block.ul.every((value) => typeof value === 'string')) values = block.ul
    else if ('code' in block && Array.isArray(block.code) && block.code.length <= MAX_AUTHORED_DOCUMENT_BLOCKS && block.code.every((value) => typeof value === 'string')) values = block.code
    else if ('email' in block && block.email && typeof block.email === 'object' && !Array.isArray(block.email) && Object.keys(block.email).length === 2 && typeof block.email.to === 'string' && typeof block.email.subject === 'string') values = [block.email.to, block.email.subject]
    else return false
    if (!values.every((value) => typeof value === 'string' && value.length <= MAX_ARTIFACT_BLOCK_CHARS && hasWordprocessingText(value))) return false
    chars += values.reduce((sum, value) => sum + value.length, 0)
    if (chars > MAX_AUTHORED_DOCUMENT_CHARS) return false
  }
  return true
}

/** Whole-body admission check shared by the route and serializer. It refuses
 * malformed/oversized shapes as well as XML-invalid controls and UTF-16. */
export function hasWordText(body: DocumentBody): boolean {
  return validBody(body)
}

const STYLES = `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>`

const NUMBERING = `${XML}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`

function bodyXml(body: DocumentBody): string {
  const blocks = body.blocks.flatMap((block) => {
    if ('h' in block) return [paragraph(block.h, 'Heading1')]
    if ('p' in block) return [paragraph(block.p, 'Normal')]
    if ('ul' in block) return block.ul.map((item) => paragraph(item, 'ListBullet'))
    if ('code' in block) return block.code.map((line) => paragraph(line, 'Code'))
    return [emailParagraph('To: ', block.email.to), emailParagraph('Subject: ', block.email.subject)]
  }).join('')
  return `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraph(body.title, 'Title')}${blocks}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

export async function documentDocx(name: string, body: DocumentBody): Promise<Omit<ArtifactWordExport, 'artifactId'> | null> {
  if (!validBody(body)) return null
  const parts: Array<[string, string]> = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', bodyXml(body)],
    ['word/styles.xml', STYLES],
    ['word/numbering.xml', NUMBERING],
    ['word/_rels/document.xml.rels', `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`],
  ]
  const bytes = await writeOfficeZip(parts)
  return { filename: artifactExportFilename(name, 'docx'), mediaType: DOCX_MEDIA_TYPE, encoding: 'base64', content: Buffer.from(bytes).toString('base64'), revision: body.revision ?? 0 }
}
