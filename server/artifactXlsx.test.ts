import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { SaxesParser } from 'saxes'
import { sheetXlsx, spreadsheetColumn, spreadsheetText } from './artifactXlsx.ts'

async function parts(content: string): Promise<Record<string, string>> {
  const zip = new ZipReader(new Uint8ArrayReader(Buffer.from(content, 'base64')), { checkSignature: true })
  try {
    const entries = await zip.getEntries()
    assert.equal(new Set(entries.map((entry) => entry.filename)).size, entries.length)
    return Object.fromEntries(await Promise.all(entries.map(async (entry) => [entry.filename, await entry.getData!(new TextWriter(), { checkSignature: true })])))
  } finally { await zip.close() }
}

// Independent XML parser plus one-pass ST_Xstring decoding, never the writer's
// escaping helper. Preserve escaped-underscore sequences without double decoding.
function cells(files: Record<string, string>, worksheet = 'xl/worksheets/sheet1.xml'): Record<string, string> {
  const strings: string[] = []
  let stored = ''
  const stringsParser = new SaxesParser({ xmlns: true })
  stringsParser.on('opentag', (tag) => {
    if (tag.local === 't') { stored = ''; assert.equal(tag.attributes['xml:space'].value, 'preserve') }
  })
  stringsParser.on('text', (text) => { stored += text })
  stringsParser.on('closetag', (tag) => {
    if (tag.local === 't') strings.push(stored.replace(/_x([0-9a-fA-F]{4})_/g, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16))))
  })
  stringsParser.write(files['xl/sharedStrings.xml']).close()
  const result: Record<string, string> = {}
  const parser = new SaxesParser({ xmlns: true })
  let address = '', text = '', reading = false
  parser.on('opentag', (tag) => {
    assert.notEqual(tag.local, 'f', 'saved strings must never become formulas')
    if (tag.local === 'c') {
      address = tag.attributes.r.value
      assert.equal(tag.attributes.t.value, 's')
    }
    if (tag.local === 'v') { reading = true; text = '' }
  })
  parser.on('text', (value) => { if (reading) text += value })
  parser.on('closetag', (tag) => {
    if (tag.local === 'v') {
      assert.match(text, /^(0|[1-9]\d*)$/)
      assert.ok(Number(text) < strings.length)
      result[address] = strings[Number(text)]
      reading = false
    }
  })
  parser.write(files[worksheet]).close()
  return result
}

function tabNames(files: Record<string, string>): string[] {
  const names: string[] = []
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', (tag) => {
    if (tag.local === 'sheet') names.push(tag.attributes.name.value.replace(/_x([0-9a-fA-F]{4})_/g, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16))))
  })
  parser.write(files['xl/workbook.xml']).close()
  return names
}

test('XLSX preserves every literal cell, whitespace, escape-looking text and XML-invalid UTF-16', async () => {
  const values = ['=1+1', '+SUM(1)', '-1', '@external', '00123', '', '  spaces\t\n\r\r\n  ', '<&>"\'', '日本語 😀', '_x000A_ _x005F_ _xFFFF_ _X000A_', '\0\u000b\ufffe\uffff', '\ud800lone\udfff']
  const body = { type: 'sheet' as const, columns: ['Literal'], rows: values.map((value) => [value]), note: '  Note\r\n_x000A_  ', revision: 7 }
  const exported = await sheetXlsx('../CON.bad', body)
  assert.equal(exported.filename, '_CON.xlsx')
  assert.equal(exported.revision, 7)
  assert.equal(exported.encoding, 'base64')
  const files = await parts(exported.content)
  const decoded = cells(files)
  assert.deepEqual(values.map((_value, index) => decoded[`A${index + 2}`]), values)
  assert.equal(decoded[`A${values.length + 4}`], body.note)
  assert.equal(decoded.A1, 'Literal')
  assert.equal(spreadsheetText('😀'), '😀', 'valid pairs are kept as Unicode, not replacement characters')
  assert.deepEqual(body.rows, values.map((value) => [value]), 'export must not mutate its snapshot')
})

