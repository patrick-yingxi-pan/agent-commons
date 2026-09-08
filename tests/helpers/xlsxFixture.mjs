import { deflateRawSync } from 'node:zlib'

const TRANSITIONAL_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const WORKSHEET_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

function asBytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError('XLSX fixture entries must be strings or Uint8Arrays')
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

// Fixture-only ZIP writer. Production XLSX parsing uses the pinned zip.js
// reader; keeping this writer local makes the fixture deterministic and
// dependency-free.
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

function columnName(index) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function columnIndex(value) {
  if (Number.isInteger(value) && value >= 1) return value
  const text = String(value ?? '').trim().toUpperCase()
  if (!/^[A-Z]+$/.test(text)) throw new TypeError('XLSX fixture column must be a positive number or A-Z name')
  let result = 0
  for (const character of text) result = result * 26 + character.charCodeAt(0) - 64
  return result
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('XLSX fixture rows must be an array')
  return rows
}

function cellXml(reference, cell) {
  if (cell === null || cell === undefined) return ''
  const object = cell && typeof cell === 'object' && !Array.isArray(cell) ? cell : { value: cell }
  const formula = object.formula === undefined ? undefined : String(object.formula)
  const value = object.cached === undefined ? object.value : object.cached
  const valueType = object.type === undefined ? undefined : String(object.type)
  let type = valueType
  let body = ''
  if (formula !== undefined) body += `<f>${xmlEscape(formula)}</f>`
  if (value === undefined || value === null) {
    if (formula === undefined) return ''
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    type ??= 'n'
    body += `<v>${String(value)}</v>`
  } else if (typeof value === 'boolean') {
    type ??= 'b'
    body += `<v>${value ? '1' : '0'}</v>`
  } else {
    type ??= formula === undefined ? 'inlineStr' : 'str'
    if (type === 'inlineStr') body += `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`
    else body += `<v>${xmlEscape(value)}</v>`
  }
  const typeAttribute = type ? ` t="${xmlEscape(type)}"` : ''
  return `<c r="${reference}"${typeAttribute}>${body}</c>`
}

function worksheetXml(sheet) {
  const rows = normalizeRows(sheet.rows ?? [])
  const hiddenRows = new Set((sheet.hiddenRows ?? []).map((row) => Number(row)))
  const hiddenColumns = (sheet.hiddenColumns ?? []).map(columnIndex)
  const columnXml = hiddenColumns.map((column) => `<col min="${column}" max="${column}" hidden="1"/>`).join('')
  const rowXml = rows.map((cells, rowIndex) => {
    if (!Array.isArray(cells)) return ''
    const rowNumber = rowIndex + 1
    const cellsXml = cells.map((cell, columnIndex) => cellXml(`${columnName(columnIndex)}${rowNumber}`, cell)).join('')
    if (!cellsXml) return ''
    const hidden = hiddenRows.has(rowNumber) ? ' hidden="1"' : ''
    return `<row r="${rowNumber}"${hidden}>${cellsXml}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${SPREADSHEET_NS}"><cols>${columnXml}</cols><sheetData>${rowXml}</sheetData></worksheet>`
}

function normalizeSheet(sheet, index) {
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) throw new TypeError('XLSX fixture sheets must be objects')
  const name = String(sheet.name ?? `Sheet${index + 1}`)
  if (!name || name.length > 31 || /[\\/*?:\[\]]/.test(name)) throw new TypeError('XLSX fixture sheet name is invalid')
  const state = sheet.state === undefined ? (sheet.hidden ? 'hidden' : 'visible') : String(sheet.state)
  if (!['visible', 'hidden', 'veryHidden'].includes(state)) throw new TypeError('XLSX fixture sheet state is invalid')
  return { ...sheet, name, state }
}

/**
 * Build a deterministic real OOXML workbook for browser/native extraction
 * tests. Rows are zero-based arrays and hiddenRows are one-based worksheet
 * row numbers. hiddenColumns accepts one-based numbers or A-Z column names.
 * A cell object may provide formula and optional cached value; omitting the
 * cached value creates a formula without a cache. `entries` can replace or
 * add arbitrary package members for malformed-package tests.
 */
export function xlsxFixture({ sheets = [{ name: 'Visible', rows: [] }], entries = {} } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new TypeError('XLSX fixture needs at least one sheet')
  const normalizedSheets = sheets.map(normalizeSheet)
  const workbookSheets = normalizedSheets.map((sheet, index) => {
    const state = sheet.state === 'visible' ? '' : ` state="${sheet.state}"`
    return `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"${state}/>`
  }).join('')
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`
  const workbookRelationships = [
    ...normalizedSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${WORKSHEET_REL}" Target="worksheets/sheet${index + 1}.xml"/>`),
  ].join('')
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    normalizedSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    `</Types>`
  const generated = new Map([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${TRANSITIONAL_REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${TRANSITIONAL_REL_NS}">${workbookRelationships}</Relationships>`],
    ...normalizedSheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)]),
  ])
  for (const [name, value] of Object.entries(entries ?? {})) generated.set(String(name), value)
  const ordered = [...generated.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return zipArchive(ordered)
}

export { crc32 }
