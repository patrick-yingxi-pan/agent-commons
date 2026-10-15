import {
  MAX_XLSX_FILE_BYTES, MAX_XLSX_ENTRIES, MAX_XLSX_PART_BYTES, MAX_XLSX_EXPANDED_BYTES, MAX_XLSX_TEXT_BYTES,
  xlsxImportFailure, type XlsxImportResult, type XlsxImportOutcome,
} from '../../contract/xlsxImport.mjs'
import { OfficeExtractionError, readOfficePackage, officeMainPart, assertOfficeContentType } from './officePackage.ts'
import { parseWorkbookImportResult, type WorkbookImportResult, type WorkbookSnapshot } from '../../contract/workbookImport.ts'
import { workbookMainType, worksheetType, sharedStringsType, workbookRelationships, workbookSheets, workbookStrings, worksheetValues, relationshipKind } from './xlsxText.ts'

/** Worker-only package projection. No relationship can grant network/file
 * access, and no formula, macro, chart or embedded object is executed. */
export async function extractXlsx(bytes: Uint8Array): Promise<XlsxImportResult> {
  const text = textProjection()
  return text.result(await walkWorkbook(bytes, text.visit))
}

/** Structured review has its own closed result; attachment text is never parsed
 * back into cells and never accompanies this transient workbook snapshot. */
export async function extractWorkbook(bytes: Uint8Array): Promise<WorkbookImportResult> {
  const workbook = workbookProjection()
  return workbook.result(await walkWorkbook(bytes, workbook.visit))
}

type WorkbookVisit = {
  sheet(index: number, name: string): void
  hidden(): void
  unsupported(): void
  cell(address: string, value: string, literal: WorkbookSnapshot['worksheets'][number]['cells'][number]): void
}

type WorkbookVisitStatus = Exclude<XlsxImportOutcome['status'], 'ready' | 'no-text'> | undefined

/** The package, relationship and worksheet walk is shared by the legacy text
 * reader and the combined preview. Projection sinks own their text budgets;
 * a sink may stop accepting values while the other sink continues. */
async function walkWorkbook(bytes: Uint8Array, visit: WorkbookVisit): Promise<WorkbookVisitStatus> {
  if (bytes.byteLength > MAX_XLSX_FILE_BYTES) return 'file-too-large'
  let archive: Awaited<ReturnType<typeof readOfficePackage>> | undefined
  try {
    archive = await readOfficePackage(bytes, { maxEntries: MAX_XLSX_ENTRIES, maxPartBytes: MAX_XLSX_PART_BYTES, maxExpandedBytes: MAX_XLSX_EXPANDED_BYTES })
    const main = officeMainPart(await archive.readPart('_rels/.rels'))
    const types = await archive.readPart('[Content_Types].xml')
    assertOfficeContentType(types, main, workbookMainType)
    const sheets = workbookSheets(await archive.readPart(main))
    const slash = main.lastIndexOf('/') + 1
    const relationships = workbookRelationships(await archive.readPart(`${main.slice(0, slash)}_rels/${main.slice(slash)}.rels`), main)
    const shared = [...relationships.values()].filter((relation) => relationshipKind(relation.type, 'sharedStrings'))
    if (shared.length > 1 || shared[0]?.external) throw new OfficeExtractionError('unsupported')
    const strings = shared[0] ? (assertOfficeContentType(types, shared[0].target, sharedStringsType), workbookStrings(await archive.readPart(shared[0].target))) : []
    const targets = new Set<string>()
    const budget = { cells: 0 }
    for (const [index, sheet] of sheets.entries()) {
      const relation = relationships.get(sheet.relation)
      if (!relation) throw new OfficeExtractionError('invalid')
      if (relation.external) throw new OfficeExtractionError('unsupported')
      if (targets.has(relation.target)) throw new OfficeExtractionError('invalid')
      targets.add(relation.target)
      // Chart/dialog sheets and hidden sheets are intentionally not text input.
      if (sheet.hidden) { visit.hidden(); continue }
      if (!relationshipKind(relation.type, 'worksheet')) {
        if (relationshipKind(relation.type, 'chartsheet') || relationshipKind(relation.type, 'dialogsheet')) { visit.unsupported(); continue }
        throw new OfficeExtractionError('unsupported')
      }
      assertOfficeContentType(types, relation.target, worksheetType)
      visit.sheet(index, sheet.name)
      worksheetValues(await archive.readPart(relation.target), strings, budget, visit.cell)
    }
    return undefined
  } catch (error) {
    return error instanceof OfficeExtractionError ? error.status : 'invalid'
  } finally { await archive?.close() }
}

