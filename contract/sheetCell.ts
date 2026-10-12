/** Text is always literal, including text starting with '='. Only an explicit
 * formula record opts into the bounded authored-sheet calculator. */
export type SheetCell = string | { formula: string }

export function isFormulaCell(cell: SheetCell | null | undefined): cell is { formula: string } {
  return typeof cell === 'object' && cell !== null
}

export function sheetCellSource(cell: SheetCell): string {
  return isFormulaCell(cell) ? cell.formula : cell
}

export function cloneSheetCell(cell: SheetCell): SheetCell {
  return isFormulaCell(cell) ? { formula: cell.formula } : cell
}

export function sheetColumnLabel(column: number): string {
  let label = ''
  for (let remaining = column + 1; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    label = String.fromCharCode(65 + (remaining - 1) % 26) + label
  }
  return label
}

/** Coordinates name data cells. Editable column headings are not row 1. */
export function sheetCellAddress(row: number, column: number): string {
  return `${sheetColumnLabel(column)}${row + 1}`
}
