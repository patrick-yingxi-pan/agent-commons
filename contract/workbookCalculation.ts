import type { SheetGrid, WorkbookSheet } from './content.ts'
import { isFormulaCell } from './sheetCell.ts'
import {
  CalculationFailure, failFormula as fail, FORMULA_MESSAGES, FORMULA_NUMBER,
  MAX_FORMULA_DEPTH, parseWorkbookFormula, referenceInBounds, workbookReferenceResolver,
  type FormulaExpression, type FormulaReference, type SheetCalculationError,
} from './workbookFormula.ts'
export type { SheetCalculationError } from './workbookFormula.ts'
export { renameWorkbookSheet, removeWorkbookSheet, removeWorkbookRow, removeWorkbookColumn, removeSheetRow, removeSheetColumn } from './workbookStructure.ts'

export type CalculatedCell =
  | { kind: 'literal'; text: string }
  | { kind: 'number'; value: number; text: string }
  | { kind: 'error'; code: SheetCalculationError; text: SheetCalculationError; message: string }

function errorCell(code: SheetCalculationError): CalculatedCell {
  return { kind: 'error', code, text: code, message: FORMULA_MESSAGES[code] }
}
function finite(value: number): number { return Number.isFinite(value) ? value : fail('#NUM!') }
function display(value: number): string { return Number(value.toPrecision(15)).toString() }

/** Single-sheet compatibility has no named-sheet namespace. */
export function calculateSheet(grid: SheetGrid): CalculatedCell[][] {
  return calculate([{ ...grid, id: 'sheet-1', name: 'Sheet' }], false)[0].rows
}

/** Detached projection; dependency height and work are bounded across the whole
 * workbook. Errors are not memoized between roots: a depth-limited traversal
 * grants no result to a shallower root. Work overflow fails every formula,
 * never returns partially calculated tabs. Literal text stays unchanged. */
export function calculateWorkbook(sheets: readonly WorkbookSheet[]): Array<{ id: string; rows: CalculatedCell[][] }> {
  return calculate(sheets, true)
}

function calculate(sheets: readonly WorkbookSheet[], qualified: boolean): Array<{ id: string; rows: CalculatedCell[][] }> {
  const parsed = new Map<string, FormulaExpression | SheetCalculationError>()
  const memo = new Map<string, { value: number; height: number }>()
  const active = new Set<string>()
  const resolve = workbookReferenceResolver(sheets)
  let work = 0
  let exhausted = false
  const tick = () => { if (++work > 100_000) { exhausted = true; fail('#LIMIT!') } }
  const valueAt = (sheet: number, row: number, column: number, depth: number): { value: number; height: number } => {
    tick()
    if (!referenceInBounds(sheets, sheet, { row, column })) fail('#REF!')
    const cell = sheets[sheet].rows[row][column]
    if (!isFormulaCell(cell)) {
      const text = cell.trim()
      if (!text) return { value: 0, height: 0 }
      const unsigned = /^[+-]/u.test(text) ? text.slice(1) : text
      if (!FORMULA_NUMBER.test(unsigned)) fail('#VALUE!')
      return { value: finite(Number(text)), height: 0 }
    }
    if (depth >= 64) fail('#LIMIT!')
    const key = `${sheet}:${row}:${column}`
    const saved = memo.get(key)
    if (saved) {
      if (depth + saved.height > 64) fail('#LIMIT!')
      return saved
    }
    if (active.has(key)) fail('#CYCLE!')
    let tree = parsed.get(cell.formula)
    if (tree === undefined) {
      try { tree = parseWorkbookFormula(cell.formula, qualified) } catch (error) {
        if (!(error instanceof CalculationFailure)) throw error
        tree = error.code
      }
      parsed.set(cell.formula, tree)
    }
    if (typeof tree === 'string') fail(tree)
    active.add(key)
    let height = 1
    const read = (target: number, ref: Pick<FormulaReference, 'row' | 'column'>): number => {
      const result = valueAt(target, ref.row, ref.column, depth + 1)
      height = Math.max(height, result.height + 1)
      return result.value
    }
    const evaluate = (node: FormulaExpression, nesting = 0): number => {
      tick()
      if (nesting > MAX_FORMULA_DEPTH) fail('#LIMIT!')
      if (node.kind === 'number') return finite(node.value)
      if (node.kind === 'error') fail('#REF!')
      if (node.kind === 'ref') return read(resolve(node, sheet), node)
      if (node.kind === 'range') fail('#FORMULA!')
      if (node.kind === 'unary') return finite((node.operator === '-' ? -1 : 1) * evaluate(node.child, nesting + 1))
      if (node.kind === 'binary') {
        const left = evaluate(node.left, nesting + 1)
        const right = evaluate(node.right, nesting + 1)
        if (node.operator === '/' && right === 0) fail('#DIV/0!')
        return finite(node.operator === '+' ? left + right : node.operator === '-' ? left - right : node.operator === '*' ? left * right : left / right)
      }
      let total = 0
      for (const arg of node.args) {
        if (arg.kind !== 'range') { total = finite(total + evaluate(arg, nesting + 1)); continue }
        const target = resolve(arg.from, sheet)
        const endTarget = resolve(arg.to, target)
        if (target < 0 || endTarget < 0) fail('#REF!')
        if (target !== endTarget) fail('#UNSUPPORTED!')
        const top = Math.min(arg.from.row, arg.to.row), bottom = Math.max(arg.from.row, arg.to.row)
        const start = Math.min(arg.from.column, arg.to.column), end = Math.max(arg.from.column, arg.to.column)
        if ((bottom - top + 1) * (end - start + 1) > 6_400) fail('#LIMIT!')
        if (!referenceInBounds(sheets, target, arg.from) || !referenceInBounds(sheets, target, arg.to)) fail('#REF!')
        for (let row = top; row <= bottom; row += 1) {
          for (let column = start; column <= end; column += 1) total = finite(total + read(target, { row, column }))
        }
      }
      return total
    }
    try {
      const result = { value: evaluate(tree), height }
      memo.set(key, result)
      return result
    } finally { active.delete(key) }
  }
  const result = sheets.map((grid, sheet) => ({ id: grid.id, rows: grid.rows.map((row, rowIndex) => row.map((cell, column): CalculatedCell => {
    if (!isFormulaCell(cell)) return { kind: 'literal', text: cell }
    if (exhausted) return errorCell('#LIMIT!')
    try {
      const { value } = valueAt(sheet, rowIndex, column, 0)
      return { kind: 'number', value, text: display(value) }
    } catch (error) {
      if (!(error instanceof CalculationFailure)) throw error
      return errorCell(error.code)
    }
  })) }))
  return exhausted ? result.map((sheet, index) => ({ ...sheet, rows: sheet.rows.map((row, r) => row.map((cell, c) =>
    isFormulaCell(sheets[index].rows[r][c]) ? errorCell('#LIMIT!') : cell)) })) : result
}
