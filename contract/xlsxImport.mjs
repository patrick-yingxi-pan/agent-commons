/** Read-only workbook values. Package bytes, paths, styles and executable
 * content never enter product state; formula values are cached, not evaluated. */
export const MAX_XLSX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_XLSX_SELECTION_BYTES = 24 * 1024 * 1024
export const MAX_XLSX_TEXT_BYTES = 64 * 1024
export const MAX_XLSX_ENTRIES = 512
export const MAX_XLSX_PART_BYTES = 4 * 1024 * 1024
export const MAX_XLSX_EXPANDED_BYTES = 16 * 1024 * 1024
export const MAX_XLSX_SHEETS = 32
export const MAX_XLSX_CELLS = 10_000
export const MAX_XLSX_SHARED_STRINGS = 10_000
export const XLSX_IMPORT_TIMEOUT_MS = 15_000

export const isXlsxFileName = (name) => typeof name === 'string' && /\.xlsx$/i.test(name)
export const xlsxImportFailure = (status) => ({ documentImport: { format: 'xlsx', status } })
const statuses = ['ready', 'no-text', 'file-too-large', 'selection-limit', 'text-limit', 'structure-limit', 'unsupported', 'timeout', 'invalid', 'unavailable']
export function isXlsxImportOutcome(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 2 && Object.hasOwn(value, 'format') && Object.hasOwn(value, 'status') &&
    value.format === 'xlsx' && statuses.includes(value.status)
}
export function xlsxImportCopy(outcome) {
  if (!outcome || outcome.format !== 'xlsx') return ''
  switch (outcome.status) {
    case 'ready': return 'Stored cell values from visible sheets, rows and columns. Formula results are cached and may be out of date; formulas are not calculated. Dates and formatted numbers may appear as raw values. Charts, images, comments and hidden content are not included.'
    case 'no-text': return 'No readable values were found in visible worksheet cells. Export the needed cells as CSV and reattach.'
    case 'file-too-large': return 'Workbook not imported. Choose an .xlsx file up to 8 MB.'
    case 'selection-limit': return 'Workbook not imported. Choose up to 24 MB of documents at a time.'
    case 'text-limit': return 'Workbook not imported. Extracted values exceed 64 KB; split the workbook or export the needed cells as CSV. No partial text was saved.'
    case 'structure-limit': return 'Workbook not imported. Its expanded content, sheets or cells exceed the import limits. Export the needed cells as CSV.'
    case 'unsupported': return 'Workbook not imported. Save an unlocked .xlsx copy or export CSV; legacy and macro-enabled workbooks are not supported.'
    case 'timeout': return 'Workbook import took too long. Try a smaller workbook or export CSV.'
    case 'invalid': return 'Workbook not imported. It could not be read reliably; save a new .xlsx copy or export CSV.'
    default: return 'Workbook import is unavailable. Try again or export CSV.'
  }
}
