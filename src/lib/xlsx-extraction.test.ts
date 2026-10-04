import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractWorkbook, extractXlsx } from './xlsxExtraction.ts'
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
const chartSheetRel = `${OFFICE_NS}/chartsheet`
const chartSheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml'

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

function structuredWorkbookFixture(): Uint8Array {
  // Keep source order stable while making the fourth workbook entry a chart
  // sheet. Its package member is deliberately inert; it must never be parsed.
  const entries = {
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_NS}"><sheets>` +
      `<sheet name="Values" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/>` +
      `<sheet name="Hidden" sheetId="3" state="veryHidden" r:id="rId3"/><sheet name="Chart" sheetId="4" r:id="rId4"/>` +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${WORKSHEET_REL}" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="${WORKSHEET_REL}" Target="worksheets/sheet3.xml"/>` +
      `<Relationship Id="rId4" Type="${chartSheetRel}" Target="chartsheets/sheet4.xml"/>` +
      '</Relationships>',
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${worksheetType}"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${worksheetType}"/>` +
      `<Override PartName="/xl/worksheets/sheet3.xml" ContentType="${worksheetType}"/>` +
      `<Override PartName="/xl/chartsheets/sheet4.xml" ContentType="${chartSheetType}"/>` +
      '</Types>',
    'xl/worksheets/sheet1.xml': customSheet(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>alpha &amp; &lt;beta&gt;</t></is></c>' +
      '<c r="C1" t="b"><v>1</v></c><c r="D1" t="n"><v>900719925474099312345</v></c>' +
      '<c r="F1" t="d"><v>2026-10-04T09:15:00Z</v></c><c r="G1" t="e"><v>#N/A</v></c>' +
      '<c r="I1" t="str"><f>IF(A1=&quot;x&quot;,&quot;&quot;,&quot;other&quot;)</f><v></v></c>' +
      '<c r="K1" t="str"><f>1+1</f></c></row>' +
      '<row r="3"><c r="B3" t="inlineStr"><is><t>_x005F_x0041_</t></is></c></row>',
    ),
    'xl/worksheets/sheet2.xml': customSheet(''),
    'xl/worksheets/sheet3.xml': customSheet('<row r="1"><c r="A1" t="inlineStr"><is><t>hidden-value</t></is></c></row>'),
    'xl/chartsheets/sheet4.xml': '<chartSheet><chart>not workbook cell data</chart></chartSheet>',
  }
  return xlsxFixture({ sheets: [{ name: 'placeholder', rows: [] }], entries })
}

test('structured workbook preserves a cell beginning with a Unicode BOM', async () => {
  const result = await extractWorkbook(xlsxFixture({ sheets: [{ name: 'Data', rows: [['\ufeffliteral marker']] }] }))
  assert.equal(result.documentImport.status, 'ready')
  assert.equal(result.workbook?.worksheets[0]?.cells[0]?.value, '\ufeffliteral marker')
})

test('structured workbook mode preserves visible sheet identity, empties, sparse literals and formula cache state', async () => {
  const result = await extractWorkbook(structuredWorkbookFixture())
  assert.deepEqual(result, {
    documentImport: { format: 'xlsx', status: 'ready' },
    workbook: {
      totalSheets: 4,
      hiddenSheets: 1,
      unsupportedSheets: 1,
      worksheets: [
        { sourceSheet: 1, name: 'Values', cells: [
          { row: 1, column: 1, value: 'alpha & <beta>' },
          { row: 1, column: 3, value: 'TRUE' },
          { row: 1, column: 4, value: '900719925474099312345' },
          { row: 1, column: 6, value: '2026-10-04T09:15:00Z' },
          { row: 1, column: 7, value: '#N/A' },
          { row: 1, column: 9, value: '', formula: 'cached' },
          { row: 1, column: 11, value: '', formula: 'missing' },
          { row: 3, column: 2, value: '_x0041_' },
        ] },
        { sourceSheet: 2, name: 'Empty', cells: [] },
      ],
    },
  })
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('IF(A1'), false, 'formula code is never returned')
  assert.equal(serialized.includes('hidden-value'), false, 'hidden worksheet content is never returned')
  assert.equal(serialized.includes('not workbook cell data'), false, 'chart sheet content is never returned')
})

test('structured workbook mode rejects duplicate cell coordinates and unsafe relationships without partial data', async () => {
  const duplicate = await extractWorkbook(xlsxFixture({ entries: {
    'xl/worksheets/sheet1.xml': customSheet('<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row>'),
  } }))
  assert.deepEqual(duplicate, { documentImport: { format: 'xlsx', status: 'invalid' } })

  const unsafe = await extractWorkbook(xlsxFixture({ entries: {
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${WORKSHEET_REL}" Target="../../outside.xml"/></Relationships>`,
  } }))
  assert.deepEqual(unsafe, { documentImport: { format: 'xlsx', status: 'invalid' } })
})

test('structured workbook mode decodes shared and rich strings once without changing literal escapes', async () => {
  const sheet = customSheet('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>')
  const strings = `<sst xmlns="${SHEET_NS}"><si><t>_x005F_x0041_</t></si><si><r><t>rich </t></r><r><t>text &amp; data</t></r></si></sst>`
  const result = await extractWorkbook(sharedStringFixture(sheet, strings))
  assert.deepEqual(result, {
    documentImport: { format: 'xlsx', status: 'ready' },
    workbook: {
      totalSheets: 1,
      hiddenSheets: 0,
      unsupportedSheets: 0,
      worksheets: [{ sourceSheet: 1, name: 'Visible', cells: [
        { row: 1, column: 1, value: '_x0041_' },
        { row: 1, column: 3, value: 'rich text & data' },
      ] }],
    },
  })
})

test('structured workbook mode retains workbook bounds and does not change legacy text projection', async () => {
  const tooManySheets = await extractWorkbook(xlsxFixture({ sheets: Array.from({ length: MAX_XLSX_SHEETS + 1 }, (_, index) => ({ name: `S${index}`, rows: [['x']] })) }))
  assert.equal(tooManySheets.documentImport.status, 'structure-limit')
  assert.equal('workbook' in tooManySheets, false, 'a limit failure never returns a partial snapshot')

  const tooManyCells = await extractWorkbook(xlsxFixture({ sheets: [{ name: 'Cells', rows: Array.from({ length: MAX_XLSX_CELLS + 1 }, () => [1]) }] }))
  assert.equal(tooManyCells.documentImport.status, 'structure-limit')
  assert.equal('workbook' in tooManyCells, false, 'a cell-limit failure never returns a partial snapshot')

  const legacy = await extractXlsx(xlsxFixture({ sheets: [{ name: 'Visible', rows: [['kept', null, 7]] }] }))
  assert.equal(readyText(legacy), 'Sheet: "Visible"\nA1: "kept"\nC1: 7\n')
  assert.equal('workbook' in legacy, false)
})

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
