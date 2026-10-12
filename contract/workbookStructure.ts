import type { SheetGrid, WorkbookSheet } from './content.ts'
import { cloneSheetCell, isFormulaCell, sheetCellAddress, sheetCellSource } from './sheetCell.ts'
import { MAX_AUTHORED_CELL_CHARS, MAX_AUTHORED_STRUCTURE_CHARS, workbookSheetNameError } from './workbook.ts'
import { parseWorkbookFormula, referenceInBounds, workbookReferenceResolver, type FormulaExpression, type FormulaReference } from './workbookFormula.ts'

type Change = { start: number; end: number; text: string }
type Edit = { kind: 'rename'; name: string } | { kind: 'sheet' } | { kind: 'row' | 'column'; index: number }
const clone = (sheets: readonly WorkbookSheet[]): WorkbookSheet[] => sheets.map(sheet => ({
  ...sheet, columns: [...sheet.columns], rows: sheet.rows.map(row => row.map(cloneSheetCell)),
}))

/** Rewriting must not silently create an unsavable source. Other draft fields
 * may still be incomplete; only the text budgets affected here are checked. */
function withinSourceBudget(sheets: readonly WorkbookSheet[]): boolean {
  let characters = 0
  for (const sheet of sheets) {
    characters += sheet.columns.reduce((total, column) => total + column.length, 0) + (sheet.note?.length ?? 0)
    for (const row of sheet.rows) for (const cell of row) {
      const text = sheetCellSource(cell)
      if (text.length > MAX_AUTHORED_CELL_CHARS) return false
      characters += text.length
    }
  }
  return characters <= MAX_AUTHORED_STRUCTURE_CHARS
}

function rewrite(source: string, sheets: readonly WorkbookSheet[], current: number, target: number, edit: Edit): string {
  let tree: FormulaExpression
  try { tree = parseWorkbookFormula(source) } catch { return source }
  const resolve = workbookReferenceResolver(sheets)
  const changes: Change[] = []
  const replace = (span: { start: number; end: number }, text: string) => changes.push({ ...span, text })
  const rename = (ref: FormulaReference) => {
    if (edit.kind !== 'rename' || !ref.sheet) return
    const name = /^[A-Za-z_][A-Za-z_0-9]*$/u.test(edit.name) && source[ref.sheet.start] !== "'" ? edit.name : `'${edit.name.replaceAll("'", "''")}'`
    replace(ref.sheet, name)
  }
  const address = (ref: FormulaReference, value: number) => {
    if (edit.kind !== 'row' && edit.kind !== 'column') return
    replace({ start: ref.addressStart, end: ref.end }, sheetCellAddress(edit.kind === 'row' ? value : ref.row, edit.kind === 'column' ? value : ref.column))
  }
  let unsupported = false
  const walk = (node: FormulaExpression) => {
    if (node.kind === 'ref') {
      if (resolve(node, current) !== target) return
      if (edit.kind === 'rename') { rename(node); return }
      if (edit.kind === 'sheet') { replace(node, '#REF!'); return }
      const value = node[edit.kind]
      if (!referenceInBounds(sheets, target, node) || value === edit.index) replace(node, '#REF!')
      else if (value > edit.index) address(node, value - 1)
    } else if (node.kind === 'range') {
      const from = resolve(node.from, current), to = resolve(node.to, from)
      if (from !== to && from >= 0 && to >= 0) { unsupported = true; return }
      if (from !== target || to !== target) return
      if (edit.kind === 'rename') { rename(node.from); rename(node.to); return }
      if (edit.kind === 'sheet') { replace(node, '#REF!'); return }
      const a = node.from[edit.kind], b = node.to[edit.kind]
      if (!referenceInBounds(sheets, target, node.from) || !referenceInBounds(sheets, target, node.to) || (a === edit.index && b === edit.index)) {
        replace(node, '#REF!')
      } else {
        const adjust = (value: number, other: number) => value > edit.index ? value - 1 : value === edit.index && other < edit.index ? value - 1 : value
        const nextA = adjust(a, b), nextB = adjust(b, a)
        if (nextA !== a) address(node.from, nextA)
        if (nextB !== b) address(node.to, nextB)
      }
    } else if (node.kind === 'unary') walk(node.child)
    else if (node.kind === 'binary') { walk(node.left); walk(node.right) }
    else if (node.kind === 'sum') node.args.forEach(walk)
  }
  walk(tree)
  if (unsupported) return source
  let result = source
  for (const change of changes.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.text + result.slice(change.end)
  return result
}

/** Resolve names in the complete pre-image before applying a stable-ID edit.
 * Every surviving formula is rewritten once. Refusal still returns a detached
 * value, so draft Undo can always own an exact whole-workbook pre-image. */
function editWorkbook(sheets: readonly WorkbookSheet[], id: string, edit: Edit): WorkbookSheet[] {
  const target = sheets.findIndex(sheet => sheet.id === id)
  if (target < 0 || sheets.filter(sheet => sheet.id === id).length !== 1) return clone(sheets)
  const grid = sheets[target]
  if (edit.kind === 'rename' && workbookSheetNameError(sheets, id, edit.name)) return clone(sheets)
  if (edit.kind === 'sheet' && sheets.length <= 1) return clone(sheets)
  if (edit.kind === 'row' || edit.kind === 'column') {
    const length = edit.kind === 'row' ? grid.rows.length : grid.columns.length
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= length || length <= 1) return clone(sheets)
  }
  const candidate = sheets.flatMap((sheet, current): WorkbookSheet[] => {
    const chosen = current === target
    if (chosen && edit.kind === 'sheet') return []
    return [{
      ...sheet,
      name: chosen && edit.kind === 'rename' ? edit.name : sheet.name,
      columns: sheet.columns.filter((_, index) => !chosen || edit.kind !== 'column' || index !== edit.index),
      rows: sheet.rows.filter((_, index) => !chosen || edit.kind !== 'row' || index !== edit.index).map(row => row
        .filter((_, index) => !chosen || edit.kind !== 'column' || index !== edit.index)
        .map(cell => isFormulaCell(cell) ? { formula: rewrite(cell.formula, sheets, current, target, edit) } : cell)),
    }]
  })
  return withinSourceBudget(candidate) ? candidate : clone(sheets)
}

export function renameWorkbookSheet(sheets: readonly WorkbookSheet[], id: string, name: string): WorkbookSheet[] { return editWorkbook(sheets, id, { kind: 'rename', name }) }
export function removeWorkbookSheet(sheets: readonly WorkbookSheet[], id: string): WorkbookSheet[] { return editWorkbook(sheets, id, { kind: 'sheet' }) }
export function removeWorkbookRow(sheets: readonly WorkbookSheet[], id: string, index: number): WorkbookSheet[] { return editWorkbook(sheets, id, { kind: 'row', index }) }
export function removeWorkbookColumn(sheets: readonly WorkbookSheet[], id: string, index: number): WorkbookSheet[] { return editWorkbook(sheets, id, { kind: 'column', index }) }

function removeAxis<T extends SheetGrid>(grid: T, index: number, axis: 'row' | 'column'): T {
  const [result] = editWorkbook([{ ...grid, id: 'sheet-1', name: 'Sheet' }], 'sheet-1', { kind: axis, index })
  return { ...grid, columns: result.columns, rows: result.rows }
}
export function removeSheetRow<T extends SheetGrid>(grid: T, index: number): T { return removeAxis(grid, index, 'row') }
export function removeSheetColumn<T extends SheetGrid>(grid: T, index: number): T { return removeAxis(grid, index, 'column') }
