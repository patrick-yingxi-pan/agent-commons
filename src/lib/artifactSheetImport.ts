import {
  MAX_AUTHORED_CELL_CHARS,
  MAX_AUTHORED_LABEL_CHARS,
  MAX_AUTHORED_SHEET_COLUMNS,
  MAX_AUTHORED_SHEET_ROWS,
  MAX_AUTHORED_STRUCTURE_CHARS,
  parseStructuredArtifactBody,
  type StructuredArtifactBody,
} from '../../contract/artifactAuthoring.ts'
import { LOCAL_TEXT_PREVIEW_BYTES } from '../../contract/localTextFile.mjs'
import { normalizeArtifactName } from '../../contract/artifactMetadata.ts'
import { parseWorkbookImportResult, parseWorkbookSnapshot, type WorkbookSnapshot } from '../../contract/workbookImport.ts'
import { isXlsxFileName, xlsxImportCopy } from '../../contract/xlsxImport.mjs'
import type { UiHostFile } from './uiHostFs.ts'

const MAX_IMPORTED_RECORDS = MAX_AUTHORED_SHEET_ROWS + 1
const MAX_SOURCE_RECTANGLE_ROWS = MAX_AUTHORED_SHEET_ROWS + 1
const MAX_SOURCE_RECTANGLE_COLUMNS = MAX_AUTHORED_SHEET_COLUMNS

export type ArtifactSheetImportResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string; records: string[][]; delimiter: ',' | '\t' }
  | { status: 'ready'; name: string; workbook: WorkbookSnapshot }

export type ArtifactSheetMappingResult =
  | { status: 'ready'; body: Extract<StructuredArtifactBody, { type: 'sheet' }>; disclosure: string; worksheet?: { sourceSheet: number; name: string } }
  | { status: 'error'; message: string }

export function isArtifactSheetFileName(name: string): boolean {
  return typeof name === 'string' && (/\.(csv|tsv)$/i.test(name) || isXlsxFileName(name))
}

function importedName(name: string): string {
  const leaf = name.trim().split(/[\\/]/).at(-1) ?? ''
  const dot = leaf.lastIndexOf('.')
  return normalizeArtifactName(`${dot > 0 ? leaf.slice(0, dot) : leaf}.xlsx`) ?? 'imported-sheet.xlsx'
}

function parseDelimited(source: string, delimiter: ',' | '\t'): string[][] | undefined {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let closedQuote = false

  const finishCell = () => {
    row.push(cell)
    cell = ''
  }
  const finishRow = () => {
    finishCell()
    rows.push(row)
    row = []
  }
  const isBreak = (char: string) => char === '\r' || char === '\n'

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char !== '"') {
        cell += char
        continue
      }
      if (source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = false
        closedQuote = true
      }
      continue
    }

    if (closedQuote) {
      if (char === delimiter) {
        finishCell()
        closedQuote = false
      } else if (isBreak(char)) {
        finishRow()
        closedQuote = false
        if (char === '\r' && source[index + 1] === '\n') index += 1
      } else {
        return undefined
      }
      continue
    }

    if (char === '"') {
      if (cell.length !== 0) return undefined
      quoted = true
    } else if (char === delimiter) {
      finishCell()
    } else if (isBreak(char)) {
      finishRow()
      if (char === '\r' && source[index + 1] === '\n') index += 1
    } else {
      cell += char
    }
  }

  if (quoted) return undefined
  if (cell.length > 0 || row.length > 0 || closedQuote) finishRow()
  return rows.length ? rows : undefined
}

function columnLabel(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return `Column ${result}`
}

