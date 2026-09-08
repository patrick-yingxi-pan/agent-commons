import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractXlsx } from './xlsxExtraction.ts'
import { workbookRelationships, workbookSheets, workbookStrings, worksheetValues } from './xlsxText.ts'
import {
  MAX_XLSX_CELLS, MAX_XLSX_EXPANDED_BYTES, MAX_XLSX_PART_BYTES, MAX_XLSX_SHEETS, MAX_XLSX_TEXT_BYTES, MAX_XLSX_SHARED_STRINGS,
} from '../../contract/xlsxImport.mjs'
import { xlsxFixture } from '../../tests/helpers/xlsxFixture.mjs'

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WORKBOOK_REL = `${OFFICE_NS}/officeDocument`
const WORKSHEET_REL = `${OFFICE_NS}/worksheet`
const SHARED_REL = `${OFFICE_NS}/sharedStrings`
const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const worksheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const sharedType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'

const readyText = (result: Awaited<ReturnType<typeof extractXlsx>>) => {
  assert.equal(result.documentImport.status, 'ready')
  assert.equal(typeof result.text, 'string')
  return result.text!
}

function customSheet(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SHEET_NS}"><sheetData>${body}</sheetData></worksheet>`
}

function sharedStringFixture(sheet: string, sharedStrings: string): Uint8Array {
  const types = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${worksheetType}"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="${sharedType}"/>` +
    '</Types>'
  const relationships = `<?xml version="1.0"?><Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${SHARED_REL}" Target="sharedStrings.xml"/>` +
    '</Relationships>'
  return xlsxFixture({ entries: {
    '[Content_Types].xml': types,
    'xl/_rels/workbook.xml.rels': relationships,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': sharedStrings,
  } })
}

test('projects sparse visible cells with exact coordinates and safe value forms', async () => {
  const result = await extractXlsx(xlsxFixture({ sheets: [{ name: 'Values', rows: [
    [null, 'inline', 9007199254740991, true, { type: 'e', value: '#N/A' }, { formula: 'A1+B1', cached: 7 }, { formula: 'A1' }],
    [],
    [null, null, '_x0041_ and _x005F_x0041_'],
  ] }] }))
  assert.equal(readyText(result), 'Sheet: "Values"\nB1: "inline"\nC1: 9007199254740991\nD1: TRUE\nE1: "#N/A" [cell error]\nF1: 7 [cached formula value]\nG1: [formula value not saved]\nC3: "A and _x0041_"\n')
})

test('retains raw numeric precision, shared strings, rich strings and one-pass escapes', async () => {
  const sheet = customSheet('<row r="1"><c r="A1"><v>90071992547409931234567890.125</v></c><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>')
  const strings = `<sst xmlns="${SHEET_NS}" count="2" uniqueCount="2"><si><t>_x0041_</t></si><si><r><t>rich </t></r><r><t>text</t></r></si></sst>`
  const result = await extractXlsx(sharedStringFixture(sheet, strings))
  assert.equal(readyText(result), 'Sheet: "Visible"\nA1: 90071992547409931234567890.125\nB1: "A"\nC1: "rich text"\n')
})

test('hidden sheets, veryHidden sheets, rows and columns never enter the text projection', async () => {
  const result = await extractXlsx(xlsxFixture({ sheets: [
    { name: 'Visible', rows: [['kept', 'column-hidden'], ['row-hidden', 'kept-too']], hiddenRows: [2], hiddenColumns: ['B'] },
    { name: 'Hidden', state: 'hidden', rows: [['secret']] },
    { name: 'VeryHidden', state: 'veryHidden', rows: [['also secret']] },
  ] }))
  assert.equal(readyText(result), 'Sheet: "Visible"\nA1: "kept"\n')
})

test('empty or entirely hidden workbooks produce no-text without a partial text field', async () => {
  for (const workbook of [
    xlsxFixture(),
    xlsxFixture({ sheets: [{ name: 'Hidden', state: 'veryHidden', rows: [['secret']] }] }),
  ]) {
    const result = await extractXlsx(workbook)
    assert.deepEqual(result, { documentImport: { format: 'xlsx', status: 'no-text' } })
  }
})

test('empty cached formula text differs from an absent cached value', async () => {
  const sheet = customSheet('<row><c t="str"><f>IF(A2,\"yes\",\"\")</f><v></v></c><c t="str"><f>A2</f></c></row>')
  assert.equal(readyText(await extractXlsx(xlsxFixture({ entries: { 'xl/worksheets/sheet1.xml': sheet } }))),
    'Sheet: "Visible"\nA1: "" [cached formula value]\nB1: [formula value not saved]\n')
})

test('zero dimensions exclude cells for every numeric spelling, including default-hidden rows', async () => {
  const sheet = `<worksheet xmlns="${SHEET_NS}"><sheetFormatPr zeroHeight="true"/><cols><col min="2" max="2" width="0.0"/></cols><sheetData>` +
    '<row r="1" hidden="false"><c r="A1" t="str"><v>kept</v></c><c r="B1" t="str"><v>hidden-column</v></c></row>' +
    '<row r="2" hidden="false" ht="0e0"><c r="A2" t="str"><v>hidden-height</v></c></row>' +
    '<row r="3"><c r="A3" t="str"><v>hidden-default</v></c></row></sheetData></worksheet>'
  assert.equal(readyText(await extractXlsx(xlsxFixture({ entries: { 'xl/worksheets/sheet1.xml': sheet } }))), 'Sheet: "Visible"\nA1: "kept"\n')
})

