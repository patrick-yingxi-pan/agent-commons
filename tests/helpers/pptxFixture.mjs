import { deflateRawSync } from 'node:zlib'

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

function asBytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError('PPTX fixture entries must be strings or Uint8Arrays')
}

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
  result.writeUInt16LE(value)
  return result
}

function u32(value) {
  const result = Buffer.alloc(4)
  result.writeUInt32LE(value >>> 0)
  return result
}

// Fixture-only deterministic ZIP writer. Production PPTX parsing uses the
// pinned zip.js reader; no archive dependency belongs in the test helper.
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
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc),
      u32(compressed.length), u32(plain.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBytes,
    ]))
    offset += local.length
  }
  const localBytes = Buffer.concat(locals)
  const centralBytes = Buffer.concat(central)
  return Buffer.concat([
    localBytes,
    centralBytes,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(localBytes.length), u16(0),
  ])
}

function normalizeParagraphs(value) {
  if (Array.isArray(value)) return value.map((part) => String(part))
  return [String(value ?? '')]
}

function textBody(value) {
  const paragraphs = normalizeParagraphs(value).map((paragraph) =>
    `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(paragraph)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`).join('')
  return `<a:bodyPr/><a:lstStyle/>${paragraphs}`
}

function shapeXml(id, value, hidden = false, name = `TextBox ${id}`) {
  const hiddenAttribute = hidden ? ' hidden="1"' : ''
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"${hiddenAttribute}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody>${textBody(value)}</p:txBody></p:sp>`
}

function tableXml(id, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const width = Math.max(1, ...rows.map((row) => Array.isArray(row) ? row.length : 0))
  const grid = Array.from({ length: width }, () => '<a:gridCol w="1000000"/>').join('')
  const rowXml = rows.map((row) => {
    const cells = Array.isArray(row) ? row : []
    return `<a:tr h="370840">${Array.from({ length: width }, (_, index) => `<a:tc><a:txBody>${textBody(cells[index] ?? '')}</a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`
  }).join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="8000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${rowXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

function shapeTree(slide) {
  let nextId = 2
  const visible = (slide.shapes ?? []).map((shape) => {
    const value = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape.text : shape
    const name = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape.name : undefined
    return shapeXml(nextId++, value, false, name ?? `TextBox ${nextId - 1}`)
  })
  const hidden = (slide.hiddenShapes ?? []).map((shape) => {
    const value = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape.text : shape
    const name = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape.name : undefined
    return shapeXml(nextId++, value, true, name ?? `Hidden TextBox ${nextId - 1}`)
  })
  const table = tableXml(nextId++, slide.table)
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${visible.join('')}${table}${hidden.join('')}</p:spTree>`
}

function slideXml(slide) {
  const show = slide.hidden ? ' show="0"' : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"${show}><p:cSld name="${xmlEscape(slide.name ?? '')}">${shapeTree(slide)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function notesXml(slide) {
  const notes = slide.notes ?? []
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${notes.map((note, index) => shapeXml(index + 2, note, false, `Notes ${index + 1}`)).join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
}

function normalizeSlide(slide, index) {
  if (!slide || typeof slide !== 'object' || Array.isArray(slide)) throw new TypeError('PPTX fixture slides must be objects')
  return { ...slide, name: String(slide.name ?? `Slide ${index + 1}`) }
}

/**
 * Build a deterministic OOXML presentation for text-projection tests. Slide
 * `shapes` are emitted in order as visible text boxes, `table` is emitted
 * after those shapes, `hiddenShapes` are marked hidden, and `hidden` hides the
 * whole slide. `slideOrder` can permute relationship targets and slide IDs to
 * ensure consumers follow presentation order rather than ZIP file order.
 * `notes` are real notes-slide parts and must not be imported.
 * `entries` replaces or adds arbitrary package members for malformed tests.
 */
export function pptxFixture({ slides = [{ name: 'Slide 1' }], slideOrder, entries = {} } = {}) {
  if (!Array.isArray(slides) || slides.length === 0) throw new TypeError('PPTX fixture needs at least one slide')
  const normalizedSlides = slides.map(normalizeSlide)
  const order = slideOrder === undefined ? normalizedSlides.map((_, index) => index) : slideOrder
  if (!Array.isArray(order) || order.length !== normalizedSlides.length ||
      new Set(order).size !== normalizedSlides.length ||
      order.some((index) => !Number.isInteger(index) || index < 0 || index >= normalizedSlides.length)) {
    throw new TypeError('PPTX fixture slideOrder must be a permutation of slide indexes')
  }
  const slideIds = order.map((index, position) => {
    return `<p:sldId id="${256 + index}" r:id="rId${position + 1}"/>`
  }).join('')
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:sldMasterIdLst/><p:notesMasterIdLst/><p:handoutMasterIdLst/><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  const presentationRelationships = order.map((index, position) => `<Relationship Id="rId${position + 1}" Type="${SLIDE_REL}" Target="slides/slide${index + 1}.xml"/>`).join('')
  const generated = new Map([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${normalizedSlides.map((slide, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>${slide.notes?.length ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : ''}`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="ppt/presentation.xml"/></Relationships>`],
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${presentationRelationships}</Relationships>`],
    ...normalizedSlides.flatMap((slide, index) => {
      const slideEntries = [[`ppt/slides/slide${index + 1}.xml`, slideXml(slide)]]
      if (slide.notes?.length) {
        slideEntries.push([`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${NOTES_REL}" Target="../notesSlides/notesSlide${index + 1}.xml"/></Relationships>`])
        slideEntries.push([`ppt/notesSlides/notesSlide${index + 1}.xml`, notesXml(slide)])
      }
      return slideEntries
    }),
  ])
  for (const [name, value] of Object.entries(entries ?? {})) generated.set(String(name), value)
  const ordered = [...generated.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return zipArchive(ordered)
}

export { crc32 }
