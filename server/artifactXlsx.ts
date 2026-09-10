/** Values-only OOXML writer. No archive reads, formulas, external relationships,
 * resource fetches, or arbitrary parts: the package is entirely generated here.
 * ST_Xstring escaping follows MS-OE376 §2.1.1127, including literal escape text:
 * https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/bd0aa042-434a-4ca7-b25f-4e1fd25a954d */
import { artifactExportFilename, XLSX_MEDIA_TYPE, type ArtifactContent, type ArtifactSpreadsheetExport } from '../contract/index.ts'
import { writeOfficeZip } from './artifactOfficeZip.ts'

type SheetBody = Extract<ArtifactContent, { type: 'sheet' }>
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** Escape original text in one pass so newly emitted escapes are never escaped
 * again. Iterate code points to retain valid surrogate pairs; lone UTF-16 units
 * and XML-invalid characters use the reversible SpreadsheetML escape. */
export function spreadsheetText(value: string): string {
  return value.replace(/_[xX][0-9a-fA-F]{4}_|[&<>"']|[\u0000-\u0008\u000b-\u001f\ufffe\uffff]|[\ud800-\udfff]/gu, (match) => {
    if (match.startsWith('_')) return `_x005F_${match.slice(1)}`
    const entity = ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' } as Record<string, string>)[match]
    return entity ?? `_x${match.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`
  })
}

export function spreadsheetColumn(index: number): string {
  let label = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label
  return label
}

function displayWidth(value: string): number {
  return Math.max(...value.split(/[\r\n]/u).map((line) => Array.from(line).reduce((sum, char) => sum + (char.codePointAt(0)! > 0xff ? 2 : 1), 0)))
}

function rowXml(values: string[], row: number, widths: number[], style: number, stringId: (value: string) => number): string {
  const lines = Math.max(1, ...values.map((text, column) => text.split(/\r\n|[\r\n]/u)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(displayWidth(line) / Math.max(1, widths[column] - 2))), 0)))
  // Excel itself caps row height at 409 points. Longer values remain complete
  // in the cell and formula bar; no source content is truncated to fit a view.
  const height = Math.min(409, Math.max(24, lines * 15 + 8))
  return `<row r="${row}" ht="${height}" customHeight="1">${values.map((value, column) =>
    `<c r="${spreadsheetColumn(column)}${row}" s="${style}" t="s"><v>${stringId(value)}</v></c>`).join('')}</row>`
}

const STYLES = `${XML}<styleSheet xmlns="${MAIN}"><fonts count="3"><font><sz val="11"/><color rgb="FF202A35"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><i/><sz val="11"/><color rgb="FF526174"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF283F54"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

export async function sheetXlsx(name: string, body: SheetBody): Promise<Omit<ArtifactSpreadsheetExport, 'artifactId'>> {
  const strings = new Map<string, number>()
  let count = 0
  const stringId = (value: string): number => {
    count++
    if (!strings.has(value)) strings.set(value, strings.size)
    return strings.get(value)!
  }
  const widths = body.columns.map((column, index) => Math.min(60, Math.max(18, displayWidth(column) + 3, ...body.rows.map((row) => displayWidth(row[index]) + 3))))
  const lastColumn = spreadsheetColumn(body.columns.length - 1)
  const dataEnd = body.rows.length + 1
  const hasNote = body.note !== undefined
  const sheet = `${XML}<worksheet xmlns="${MAIN}"><dimension ref="A1:${lastColumn}${dataEnd + (hasNote ? 3 : 0)}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rowXml(body.columns, 1, widths, 1, stringId)}${body.rows.map((row, index) => rowXml(row, index + 2, widths, 0, stringId)).join('')}${hasNote ? rowXml(['Note'], dataEnd + 2, widths, 2, stringId) + rowXml([body.note!], dataEnd + 3, widths, 2, stringId) : ''}</sheetData><autoFilter ref="A1:${lastColumn}${dataEnd}"/></worksheet>`
  const parts: [string, string][] = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', `${XML}<sst xmlns="${MAIN}" count="${count}" uniqueCount="${strings.size}">${Array.from(strings.keys(), (value) => `<si><t xml:space="preserve">${spreadsheetText(value)}</t></si>`).join('')}</sst>`],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheet],
  ]
  // Stored entries avoid a worker/WASM/compressor dependency in the native
  // sidecar. Inputs are the already bounded saved sheet, not arbitrary uploads.
  const bytes = await writeOfficeZip(parts)
  return { filename: artifactExportFilename(name, 'xlsx'), mediaType: XLSX_MEDIA_TYPE, encoding: 'base64', content: Buffer.from(bytes).toString('base64'), revision: body.revision ?? 0 }
}
