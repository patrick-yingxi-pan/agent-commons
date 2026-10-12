import type { SheetGrid } from './content.ts'
import { cloneSheetCell, isFormulaCell, sheetCellAddress } from './sheetCell.ts'

export type SheetCalculationError = '#FORMULA!' | '#UNSUPPORTED!' | '#REF!' | '#VALUE!' | '#DIV/0!' | '#NUM!' | '#CYCLE!' | '#LIMIT!'
export type CalculatedCell =
  | { kind: 'literal'; text: string }
  | { kind: 'number'; value: number; text: string }
  | { kind: 'error'; code: SheetCalculationError; text: SheetCalculationError; message: string }

const MESSAGES: Record<SheetCalculationError, string> = {
  '#FORMULA!': 'Check the formula syntax.',
  '#UNSUPPORTED!': 'Use numbers, same-sheet A1 references, arithmetic, and SUM only.',
  '#REF!': 'A referenced data cell is missing or was deleted.',
  '#VALUE!': 'A referenced text cell is not a number.',
  '#DIV/0!': 'Division by zero is not defined.',
  '#NUM!': 'The result is outside the finite number range.',
  '#CYCLE!': 'This formula depends on itself.',
  '#LIMIT!': 'The formula exceeds the calculation size or depth limit.',
}

const MAX_TOKENS = 256
const MAX_DEPTH = 32
const MAX_DEPENDENCIES = 64
const MAX_RANGE_CELLS = 6_400
const MAX_WORK = 100_000
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u

class CalculationFailure extends Error {
  code: SheetCalculationError
  constructor(code: SheetCalculationError) { super(MESSAGES[code]); this.code = code }
}
function fail(code: SheetCalculationError): never { throw new CalculationFailure(code) }
function errorCell(code: SheetCalculationError): CalculatedCell {
  return { kind: 'error', code, text: code, message: MESSAGES[code] }
}
function finite(value: number): number { return Number.isFinite(value) ? value : fail('#NUM!') }
function display(value: number): string { return Number(value.toPrecision(15)).toString() }

type Token = { text: string; start: number; end: number }
type Reference = { kind: 'ref'; row: number; column: number; start: number; end: number }
type Expression =
  | Reference
  | { kind: 'range'; from: Reference; to: Reference; start: number; end: number }
  | { kind: 'number'; value: number }
  | { kind: 'error' }
  | { kind: 'unary'; operator: string; child: Expression }
  | { kind: 'binary'; operator: string; left: Expression; right: Expression }
  | { kind: 'sum'; args: Expression[] }

/** A tiny closed grammar, not JavaScript or an Excel interpreter. Source spans
 * also let structural edits change references without reprinting user text. */
