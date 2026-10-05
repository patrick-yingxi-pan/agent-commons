import type { ArtifactContent, SheetGrid, WorkbookSheet } from './content.ts'

export type { SheetGrid, WorkbookSheet } from './content.ts'

export const MAX_AUTHORED_SHEET_COLUMNS = 32
export const MAX_AUTHORED_SHEET_ROWS = 200
export const MAX_AUTHORED_CELL_CHARS = 2_000
export const MAX_AUTHORED_LABEL_CHARS = 240
export const MAX_AUTHORED_STRUCTURE_CHARS = 20_000
export const MAX_AUTHORED_WORKBOOK_SHEETS = 20
export const MAX_AUTHORED_WORKBOOK_CELLS = 6_400
export const MAX_WORKBOOK_SHEET_NAME_CHARS = 31
export const MAX_WORKBOOK_SHEET_ID_CHARS = 64

type SheetContent = Extract<ArtifactContent, { type: 'sheet' }>
type WorkbookContent = Extract<ArtifactContent, { type: 'workbook' }>

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
}

function textBudget() {
  let characters = 0
  return (text: unknown, limit: number, nonblank = false): text is string => {
    if (typeof text !== 'string' || text.length > limit || (nonblank && !text.trim())) return false
    characters += text.length
    return characters <= MAX_AUTHORED_STRUCTURE_CHARS
  }
}

/** Legacy sheets and workbook tabs use exactly the same grid admission. A
 * workbook shares its text counter across all tabs instead of resetting it. */
function parseGrid(raw: Record<string, unknown>, addText: ReturnType<typeof textBudget>): SheetGrid | undefined {
  if (!Array.isArray(raw.columns) || raw.columns.length < 1 || raw.columns.length > MAX_AUTHORED_SHEET_COLUMNS ||
    !Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > MAX_AUTHORED_SHEET_ROWS) return undefined
  const columns: string[] = []
  for (const column of raw.columns) {
    if (!addText(column, MAX_AUTHORED_LABEL_CHARS, true)) return undefined
    columns.push(column)
  }
  const rows: string[][] = []
  for (const row of raw.rows) {
    if (!Array.isArray(row) || row.length !== columns.length) return undefined
    const copied: string[] = []
    for (const cell of row) {
      if (!addText(cell, MAX_AUTHORED_CELL_CHARS)) return undefined
      copied.push(cell)
    }
    rows.push(copied)
  }
  if (Object.hasOwn(raw, 'note') && !addText(raw.note, MAX_AUTHORED_CELL_CHARS)) return undefined
  return { columns, rows, ...(typeof raw.note === 'string' ? { note: raw.note } : {}) }
}

export function parseAuthoredSheet(value: unknown): Omit<SheetContent, 'revision'> | undefined {
  if (!record(value) || value.type !== 'sheet' || !fields(value, ['type', 'columns', 'rows'], ['note'])) return undefined
  const grid = parseGrid(value, textBudget())
  return grid && { type: 'sheet', ...grid }
}

function validWorksheetNameXmlText(value: string): boolean {
  if (/[\u0000-\u001f\u007f\ufffe\uffff]/u.test(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

/** Strict detached authoring parser. Values stay literal; no revision or other
 * authority-bearing field is accepted, and no caller-owned nested value leaks. */
export function parseAuthoredWorkbook(value: unknown): Omit<WorkbookContent, 'revision'> | undefined {
  if (!record(value) || !fields(value, ['type', 'sheets']) || value.type !== 'workbook' ||
    !Array.isArray(value.sheets) || value.sheets.length < 1 || value.sheets.length > MAX_AUTHORED_WORKBOOK_SHEETS) return undefined

  const sheets: WorkbookSheet[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  let cells = 0
  const addText = textBudget()

  for (const raw of value.sheets) {
    if (!record(raw) || !fields(raw, ['id', 'name', 'columns', 'rows'], ['note']) ||
      typeof raw.id !== 'string' || raw.id.length < 1 || raw.id.length > MAX_WORKBOOK_SHEET_ID_CHARS ||
      !/^[A-Za-z0-9_-]+$/u.test(raw.id) || ids.has(raw.id) ||
      typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > MAX_WORKBOOK_SHEET_NAME_CHARS ||
      !raw.name.trim() || raw.name !== raw.name.trim() || raw.name.startsWith("'") || raw.name.endsWith("'") || /[\[\]:*?/\\]/u.test(raw.name)) return undefined
    if (!validWorksheetNameXmlText(raw.name)) return undefined
    const foldedName = raw.name.toLocaleLowerCase('en-US')
    if (names.has(foldedName)) return undefined
    ids.add(raw.id)
    names.add(foldedName)

    const grid = parseGrid(raw, addText)
    if (!grid) return undefined
    cells += grid.columns.length * grid.rows.length
    if (cells > MAX_AUTHORED_WORKBOOK_CELLS) return undefined
    sheets.push({ id: raw.id, name: raw.name, ...grid })
  }

  return { type: 'workbook', sheets }
}

export function isSpreadsheetContent(body: ArtifactContent): body is SheetContent | WorkbookContent {
  return body.type === 'sheet' || body.type === 'workbook'
}

/** Project a legacy single sheet as the canonical one-tab view without changing
 * or mutating its stored representation. */
export function spreadsheetSheets(body: SheetContent | WorkbookContent): WorkbookSheet[] {
  if (body.type === 'workbook') return body.sheets.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    columns: [...sheet.columns],
    rows: sheet.rows.map((row) => [...row]),
    ...(sheet.note === undefined ? {} : { note: sheet.note }),
  }))
  return [{
    id: 'sheet-1',
    name: 'Sheet',
    columns: [...body.columns],
    rows: body.rows.map((row) => [...row]),
    ...(body.note === undefined ? {} : { note: body.note }),
  }]
}