export function reviewArtifactSheetImport(
  files: readonly Pick<UiHostFile, 'name' | 'kind' | 'text' | 'documentImport' | 'workbook'>[],
): ArtifactSheetImportResult {
  if (files.length === 0) return { status: 'cancelled' }
  if (files.length !== 1) return { status: 'error', message: 'Choose one CSV, TSV, or XLSX file to import.' }
  const file = files[0]
  if (file.kind !== 'file' || !isArtifactSheetFileName(file.name)) return { status: 'error', message: 'Choose a CSV (.csv), TSV (.tsv), or XLSX (.xlsx) file.' }
  if (isXlsxFileName(file.name)) {
    if (Object.hasOwn(file, 'text')) return { status: 'error', message: 'Choose an XLSX workbook without a mixed text preview.' }
    const reviewed = file.documentImport?.status === 'ready'
      ? parseWorkbookImportResult({ documentImport: file.documentImport, workbook: file.workbook })
      : parseWorkbookImportResult({ documentImport: file.documentImport })
    if (reviewed.documentImport.status !== 'ready') {
      const copy = xlsxImportCopy(reviewed.documentImport)
      return { status: 'error', message: copy.replace(/\breattach\b/gi, 'choose again for import').replace(/\battach\b/gi, 'choose') || 'The workbook did not produce a complete worksheet snapshot.' }
    }
    if (!reviewed.workbook) return { status: 'error', message: 'The workbook did not produce a complete worksheet snapshot.' }
    const leaf = file.name.trim().split(/[\\/]/).at(-1) ?? ''
    return { status: 'ready', name: normalizeArtifactName(leaf) ?? 'imported-sheet.xlsx', workbook: reviewed.workbook }
  }
  if (typeof file.text !== 'string') return { status: 'error', message: 'Choose a valid UTF-8 CSV or TSV file under 256 KiB.' }
  if (file.text.length > LOCAL_TEXT_PREVIEW_BYTES || new TextEncoder().encode(file.text).byteLength > LOCAL_TEXT_PREVIEW_BYTES) return { status: 'error', message: 'Choose a valid UTF-8 CSV or TSV file under 256 KiB.' }
  const source = file.text.startsWith('\uFEFF') ? file.text.slice(1) : file.text
  const delimiter: ',' | '\t' = /\.tsv$/i.test(file.name) ? '\t' : ','
  const records = parseDelimited(source, delimiter)
  if (!records) return { status: 'error', message: 'The selected sheet has malformed CSV/TSV quoting or no records.' }
  if (records.length > MAX_IMPORTED_RECORDS) return { status: 'error', message: `The selected sheet exceeds the ${MAX_IMPORTED_RECORDS} record import limit.` }
  const width = records[0]?.length ?? 0
  if (width < 1 || width > MAX_AUTHORED_SHEET_COLUMNS || records.some((record) => record.length !== width)) {
    return { status: 'error', message: `The selected sheet must have one consistent row width of 1–${MAX_AUTHORED_SHEET_COLUMNS} columns.` }
  }
  if (records.some((record) => record.some((cell) => cell.length > MAX_AUTHORED_CELL_CHARS))) {
    return { status: 'error', message: `The selected sheet has a cell exceeding the ${MAX_AUTHORED_CELL_CHARS.toLocaleString()} character limit.` }
  }
  return { status: 'ready', name: importedName(file.name), records, delimiter }
}