function textProjection(): { visit: WorkbookVisit; result: (status?: WorkbookVisitStatus) => XlsxImportResult } {
  const encoder = new TextEncoder()
  const output: string[] = []
  let heading = ''
  let used = 0
  let failure: 'text-limit' | undefined
  return {
    visit: {
      sheet(_index, name) { heading = `${output.length ? '\n\n' : ''}Sheet: ${JSON.stringify(name)}\n` },
      hidden() {}, unsupported() {},
      cell(address, value) {
        if (failure) return
        const line = `${heading}${address}: ${value}\n`
        used += encoder.encode(line).byteLength
        if (used > MAX_XLSX_TEXT_BYTES) { failure = 'text-limit'; return }
        output.push(line); heading = ''
      },
    },
    result(status) {
      const finalStatus = failure ?? status
      return finalStatus ? xlsxImportFailure(finalStatus) : output.length
        ? { text: output.join(''), documentImport: { format: 'xlsx', status: 'ready' } }
        : { documentImport: { format: 'xlsx', status: 'no-text' } }
    },
  }
}

function workbookProjection(): { visit: WorkbookVisit; result: (status?: WorkbookVisitStatus) => WorkbookImportResult } {
  const encoder = new TextEncoder()
  const workbook: WorkbookSnapshot = { totalSheets: 0, hiddenSheets: 0, unsupportedSheets: 0, worksheets: [] }
  let used = 0
  let failure: 'text-limit' | undefined
  return {
    visit: {
      sheet(index, name) {
        workbook.totalSheets += 1
        const sheet = { sourceSheet: index + 1, name, cells: [] as WorkbookSnapshot['worksheets'][number]['cells'] }
        workbook.worksheets.push(sheet)
        used += encoder.encode(name).byteLength
        if (used > MAX_XLSX_TEXT_BYTES) failure = 'text-limit'
      },
      hidden() { workbook.totalSheets += 1; workbook.hiddenSheets += 1 },
      unsupported() { workbook.totalSheets += 1; workbook.unsupportedSheets += 1 },
      cell(_address, _value, literal) {
        if (failure) return
        used += encoder.encode(literal.value).byteLength
        if (used > MAX_XLSX_TEXT_BYTES) failure = 'text-limit'
        else workbook.worksheets.at(-1)!.cells.push(literal)
      },
    },
    result(status) {
      const finalStatus = failure ?? status
      if (finalStatus) return { documentImport: { format: 'xlsx', status: finalStatus } }
      return workbook.worksheets.length
        ? parseWorkbookImportResult({ documentImport: { format: 'xlsx', status: 'ready' }, workbook })
        : { documentImport: { format: 'xlsx', status: 'no-text' } }
    },
  }
}

/** One-pass local preview: attachment text and the structured workbook are
 * independent projections of the same validated archive traversal. */
export async function extractXlsxPreview(bytes: Uint8Array): Promise<XlsxImportResult & { workbookImport: WorkbookImportResult }> {
  const text = textProjection()
  const workbook = workbookProjection()
  const status = await walkWorkbook(bytes, {
    hidden() { text.visit.hidden(); workbook.visit.hidden() },
    unsupported() { text.visit.unsupported(); workbook.visit.unsupported() },
    sheet(index, name) { text.visit.sheet(index, name); workbook.visit.sheet(index, name) },
    cell(address, value, literal) { text.visit.cell(address, value, literal); workbook.visit.cell(address, value, literal) },
  })
  return { ...text.result(status), workbookImport: workbook.result(status) }
}