test('escaped controls remain quoted data, never raw controls or broken Unicode in the projection', async () => {
  const result = readyText(await extractXlsx(xlsxFixture({ sheets: [{ name: 'Text', rows: [['_x0000__xD800__x000A__xD83D__xDE00_']] }] })))
  assert.equal(result, 'Sheet: "Text"\nA1: "\\u0000\\ud800\\n😀"\n')
  assert.equal(result.isWellFormed(), true)
  assert.equal(result.includes('\u0000'), false)
})

test('relationships and content types are bounded to internal worksheet parts', async () => {
  const external = xlsxFixture({ entries: {
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="https://example.invalid/sheet.xml" TargetMode="External"/></Relationships>`,
  } })
  assert.equal((await extractXlsx(external)).documentImport.status, 'unsupported')

  const traversal = xlsxFixture({ entries: {
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="../../outside.xml"/></Relationships>`,
  } })
  assert.equal((await extractXlsx(traversal)).documentImport.status, 'invalid')

  const macroType = xlsxFixture({ entries: {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>`,
  } })
  assert.equal((await extractXlsx(macroType)).documentImport.status, 'unsupported')
})

test('malformed cell types and references fail closed', async () => {
  for (const [body, status] of [
    ['<row r="1"><c r="A1" t="future"><v>x</v></c></row>', 'unsupported'],
    ['<row r="1"><c r="A2"><v>1</v></c></row>', 'invalid'],
    ['<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row>', 'invalid'],
    ['<row r="1"><c r="A1" t="s"><v>4</v></c></row>', 'invalid'],
  ] as const) {
    const result = await extractXlsx(xlsxFixture({ entries: { 'xl/worksheets/sheet1.xml': customSheet(body) } }))
    assert.deepEqual(result, { documentImport: { format: 'xlsx', status } })
    assert.equal('text' in result, false)
  }
})

test('sheet, cell and text budgets reject without returning partial ready output', async () => {
  const tooManySheets = await extractXlsx(xlsxFixture({ sheets: Array.from({ length: MAX_XLSX_SHEETS + 1 }, (_, index) => ({ name: `S${index}`, rows: [['x']] })) }))
  assert.equal(tooManySheets.documentImport.status, 'structure-limit')

  const tooManyCells = await extractXlsx(xlsxFixture({ sheets: [{ name: 'Cells', rows: Array.from({ length: MAX_XLSX_CELLS + 1 }, () => [1]), hiddenRows: Array.from({ length: MAX_XLSX_CELLS + 1 }, (_, index) => index + 1) }] }))
  assert.equal(tooManyCells.documentImport.status, 'structure-limit')

  const tooMuchText = await extractXlsx(xlsxFixture({ sheets: [{ name: 'Text', rows: [[`x`.repeat(MAX_XLSX_TEXT_BYTES)]] }] }))
  assert.deepEqual(tooMuchText, { documentImport: { format: 'xlsx', status: 'text-limit' } })
  assert.equal('text' in tooMuchText, false)

  const tooLargePart = await extractXlsx(xlsxFixture({ entries: { 'xl/workbook.xml': `<workbook>${'x'.repeat(MAX_XLSX_PART_BYTES + 1)}</workbook>` } }))
  assert.deepEqual(tooLargePart, { documentImport: { format: 'xlsx', status: 'structure-limit' } })

  const tooExpanded = await extractXlsx(xlsxFixture({ entries: { 'unused.bin': 'x'.repeat(MAX_XLSX_EXPANDED_BYTES + 1) } }))
  assert.deepEqual(tooExpanded, { documentImport: { format: 'xlsx', status: 'structure-limit' } })
})

test('XML and archive failures never become ready', async () => {
  const deep = '<x>'.repeat(129) + '</x>'.repeat(129)
  assert.deepEqual(await extractXlsx(xlsxFixture({ entries: { 'xl/worksheets/sheet1.xml': customSheet(deep) } })), { documentImport: { format: 'xlsx', status: 'structure-limit' } })
  assert.deepEqual(await extractXlsx(new TextEncoder().encode('not a ZIP')), { documentImport: { format: 'xlsx', status: 'invalid' } })
  assert.deepEqual(await extractXlsx(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), { documentImport: { format: 'xlsx', status: 'unsupported' } })
})

test('shared string count is bounded even when no cell refers to the strings', () => {
  assert.throws(() => workbookStrings(`<sst xmlns="${SHEET_NS}">${'<si><t>x</t></si>'.repeat(MAX_XLSX_SHARED_STRINGS + 1)}</sst>`),
    (error) => error.status === 'structure-limit')
})

test('pure workbook parsers reject duplicate identities and preserve exact XML values', () => {
  assert.throws(() => workbookSheets(`<workbook xmlns="${SHEET_NS}"><sheets><sheet name="A" sheetId="1" r:id="r1" xmlns:r="${OFFICE_NS}"/><sheet name="a" sheetId="2" r:id="r2" xmlns:r="${OFFICE_NS}"/></sheets></workbook>`), (error) => error.status === 'invalid')
  assert.throws(() => workbookRelationships(`<Relationships xmlns="${REL_NS}"><Relationship Id="r1" Type="${WORKSHEET_REL}" Target="../sheet.xml"/><Relationship Id="r1" Type="${WORKSHEET_REL}" Target="sheet2.xml"/></Relationships>`, 'xl/workbook.xml'), (error) => error.status === 'invalid')
  assert.deepEqual(workbookStrings(`<sst xmlns="${SHEET_NS}"><si><t>_x005F_x0041_</t></si><si><r><t>a</t></r><r><t>b</t></r></si></sst>`), ['_x0041_', 'ab'])
  const values: Array<[string, string]> = []
  worksheetValues(customSheet('<row r="1"><c r="A1" t="n"><v>900719925474099312345</v></c></row>'), [], { cells: 0 }, (address, value) => values.push([address, value]))
  assert.deepEqual(values, [['A1', '900719925474099312345']])
})