export function mapArtifactSheetImport(candidate: ArtifactSheetImportResult, firstRowHeaders: boolean, sourceSheet?: number): ArtifactSheetMappingResult {
  if (candidate.status !== 'ready') return { status: 'error', message: candidate.status === 'cancelled' ? 'Sheet import was cancelled.' : candidate.message }
  if ('workbook' in candidate) {
    const workbook = parseWorkbookSnapshot(candidate.workbook)
    if (!workbook) return { status: 'error', message: 'The worksheet snapshot is invalid. No cells were imported.' }
    const worksheet = sourceSheet === undefined
      ? workbook.worksheets[0]
      : workbook.worksheets.find((sheet) => sheet.sourceSheet === sourceSheet)
    if (!worksheet) return { status: 'error', message: 'Choose a visible worksheet from this workbook. No cells were imported.' }
    if (worksheet.cells.some((cell) => cell.formula === 'missing')) {
      return { status: 'error', message: `A formula in “${worksheet.name}” has no saved cached value. Recalculate and save the workbook in Excel, then choose it again. No cells were imported.` }
    }
    const nonempty = worksheet.cells.filter((cell) => cell.value.length > 0)
    if (!nonempty.length) return { status: 'error', message: `No nonempty cells were found in “${worksheet.name}”. No cells were imported.` }
    const minRow = Math.min(...nonempty.map((cell) => cell.row))
    const maxRow = Math.max(...nonempty.map((cell) => cell.row))
    const minColumn = Math.min(...nonempty.map((cell) => cell.column))
    const maxColumn = Math.max(...nonempty.map((cell) => cell.column))
    const height = maxRow - minRow + 1
    const width = maxColumn - minColumn + 1
    if (height > MAX_SOURCE_RECTANGLE_ROWS || width > MAX_SOURCE_RECTANGLE_COLUMNS) {
      return { status: 'error', message: `The nonempty source rectangle in “${worksheet.name}” exceeds ${MAX_SOURCE_RECTANGLE_ROWS} source rows or ${MAX_SOURCE_RECTANGLE_COLUMNS} columns. Narrow the used range before importing. No cells were imported.` }
    }
    const records = Array.from({ length: height }, () => Array<string>(width).fill(''))
    for (const cell of nonempty) records[cell.row - minRow]![cell.column - minColumn] = cell.value
    if (records.some((record) => record.some((value) => value.length > MAX_AUTHORED_CELL_CHARS))) {
      return { status: 'error', message: `A cell exceeds the ${MAX_AUTHORED_CELL_CHARS.toLocaleString()} character limit. Shorten it before importing. No cells were imported.` }
    }
    const mapped = mapRecords(records, firstRowHeaders)
    if (mapped.status === 'error') return mapped
    const hidden = workbook.hiddenSheets ? ` ${workbook.hiddenSheets} hidden ${workbook.hiddenSheets === 1 ? 'sheet is' : 'sheets are'} omitted.` : ''
    const unsupported = workbook.unsupportedSheets ? ` ${workbook.unsupportedSheets} unsupported ${workbook.unsupportedSheets === 1 ? 'sheet is' : 'sheets are'} omitted.` : ''
    const sourceRange = `${columnLabel(minColumn - 1).slice(7)}${minRow}:${columnLabel(maxColumn - 1).slice(7)}${maxRow}`
    return {
      ...mapped,
      worksheet: { sourceSheet: worksheet.sourceSheet, name: worksheet.name },
      disclosure: `${mapped.disclosure} Source worksheet “${worksheet.name}” (${worksheet.sourceSheet} of ${workbook.totalSheets}); source range ${sourceRange} was cropped to the top-left while retaining interior gaps.${hidden}${unsupported} Cached formula values may be out of date; formulas are not calculated. Dates and formatted numbers remain raw values. Formatting, merged cells, charts, images, and hidden contents are not imported.`,
    }
  }
  const { records } = candidate
  return mapRecords(records, firstRowHeaders)
}

function mapRecords(records: string[][], firstRowHeaders: boolean): ArtifactSheetMappingResult {
  const columns = firstRowHeaders ? records[0] : records[0].map((_, index) => columnLabel(index))
  const rows = firstRowHeaders ? records.slice(1) : records
  if (firstRowHeaders && (columns.some((column) => !column.trim()) || columns.some((column) => column.length > MAX_AUTHORED_LABEL_CHARS) || rows.length < 1)) {
    return { status: 'error', message: `The first row must contain nonblank headers no longer than ${MAX_AUTHORED_LABEL_CHARS} characters and at least one data row. Uncheck “First row contains column names” to keep that row as data.` }
  }
  if (rows.length > MAX_AUTHORED_SHEET_ROWS) return { status: 'error', message: `The sheet has more than ${MAX_AUTHORED_SHEET_ROWS} data rows.` }
  const body = parseStructuredArtifactBody({ type: 'sheet', columns, rows })
  if (!body || body.type !== 'sheet') return { status: 'error', message: `The complete sheet exceeds the ${MAX_AUTHORED_STRUCTURE_CHARS.toLocaleString()} character authoring limit.` }
  return {
    status: 'ready',
    body,
    disclosure: firstRowHeaders
      ? `Imported ${rows.length} data ${rows.length === 1 ? 'row' : 'rows'} with the first row as headers. Values remain literal text; formulas are not evaluated.`
      : `Imported ${rows.length} data ${rows.length === 1 ? 'row' : 'rows'} with generated Column A–${columnLabel(columns.length - 1).slice(7)} headers. Values remain literal text; formulas are not evaluated.`,
  }
}
