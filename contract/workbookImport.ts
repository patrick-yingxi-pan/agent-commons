import {
  isXlsxImportOutcome,
  MAX_XLSX_CELLS,
  MAX_XLSX_SHEETS,
  MAX_XLSX_TEXT_BYTES,
  type XlsxImportOutcome,
} from './xlsxImport.mjs'

export interface WorkbookSnapshot {
  totalSheets: number
  hiddenSheets: number
  unsupportedSheets: number
  worksheets: Array<{
    sourceSheet: number
    name: string
    cells: Array<{ row: number; column: number; value: string; formula?: 'cached' | 'missing' }>
  }>
}

export interface WorkbookImportResult {
  documentImport: XlsxImportOutcome
  workbook?: WorkbookSnapshot
}

const MAX_EXCEL_ROWS = 1_048_576
const MAX_EXCEL_COLUMNS = 16_384
const encoder = new TextEncoder()
// This validates a string round trip, not a file stream: an initial BOM is data.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.includes(key))
}

function validText(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const encoded = encoder.encode(value)
    return encoded.byteLength <= MAX_XLSX_TEXT_BYTES && decoder.decode(encoded) === value
  } catch {
    return false
  }
}

function validWorksheetName(name: unknown): name is string {
  return typeof name === 'string' && name.length >= 1 && name.length <= 31 &&
    name.trim().length > 0 && !/[\\/:?*\[\]\u0000-\u001f]/u.test(name) &&
    !name.startsWith("'") && !name.endsWith("'") && validText(name)
}

export function parseWorkbookSnapshot(value: unknown): WorkbookSnapshot | undefined {
  if (!record(value) || !hasOnlyKeys(value, ['totalSheets', 'hiddenSheets', 'unsupportedSheets', 'worksheets'])) return undefined
  const totalSheets = typeof value.totalSheets === 'number' ? value.totalSheets : NaN
  const hiddenSheets = typeof value.hiddenSheets === 'number' ? value.hiddenSheets : NaN
  const unsupportedSheets = typeof value.unsupportedSheets === 'number' ? value.unsupportedSheets : NaN
  if (!Number.isSafeInteger(totalSheets) || totalSheets < 1 || totalSheets > MAX_XLSX_SHEETS ||
      !Number.isSafeInteger(hiddenSheets) || hiddenSheets < 0 ||
      !Number.isSafeInteger(unsupportedSheets) || unsupportedSheets < 0 ||
      hiddenSheets + unsupportedSheets > totalSheets || !Array.isArray(value.worksheets) ||
      value.worksheets.length !== totalSheets - hiddenSheets - unsupportedSheets) return undefined

  const worksheets: WorkbookSnapshot['worksheets'] = []
  const seenSources = new Set<number>()
  const seenNames = new Set<string>()
  const textBytes = { value: 0 }
  let cellCount = 0
  const addText = (text: string): boolean => {
    const size = encoder.encode(text).byteLength
    textBytes.value += size
    return textBytes.value <= MAX_XLSX_TEXT_BYTES
  }

  let previousSource = 0
  for (const rawSheet of value.worksheets) {
    if (!record(rawSheet) || !hasOnlyKeys(rawSheet, ['sourceSheet', 'name', 'cells'])) return undefined
    const sourceSheet = typeof rawSheet.sourceSheet === 'number' ? rawSheet.sourceSheet : NaN
    if (!Number.isSafeInteger(sourceSheet) || sourceSheet < 1 || sourceSheet > totalSheets ||
        sourceSheet <= previousSource || seenSources.has(sourceSheet) || !validWorksheetName(rawSheet.name) ||
        !Array.isArray(rawSheet.cells)) return undefined
    const foldedName = rawSheet.name.toLowerCase()
    if (seenNames.has(foldedName) || !addText(rawSheet.name)) return undefined
    previousSource = sourceSheet
    seenSources.add(sourceSheet)
    seenNames.add(foldedName)

    const cells: WorkbookSnapshot['worksheets'][number]['cells'] = []
    let previousRow = 0
    let previousColumn = 0
    for (const rawCell of rawSheet.cells) {
      if (!record(rawCell) || !hasOnlyKeys(rawCell, ['row', 'column', 'value', 'formula'])) return undefined
      const row = typeof rawCell.row === 'number' ? rawCell.row : NaN
      const column = typeof rawCell.column === 'number' ? rawCell.column : NaN
      if (!Number.isSafeInteger(row) || row < 1 || row > MAX_EXCEL_ROWS ||
          !Number.isSafeInteger(column) || column < 1 || column > MAX_EXCEL_COLUMNS ||
          typeof rawCell.value !== 'string' || !validText(rawCell.value) ||
          (Object.hasOwn(rawCell, 'formula') && rawCell.formula !== 'cached' && rawCell.formula !== 'missing') ||
          (rawCell.formula === 'missing' && rawCell.value !== '') ||
          (row < previousRow || (row === previousRow && column <= previousColumn))) return undefined
      if (++cellCount > MAX_XLSX_CELLS || !addText(rawCell.value)) return undefined
      previousRow = row
      previousColumn = column
      cells.push({
        row,
        column,
        value: rawCell.value,
        ...(!Object.hasOwn(rawCell, 'formula') ? {} : { formula: rawCell.formula as 'cached' | 'missing' }),
      })
    }
    worksheets.push({ sourceSheet, name: rawSheet.name, cells })
  }

  return { totalSheets, hiddenSheets, unsupportedSheets, worksheets }
}

function invalidWorkbookResult(): WorkbookImportResult {
  return { documentImport: { format: 'xlsx', status: 'invalid' } }
}

export function parseWorkbookImportResult(value: unknown): WorkbookImportResult {
  if (!record(value) || !hasOnlyKeys(value, ['documentImport', 'workbook']) ||
      !record(value.documentImport) || !hasOnlyKeys(value.documentImport, ['format', 'status']) ||
      Reflect.ownKeys(value.documentImport).length !== 2 || !isXlsxImportOutcome(value.documentImport)) return invalidWorkbookResult()
  if (value.documentImport.status === 'ready') {
    const workbook = parseWorkbookSnapshot(value.workbook)
    if (!workbook || workbook.worksheets.length === 0) return invalidWorkbookResult()
    return { documentImport: { format: 'xlsx', status: 'ready' }, workbook }
  }
  if (Reflect.ownKeys(value).includes('workbook')) return invalidWorkbookResult()
  return { documentImport: { format: 'xlsx', status: value.documentImport.status } }
}
