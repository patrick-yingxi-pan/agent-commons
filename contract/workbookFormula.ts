import type { WorkbookSheet } from './content.ts'
import { foldWorksheetName } from './workbook.ts'

export type SheetCalculationError = '#FORMULA!' | '#UNSUPPORTED!' | '#REF!' | '#VALUE!' | '#DIV/0!' | '#NUM!' | '#CYCLE!' | '#LIMIT!'
export const FORMULA_MESSAGES: Record<SheetCalculationError, string> = {
  '#FORMULA!': 'Check the formula syntax.',
  '#UNSUPPORTED!': 'Use numbers, workbook A1 references, arithmetic, and SUM only.',
  '#REF!': 'A referenced worksheet or data cell is missing or was deleted.',
  '#VALUE!': 'A referenced text cell is not a number.',
  '#DIV/0!': 'Division by zero is not defined.',
  '#NUM!': 'The result is outside the finite number range.',
  '#CYCLE!': 'This formula depends on itself.',
  '#LIMIT!': 'The formula exceeds the calculation size or depth limit.',
}
export const MAX_FORMULA_DEPTH = 32
export const FORMULA_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u
export class CalculationFailure extends Error {
  code: SheetCalculationError
  constructor(code: SheetCalculationError) { super(FORMULA_MESSAGES[code]); this.code = code }
}
export function failFormula(code: SheetCalculationError): never { throw new CalculationFailure(code) }

type Span = { start: number; end: number }
type Token = Span & { text: string }
export type WorksheetQualifier = Span & { name: string }
export type FormulaReference = Span & {
  kind: 'ref'; row: number; column: number; addressStart: number; sheet?: WorksheetQualifier
}
export type FormulaExpression =
  | FormulaReference
  | (Span & { kind: 'range'; from: FormulaReference; to: FormulaReference })
  | { kind: 'number'; value: number }
  | { kind: 'error' }
  | { kind: 'unary'; operator: string; child: FormulaExpression }
  | { kind: 'binary'; operator: string; left: FormulaExpression; right: FormulaExpression }
  | { kind: 'sum'; args: FormulaExpression[] }

/** Closed grammar, never JavaScript or an Excel interpreter. Qualifiers name
 * only sheets in this workbook; quoted tokens decode doubled apostrophes.
 * Source spans let edits preserve every byte outside changed references. */
export function parseWorkbookFormula(source: string, qualified = true): FormulaExpression {
  if (source.length > 2_000) failFormula('#LIMIT!')
  const tokens: Token[] = []
  let offset = /^\s*=/u.exec(source)?.[0].length ?? 0
  while (offset < source.length) {
    if (/\s/u.test(source[offset])) { offset += 1; continue }
    const match = /^(?:#REF!|'(?:[^']|'')*'|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+*/(),:!\-])/u.exec(source.slice(offset))
    if (!match || (!qualified && (match[0] === '!' || match[0].startsWith("'")))) failFormula('#UNSUPPORTED!')
    tokens.push({ text: match[0], start: offset, end: offset + match[0].length })
    if (tokens.length > 256) failFormula('#LIMIT!')
    offset += match[0].length
  }
  let cursor = 0
  const take = (text: string) => tokens[cursor]?.text === text ? (cursor += 1, true) : false
  const reference = (first: Token): FormulaReference | undefined => {
    let token = first
    let sheet: WorksheetQualifier | undefined
    if (take('!')) {
      if (!/^(?:[A-Za-z_][A-Za-z_0-9]*|'(?:[^']|'')*')$/u.test(first.text)) failFormula('#UNSUPPORTED!')
      const name = first.text.startsWith("'") ? first.text.slice(1, -1).replaceAll("''", "'") : first.text
      // Quoting never admits an external workbook or a 3D sheet range.
      if (/[\[\]:]/u.test(name)) failFormula('#UNSUPPORTED!')
      sheet = { name, start: first.start, end: first.end }
      token = tokens[cursor++]
      if (!token) failFormula('#FORMULA!')
    }
    const match = /^([A-Za-z]+)(\d+)$/u.exec(token.text)
    if (!match) return undefined
    let column = 0
    for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
    return { kind: 'ref', column: column - 1, row: Number(match[2]) - 1, start: first.start, end: token.end, addressStart: token.start, ...(sheet ? { sheet } : {}) }
  }
  const expression = (minimum: number, depth: number): FormulaExpression => {
    if (depth > MAX_FORMULA_DEPTH) failFormula('#LIMIT!')
    const token = tokens[cursor++]
    if (!token) failFormula('#FORMULA!')
    let left: FormulaExpression
    if (token.text === '+' || token.text === '-') {
      left = { kind: 'unary', operator: token.text, child: expression(3, depth + 1) }
    } else if (token.text === '(') {
      left = expression(0, depth + 1)
      if (!take(')')) failFormula('#FORMULA!')
    } else if ((token.text === '#REF!' || FORMULA_NUMBER.test(token.text)) && tokens[cursor]?.text !== '!') {
      left = token.text === '#REF!' ? { kind: 'error' } : { kind: 'number', value: Number(token.text) }
    } else if (token.text.toUpperCase() === 'SUM' && tokens[cursor]?.text !== '!') {
      if (!take('(')) failFormula('#FORMULA!')
      const args: FormulaExpression[] = []
      if (!take(')')) {
        do { args.push(expression(0, depth + 1)) } while (take(','))
        if (!take(')')) failFormula('#FORMULA!')
      }
      left = { kind: 'sum', args }
    } else {
      const ref = reference(token)
      if (!ref) failFormula(/^[A-Za-z_']/u.test(token.text) ? '#UNSUPPORTED!' : '#FORMULA!')
      left = ref
      if (take(':')) {
        const end = tokens[cursor++]
        const to = end && reference(end)
        if (!to) failFormula('#FORMULA!')
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
  if (cursor !== tokens.length) failFormula('#FORMULA!')
  const validateRanges = (node: FormulaExpression, sumArgument = false): void => {
    if (node.kind === 'range') {
      if (!sumArgument) failFormula('#FORMULA!')
      return
    }
    if (node.kind === 'sum') {
      for (const arg of node.args) validateRanges(arg, arg.kind === 'range')
    } else if (node.kind === 'unary') validateRanges(node.child)
    else if (node.kind === 'binary') {
      validateRanges(node.left)
      validateRanges(node.right)
    }
  }
  validateRanges(result)
  return result
}
/** Duplicate names never choose a winner, including callers outside admission. */
export function workbookReferenceResolver(sheets: readonly WorkbookSheet[]) {
  const names = new Map<string, number>()
  sheets.forEach((sheet, index) => {
    const key = foldWorksheetName(sheet.name)
    names.set(key, names.has(key) ? -1 : index)
  })
  return (ref: Pick<FormulaReference, 'sheet'>, current: number): number => ref.sheet ? names.get(foldWorksheetName(ref.sheet.name)) ?? -1 : current
}

export function referenceInBounds(sheets: readonly WorkbookSheet[], sheet: number, ref: Pick<FormulaReference, 'row' | 'column'>): boolean {
  const grid = sheets[sheet]
  return !!grid && Number.isSafeInteger(ref.row) && Number.isSafeInteger(ref.column) &&
    ref.row >= 0 && ref.row < grid.rows.length && ref.column >= 0 && ref.column < grid.columns.length
}
