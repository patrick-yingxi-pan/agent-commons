import type { SaxesTagNS } from 'saxes'
import type { WorkbookSnapshot } from '../../contract/workbookImport.ts'
import { MAX_XLSX_CELLS, MAX_XLSX_SHARED_STRINGS, MAX_XLSX_SHEETS } from '../../contract/xlsxImport.mjs'
import { OfficeExtractionError, officeAttribute as attr, packagePartName, resolvePackagePartName, parseOfficeXml as parseXml } from './officePackage.ts'

const SHEET = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main'])
const OFFICE = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'])
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'
function invalid(): never { throw new OfficeExtractionError('invalid') }
function bounded(): never { throw new OfficeExtractionError('structure-limit') }
export const workbookMainType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
export const worksheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
export const sharedStringsType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'

interface Relationship { type: string; target: string; external: boolean }
export function workbookRelationships(xml: string, main: string): Map<string, Relationship> {
  const result = new Map<string, Relationship>()
  parseXml(xml, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== PACKAGE || tag.local !== 'Relationships')) invalid()
    if (depth !== 2 || tag.uri !== PACKAGE || tag.local !== 'Relationship') return
    const id = attr(tag, 'Id')
    const type = attr(tag, 'Type')
    const target = attr(tag, 'Target')
    const mode = attr(tag, 'TargetMode') ?? 'Internal'
    if (!id || !type || !target || result.has(id) || !['Internal', 'External'].includes(mode)) invalid()
    result.set(id, { type, target: mode === 'External' ? '' : resolvePackagePartName(main, target), external: mode === 'External' })
  } })
  return result
}
export const relationshipKind = (type: string, kind: string) => [...OFFICE].some((namespace) => type === `${namespace}/${kind}`)