function parse(source: string): Expression {
  if (source.length > 2_000) fail('#LIMIT!')
  const tokens: Token[] = []
  let offset = /^\s*=/u.exec(source)?.[0].length ?? 0
  while (offset < source.length) {
    if (/\s/u.test(source[offset])) { offset += 1; continue }
    const match = /^(?:#REF!|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+*/(),:\-])/u.exec(source.slice(offset))
    if (!match) fail('#UNSUPPORTED!')
    tokens.push({ text: match[0], start: offset, end: offset + match[0].length })
    if (tokens.length > MAX_TOKENS) fail('#LIMIT!')
    offset += match[0].length
  }
  let cursor = 0
  const take = (text: string) => tokens[cursor]?.text === text ? (cursor += 1, true) : false
  const reference = (token: Token): Reference | undefined => {
    const match = /^([A-Za-z]+)(\d+)$/u.exec(token.text)
    if (!match) return undefined
    let column = 0
    for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
    return { kind: 'ref', column: column - 1, row: Number(match[2]) - 1, start: token.start, end: token.end }
  }
  const expression = (minimum: number, depth: number): Expression => {
    if (depth > MAX_DEPTH) fail('#LIMIT!')
    const token = tokens[cursor++]
    if (!token) fail('#FORMULA!')
    let left: Expression
    if (token.text === '+' || token.text === '-') {
      left = { kind: 'unary', operator: token.text, child: expression(3, depth + 1) }
    } else if (token.text === '(') {
      left = expression(0, depth + 1)
      if (!take(')')) fail('#FORMULA!')
    } else if (NUMBER.test(token.text)) {
      left = { kind: 'number', value: Number(token.text) }
    } else if (token.text === '#REF!') {
      left = { kind: 'error' }
    } else if (token.text.toUpperCase() === 'SUM') {
      if (!take('(')) fail('#FORMULA!')
      const args: Expression[] = []
      if (!take(')')) {
        do { args.push(expression(0, depth + 1)) } while (take(','))
        if (!take(')')) fail('#FORMULA!')
      }
      left = { kind: 'sum', args }
    } else {
      const ref = reference(token)
      if (!ref) fail(/^[A-Za-z_]/u.test(token.text) ? '#UNSUPPORTED!' : '#FORMULA!')
      left = ref
      if (take(':')) {
        const end = tokens[cursor++]
        const to = end && reference(end)
        if (!to) fail('#FORMULA!')
        left = { kind: 'range', from: ref, to, start: ref.start, end: to.end }
      }
    }
    while (cursor < tokens.length) {
      const operator = tokens[cursor].text
      const precedence = operator === '+' || operator === '-' ? 1 : operator === '*' || operator === '/' ? 2 : 0
      if (!precedence || precedence < minimum) break
      cursor += 1
      left = { kind: 'binary', operator, left, right: expression(precedence + 1, depth + 1) }
    }
    return left
  }
  const result = expression(0, 0)
  if (cursor !== tokens.length) fail('#FORMULA!')
  return result
}

/** Calculates a detached projection. Success memo entries carry dependency
 * height so a cached result cannot bypass the 64-formula path limit. Errors
 * are not memoized across roots: a depth-limited traversal grants no result to
 * a shallower root. A whole-sheet work overflow fails all formulas together,
 * never publishes a partially calculated grid. Literal text is unchanged. */
export function calculateSheet(grid: SheetGrid): CalculatedCell[][] {
  const parsed = new Map<string, Expression | SheetCalculationError>()
  const memo = new Map<number, { value: number; height: number }>()
  const active = new Set<number>()
  const width = grid.columns.length
  let work = 0
  let exhausted = false
  const tick = () => { if (++work > MAX_WORK) { exhausted = true; fail('#LIMIT!') } }
  const inBounds = (ref: Pick<Reference, 'row' | 'column'>) => Number.isSafeInteger(ref.row) && Number.isSafeInteger(ref.column) &&
    ref.row >= 0 && ref.row < grid.rows.length && ref.column >= 0 && ref.column < width
  const valueAt = (row: number, column: number, depth: number): { value: number; height: number } => {
    tick()
    if (!inBounds({ row, column })) fail('#REF!')
    const cell = grid.rows[row][column]
    if (!isFormulaCell(cell)) {
      const text = cell.trim()
      if (!text) return { value: 0, height: 0 }
      const unsigned = /^[+-]/u.test(text) ? text.slice(1) : text
      if (!NUMBER.test(unsigned)) fail('#VALUE!')
      return { value: finite(Number(text)), height: 0 }
    }
    if (depth >= MAX_DEPENDENCIES) fail('#LIMIT!')
    const key = row * width + column
    const saved = memo.get(key)
    if (saved) {
      if (depth + saved.height > MAX_DEPENDENCIES) fail('#LIMIT!')
      return saved
    }
    if (active.has(key)) fail('#CYCLE!')
    let tree = parsed.get(cell.formula)
    if (tree === undefined) {
      try { tree = parse(cell.formula) } catch (error) {
        if (!(error instanceof CalculationFailure)) throw error
        tree = error.code
      }
      parsed.set(cell.formula, tree)
    }
    if (typeof tree === 'string') fail(tree)
    active.add(key)
    let height = 1
    const read = (ref: Pick<Reference, 'row' | 'column'>): number => {
      const result = valueAt(ref.row, ref.column, depth + 1)
      height = Math.max(height, result.height + 1)
      return result.value
    }
    const evaluate = (node: Expression, nesting = 0): number => {
      tick()
      if (nesting > MAX_DEPTH) fail('#LIMIT!')
      if (node.kind === 'number') return finite(node.value)
      if (node.kind === 'error') fail('#REF!')
      if (node.kind === 'ref') return read(node)
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
        const top = Math.min(arg.from.row, arg.to.row), bottom = Math.max(arg.from.row, arg.to.row)
        const start = Math.min(arg.from.column, arg.to.column), end = Math.max(arg.from.column, arg.to.column)
        if ((bottom - top + 1) * (end - start + 1) > MAX_RANGE_CELLS) fail('#LIMIT!')
        if (!inBounds(arg.from) || !inBounds(arg.to)) fail('#REF!')
        for (let row = top; row <= bottom; row += 1) {
          for (let column = start; column <= end; column += 1) total = finite(total + read({ row, column }))
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
  const result = grid.rows.map((row, rowIndex) => row.map((cell, column): CalculatedCell => {
    if (!isFormulaCell(cell)) return { kind: 'literal', text: cell }
    if (exhausted) return errorCell('#LIMIT!')
    try {
      const { value } = valueAt(rowIndex, column, 0)
      return { kind: 'number', value, text: display(value) }
    } catch (error) {
      if (!(error instanceof CalculationFailure)) throw error
      return errorCell(error.code)
    }
  }))
  return exhausted ? result.map((row, r) => row.map((cell, c) => isFormulaCell(grid.rows[r][c]) ? errorCell('#LIMIT!') : cell)) : result
}

function removeAxis<T extends SheetGrid>(grid: T, index: number, axis: 'row' | 'column'): T {
  const length = axis === 'row' ? grid.rows.length : grid.columns.length
  if (!Number.isInteger(index) || index < 0 || index >= length || length <= 1) return {
    ...grid, columns: [...grid.columns], rows: grid.rows.map((row) => row.map(cloneSheetCell)),
  }
  const rewrite = (source: string): string => {
    let tree: Expression
    try { tree = parse(source) } catch { return source }
    const replacements: { start: number; end: number; text: string }[] = []
    const address = (ref: Reference, value: number) => sheetCellAddress(axis === 'row' ? value : ref.row, axis === 'column' ? value : ref.column)
    const valid = (ref: Reference) => ref.row >= 0 && ref.row < grid.rows.length && ref.column >= 0 && ref.column < grid.columns.length
    const walk = (node: Expression) => {
      if (node.kind === 'ref') {
        const value = node[axis]
        if (!valid(node) || value === index) replacements.push({ ...node, text: '#REF!' })
        else if (value > index) replacements.push({ ...node, text: address(node, value - 1) })
      } else if (node.kind === 'range') {
        const a = node.from[axis], b = node.to[axis]
        if (!valid(node.from) || !valid(node.to) || (a === index && b === index)) {
          replacements.push({ ...node, text: '#REF!' })
        } else {
          const adjust = (value: number, other: number) => value > index ? value - 1 : value === index && other < index ? value - 1 : value
          const nextA = adjust(a, b), nextB = adjust(b, a)
          if (nextA !== a) replacements.push({ ...node.from, text: address(node.from, nextA) })
          if (nextB !== b) replacements.push({ ...node.to, text: address(node.to, nextB) })
        }
      } else if (node.kind === 'unary') walk(node.child)
      else if (node.kind === 'binary') { walk(node.left); walk(node.right) }
      else if (node.kind === 'sum') node.args.forEach(walk)
    }
    walk(tree)
    let result = source
    for (const change of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.text + result.slice(change.end)
    return result
  }
  return {
    ...grid,
    columns: grid.columns.filter((_, column) => axis !== 'column' || column !== index),
    rows: grid.rows.filter((_, row) => axis !== 'row' || row !== index).map((row) => row
      .filter((_, column) => axis !== 'column' || column !== index)
      .map((cell) => isFormulaCell(cell) ? { formula: rewrite(cell.formula) } : cell)),
  }
}

/** Remove data coordinates without silently reassigning surviving references.
 * Ranges shrink; deleted direct references become explicit #REF! tokens. */
export function removeSheetRow<T extends SheetGrid>(grid: T, index: number): T { return removeAxis(grid, index, 'row') }
export function removeSheetColumn<T extends SheetGrid>(grid: T, index: number): T { return removeAxis(grid, index, 'column') }