test('XLSX exports ordered workbook tabs with names and literal cells on every sheet', async () => {
  const body = {
    type: 'workbook' as const,
    revision: 12,
    sheets: [
      { id: 'overview', name: 'Overview & status', columns: ['Task', 'Value'], rows: [['=1+1', '00123'], ['Escaped _x000A_', '日本語']], note: 'First & foremost' },
      { id: 'second', name: 'O\'Brien', columns: ['Only'], rows: [['<literal>']] },
    ],
  }
  const exported = await sheetXlsx('Quarterly', body)
  assert.equal(exported.revision, 12)
  const files = await parts(exported.content)
  for (const text of Object.values(files)) new SaxesParser({ xmlns: true }).write(text).close()
  const workbook = files['xl/workbook.xml']
  assert.match(workbook, /<sheet name="Overview &amp; status" sheetId="1" r:id="rId1"\/>/)
  assert.match(workbook, /<sheet name="O&apos;Brien" sheetId="2" r:id="rId2"\/>/)
  assert.deepEqual(Object.keys(files).filter((path) => /xl\/worksheets\/sheet\d+\.xml/u.test(path)).sort(), [
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
  ])
  const first = cells(files, 'xl/worksheets/sheet1.xml')
  const second = cells(files, 'xl/worksheets/sheet2.xml')
  assert.equal(first.A1, 'Task')
  assert.equal(first.A2, '=1+1')
  assert.equal(first.B2, '00123')
  assert.equal(first.A3, 'Escaped _x000A_')
  assert.equal(first.A5, 'Note')
  assert.equal(first.A6, 'First & foremost')
  assert.equal(second.A1, 'Only')
  assert.equal(second.A2, '<literal>')
  assert.equal(files['xl/_rels/workbook.xml.rels'].match(/Type="[^"]*\/worksheet"/gu)?.length, 2)
  assert.match(files['[Content_Types].xml'], /PartName="\/xl\/worksheets\/sheet2\.xml"/)
  assert.doesNotMatch(Object.values(files).join(''), /<f[\s>]|TargetMode="External"|hyperlink/)
  assert.deepEqual(body.sheets.map((sheet) => sheet.name), ['Overview & status', "O'Brien"])
})

test('XLSX workbook tab names preserve literal escape sequences after one ST_Xstring decode', async () => {
  const names = ['_x0041_', '_x005F_', 'R&D "日本語"']
  const body = {
    type: 'workbook' as const,
    sheets: names.map((name, index) => ({ id: `sheet-${index + 1}`, name, columns: ['Value'], rows: [[name]] })),
  }
  const exported = await sheetXlsx('Tab names', body)
  const files = await parts(exported.content)
  for (const xml of Object.values(files)) new SaxesParser({ xmlns: true }).write(xml).close()
  assert.deepEqual(tabNames(files), names)
})

test('XLSX is one self-contained valid XML package with readable saved-value formatting', async () => {
  const body = { type: 'sheet' as const, columns: ['Person', 'Status'], rows: [['Ada', 'Ready'], ['Grace', 'Review\nNext week']] }
  const first = await sheetXlsx('Team.sheet', body)
  assert.deepEqual(await sheetXlsx('Team.sheet', body), first, 'same saved input produces the same package bytes')
  const files = await parts(first.content)
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort())
  for (const text of Object.values(files)) {
    new SaxesParser({ xmlns: true }).write(text).close()
    assert.doesNotMatch(text, /TargetMode="External"|<f[\s>]|externalLink|vbaProject|hyperlink/)
  }
  const sheet = files['xl/worksheets/sheet1.xml']
  assert.match(sheet, /autoFilter ref="A1:B3"/)
  assert.match(sheet, /state="frozen"/)
  assert.match(sheet, /showGridLines="0"/)
  assert.match(files['xl/styles.xml'], /wrapText="1"/)
  assert.equal(Object.keys(cells(files)).length, 6, 'no invented note or other data')
})

test('XLSX retains the last cell at the maximum rectangular authoring bounds', async () => {
  const columns = Array.from({ length: 32 }, (_, index) => `Column ${index + 1}`)
  const rows = Array.from({ length: 200 }, () => Array.from({ length: 32 }, () => ''))
  rows[199][31] = 'Last cell'
  const exported = await sheetXlsx('Maximum.xlsx', { type: 'sheet', columns, rows })
  assert.ok(exported.content.length < 2 * 1024 * 1024, 'all accepted cells fit the download decoder ceiling')
  const decoded = cells(await parts(exported.content))
  assert.equal(Object.keys(decoded).length, 32 * 201)
  assert.equal(decoded.AF201, 'Last cell')
  assert.deepEqual([0, 25, 26, 31].map(spreadsheetColumn), ['A', 'Z', 'AA', 'AF'])
})
