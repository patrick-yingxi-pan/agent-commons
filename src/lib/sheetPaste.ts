import {
  MAX_AUTHORED_CELL_CHARS, MAX_AUTHORED_SHEET_COLUMNS, MAX_AUTHORED_SHEET_ROWS,
  parseStructuredArtifactBody, type StructuredArtifactBody,
} from '../../contract/artifactAuthoring.ts'
import { isFormulaCell, type SheetCell } from '../../contract/sheetCell.ts'
import { parseDelimitedText } from './delimitedText.ts'

export type SpreadsheetBody = Exclude<StructuredArtifactBody, { type: 'slides' }>
export const MAX_SHEET_PASTE_BYTES = 256 * 1024
export type SheetPasteResult =
  | { kind: 'native' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; body: SpreadsheetBody; rows: number; columns: number; replacedFormulas: number }

export type SheetPasteFeedback = {
  message: string; error: boolean; before?: SpreadsheetBody; after: string
}

/** Feed the returned state back into the owner, so an observed later edit
 * permanently retires feedback/Undo even if another pane restores equal text. */
export function reconcileSheetPasteFeedback(feedback: SheetPasteFeedback | null, body: SpreadsheetBody): SheetPasteFeedback | null {
  return feedback?.after === JSON.stringify(body) ? feedback : null
}

/** A clipboard gesture changes one draft, never a saved artifact. Ordinary
 * single-line text retains textarea selection/caret behavior. Table text uses
 * TSV quoting, including embedded tabs/newlines and literal formula strings. */
export function pasteSheetCells(body: SpreadsheetBody, sheetId: string, row: number, column: number, source: string): SheetPasteResult {
  if (!/[\t\r\n]/.test(source)) return { kind: 'native' }
  const error = (message: string): SheetPasteResult => ({ kind: 'error', message: `${message} Nothing was pasted.` })
  if (source.length > MAX_SHEET_PASTE_BYTES || new TextEncoder().encode(source).byteLength > MAX_SHEET_PASTE_BYTES) {
    return error('Paste up to 256 KiB of tab-separated text at once.')
  }
  const grid = body.type === 'sheet' ? (sheetId === 'sheet-1' ? body : undefined) : body.sheets.find(sheet => sheet.id === sheetId)
  if (!grid || !Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= grid.rows.length || column >= grid.columns.length) {
    return error('Choose an existing destination cell.')
  }
  const cells = parseDelimitedText(source, '\t')
  if (!cells || cells.some(values => values.length !== cells[0]!.length)) {
    return error('Use a rectangular table with tabs between cells and valid quoted values.')
  }
  const height = cells.length
  const width = cells[0]!.length
  const rows = Math.max(grid.rows.length, row + height)
  const columns = Math.max(grid.columns.length, column + width)
  if (rows > MAX_AUTHORED_SHEET_ROWS || columns > MAX_AUTHORED_SHEET_COLUMNS) {
    return error('The pasted range must fit within 200 rows and 32 columns.')
  }
  if (cells.some(values => values.some(value => value.length > MAX_AUTHORED_CELL_CHARS))) {
    return error('Each pasted cell must contain at most 2,000 characters.')
  }
  let replacedFormulas = 0
  const nextRows: SheetCell[][] = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => {
    if (r >= row && r < row + height && c >= column && c < column + width) {
      if (isFormulaCell(grid.rows[r]?.[c])) replacedFormulas++
      // Clipboard imports are always literal. Formula-looking text is never
      // promoted implicitly, and overwriting an authored formula is disclosed.
      return cells[r - row]![c - column]!
    }
    return grid.rows[r]?.[c] ?? ''
  }))
  const nextGrid = {
    ...grid,
    columns: Array.from({ length: columns }, (_, index) => grid.columns[index] ?? `Column ${index + 1}`),
    rows: nextRows,
  }
  const candidate: SpreadsheetBody = body.type === 'sheet' ? { ...nextGrid, type: 'sheet' }
    : { ...body, sheets: body.sheets.map(sheet => sheet.id === sheetId ? { ...sheet, ...nextGrid } : sheet) }
  const parsed = parseStructuredArtifactBody(candidate)
  if (!parsed || parsed.type === 'slides') {
    return error('Review worksheet names, column labels and the workbook’s 6,400-cell / 20,000-character limits.')
  }
  return { kind: 'ready', body: parsed, rows: height, columns: width, replacedFormulas }
}