export function workbookSheets(xml: string): Array<{ name: string; relation: string; hidden: boolean }> {
  const sheets: Array<{ name: string; relation: string; hidden: boolean }> = []
  const names = new Set<string>()
  const ids = new Set<string>()
  const relations = new Set<string>()
  let namespace = ''
  let inSheets = false
  let containers = 0
  parseXml(xml, { open(tag, depth) {
    if (depth === 1) { if (!SHEET.has(tag.uri) || tag.local !== 'workbook') invalid(); namespace = tag.uri }
    if (depth === 2 && tag.uri === namespace && tag.local === 'sheets') { if (++containers > 1) invalid(); inSheets = true }
    if (!inSheets || depth !== 3 || tag.uri !== namespace || tag.local !== 'sheet') return
    if (sheets.length >= MAX_XLSX_SHEETS) bounded()
    const encodedName = attr(tag, 'name')
    const name = encodedName === undefined ? undefined : cellString(encodedName)
    const id = attr(tag, 'sheetId')
    const relationAttributes = Object.values(tag.attributes).filter((value) => value.local === 'id' && OFFICE.has(value.uri))
    const relation = relationAttributes[0]?.value
    const state = attr(tag, 'state') ?? 'visible'
    if (!name || name.length > 31 || /[\u0000-\u001f\\/*?:\[\]]/.test(name) || names.has(name.toLowerCase()) ||
        !id || !/^[1-9]\d*$/.test(id) || ids.has(id) || !relation || relationAttributes.length !== 1 || relations.has(relation) ||
        !['visible', 'hidden', 'veryHidden'].includes(state)) invalid()
    names.add(name.toLowerCase()); ids.add(id); relations.add(relation)
    sheets.push({ name, relation, hidden: state !== 'visible' })
  }, close(tag, depth) { if (depth === 2 && tag.uri === namespace && tag.local === 'sheets') inSheets = false } })
  if (containers !== 1) invalid()
  return sheets
}

// SpreadsheetML cell and worksheet-name escapes are decoded once: _x005F_x0041_ denotes literal
// "_x0041_", not "A". JSON-quoted cell text keeps control/tab/newline data distinct
// from the projection's own separators. Never run formulas or resolve links.
const cellString = (value: string) => value.replace(/_x([\da-f]{4})_/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
export function workbookStrings(xml: string): string[] {
  const strings: string[] = []
  const stack: SaxesTagNS[] = []
  let namespace = ''
  let current = ''
  parseXml(xml, {
    open(tag, depth) {
      if (depth === 1) { if (!SHEET.has(tag.uri) || tag.local !== 'sst') invalid(); namespace = tag.uri }
      stack.push(tag)
      if (depth === 2 && tag.uri === namespace && tag.local === 'si') {
        if (strings.length >= MAX_XLSX_SHARED_STRINGS) bounded()
        current = ''
      }
    },
    close(tag, depth) { if (depth === 2 && tag.uri === namespace && tag.local === 'si') strings.push(cellString(current)); stack.pop() },
    text(value) {
      if (stack.at(-1)?.local !== 't' || stack.some((tag) => tag.uri !== namespace)) return
      if (stack.length === 3 && stack[1]?.local === 'si' || stack.length === 4 && stack[1]?.local === 'si' && stack[2]?.local === 'r') current += value
    },
  })
  return strings
}

function integer(value: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value)) invalid()
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number > maximum) invalid()
  return number
}
function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback
  if (!['0', '1', 'false', 'true'].includes(value)) invalid()
  return value === '1' || value === 'true'
}
function zeroDimension(value: string | undefined): boolean {
  if (value === undefined) return false
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) invalid()
  return Number(value) === 0
}
function columnName(number: number): string {
  let name = ''
  while (number) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26) }
  return name
}

interface Cell { column: number; address: string; type: string; value: string; inline: string; formula: boolean; values: number; inlines: number }
/** Sparse cell-address lines preserve exact coordinates without allocating a
 * million-row rectangle. Hidden sheet/row/column values never enter the output. */
export function worksheetValues(xml: string, strings: readonly string[], budget: { cells: number }, emit: (address: string, value: string, literal: WorkbookSnapshot['worksheets'][number]['cells'][number]) => void): void {
  const stack: SaxesTagNS[] = []
  const columns: Array<{ first: number; last: number; hidden: boolean }> = []
  let namespace = ''
  let dataBlocks = 0
  let previousRow = 0
  let row = 0
  let previousColumn = 0
  let rowHidden = false
  let defaultHidden = false
  let cell: Cell | undefined
  const path = (...names: string[]) => stack.length === names.length && stack.every((tag, index) => tag.uri === namespace && tag.local === names[index])
  const rendered = (item: Cell): { text: string; literal: string; formula?: 'cached' | 'missing' } | undefined => {
    let value: string | undefined
    let literal: string | undefined
    if (item.type === 'inlineStr') {
      if (item.values || item.formula || item.inlines !== 1) invalid()
      literal = cellString(item.inline)
      if (item.inline) value = JSON.stringify(literal)
    } else if (item.inlines) invalid()
    else if (item.value !== '' || item.type === 'str' && item.values === 1) {
      switch (item.type) {
        case 's': {
          if (!/^(0|[1-9]\d*)$/.test(item.value)) invalid()
          const index = Number(item.value)
          if (!Number.isSafeInteger(index) || index >= strings.length) invalid()
          literal = strings[index]!
          if (literal) value = JSON.stringify(literal)
          break
        }
        case 'b': if (!['0', '1'].includes(item.value)) invalid(); literal = value = item.value === '1' ? 'TRUE' : 'FALSE'; break
        case 'n': if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(item.value) || !Number.isFinite(Number(item.value))) invalid(); literal = value = item.value; break
        case 'str': literal = cellString(item.value); value = JSON.stringify(literal); break
        case 'd': literal = item.value; value = `${JSON.stringify(literal)} [stored date]`; break
        case 'e': literal = item.value; value = `${JSON.stringify(literal)} [cell error]`; break
      }
    }
    if (item.formula) return literal === undefined
      ? { text: '[formula value not saved]', literal: '', formula: 'missing' }
      : { text: `${value ?? JSON.stringify(literal)} [cached formula value]`, literal, formula: 'cached' }
    return value === undefined ? undefined : { text: value, literal: literal! }
  }
  parseXml(xml, {
    open(tag, depth) {
      if (depth === 1) { if (!SHEET.has(tag.uri) || tag.local !== 'worksheet') invalid(); namespace = tag.uri }
      stack.push(tag)
      if (path('worksheet', 'sheetFormatPr')) {
        if (dataBlocks) invalid()
        defaultHidden = bool(attr(tag, 'zeroHeight'))
      }
      if (path('worksheet', 'cols', 'col')) {
        if (dataBlocks) invalid()
        const first = integer(attr(tag, 'min') ?? '', 16_384), last = integer(attr(tag, 'max') ?? '', 16_384)
        if (first > last || columns.some((range) => first <= range.last && last >= range.first)) invalid()
        columns.push({ first, last, hidden: bool(attr(tag, 'hidden')) || zeroDimension(attr(tag, 'width')) })
      }
      if (path('worksheet', 'sheetData') && ++dataBlocks !== 1) invalid()
      if (path('worksheet', 'sheetData', 'row')) {
        row = integer(attr(tag, 'r') ?? String(previousRow + 1), 1_048_576)
        if (row <= previousRow) invalid()
        previousRow = row; previousColumn = 0
        rowHidden = bool(attr(tag, 'hidden'), defaultHidden) || zeroDimension(attr(tag, 'ht'))
      }
      if (path('worksheet', 'sheetData', 'row', 'c')) {
        if (++budget.cells > MAX_XLSX_CELLS) bounded()
        const ref = attr(tag, 'r') ?? `${columnName(previousColumn + 1)}${row}`
        const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref)
        if (!match || integer(match[2]!, 1_048_576) !== row) invalid()
        let column = 0
        for (const char of match[1]!) column = column * 26 + char.charCodeAt(0) - 64
        if (column > 16_384 || column <= previousColumn) invalid()
        previousColumn = column
        const type = attr(tag, 't') ?? 'n'
        if (!['n', 's', 'b', 'str', 'inlineStr', 'e', 'd'].includes(type)) throw new OfficeExtractionError('unsupported')
        cell = { column, address: ref, type, value: '', inline: '', formula: false, values: 0, inlines: 0 }
      }
      if (!cell) return
      if (path('worksheet', 'sheetData', 'row', 'c', 'f')) { if (cell.formula) invalid(); cell.formula = true }
      if (path('worksheet', 'sheetData', 'row', 'c', 'v') && ++cell.values > 1) invalid()
      if (path('worksheet', 'sheetData', 'row', 'c', 'is') && ++cell.inlines > 1) invalid()
    },
    text(value) {
      if (!cell) return
      if (path('worksheet', 'sheetData', 'row', 'c', 'v')) cell.value += value
      if (path('worksheet', 'sheetData', 'row', 'c', 'is', 't') || path('worksheet', 'sheetData', 'row', 'c', 'is', 'r', 't')) cell.inline += value
    },
    close() {
      if (cell && path('worksheet', 'sheetData', 'row', 'c')) {
        const value = rendered(cell)
        if (value !== undefined && !rowHidden && !columns.some((range) => range.hidden && cell!.column >= range.first && cell!.column <= range.last)) {
          emit(cell.address, value.text, { row, column: cell.column, value: value.literal, ...(value.formula ? { formula: value.formula } : {}) })
        }
        cell = undefined
      }
      stack.pop()
    },
  })
  if (dataBlocks !== 1) invalid()
}
