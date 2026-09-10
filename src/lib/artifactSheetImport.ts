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
import type { UiHostFile } from './uiHostFs.ts'

const MAX_IMPORTED_RECORDS = MAX_AUTHORED_SHEET_ROWS + 1

export type ArtifactSheetImportResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string; records: string[][]; delimiter: ',' | '\t' }

export type ArtifactSheetMappingResult =
  | { status: 'ready'; body: Extract<StructuredArtifactBody, { type: 'sheet' }>; disclosure: string }
  | { status: 'error'; message: string }

export function isArtifactSheetFileName(name: string): boolean {
  return typeof name === 'string' && /\.(csv|tsv)$/i.test(name)
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
  files: readonly Pick<UiHostFile, 'name' | 'kind' | 'text'>[],
): ArtifactSheetImportResult {
  if (files.length === 0) return { status: 'cancelled' }
  if (files.length !== 1) return { status: 'error', message: 'Choose one CSV or TSV file to import.' }
  const file = files[0]
  if (file.kind !== 'file' || !isArtifactSheetFileName(file.name)) return { status: 'error', message: 'Choose a CSV (.csv) or TSV (.tsv) file.' }
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

export function mapArtifactSheetImport(candidate: ArtifactSheetImportResult, firstRowHeaders: boolean): ArtifactSheetMappingResult {
  if (candidate.status !== 'ready') return { status: 'error', message: candidate.status === 'cancelled' ? 'Sheet import was cancelled.' : candidate.message }
  const { records } = candidate
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
