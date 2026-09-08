export const MAX_XLSX_FILE_BYTES: number
export const MAX_XLSX_SELECTION_BYTES: number
export const MAX_XLSX_TEXT_BYTES: number
export const MAX_XLSX_ENTRIES: number
export const MAX_XLSX_PART_BYTES: number
export const MAX_XLSX_EXPANDED_BYTES: number
export const MAX_XLSX_SHEETS: number
export const MAX_XLSX_CELLS: number
export const MAX_XLSX_SHARED_STRINGS: number
export const XLSX_IMPORT_TIMEOUT_MS: number
export type XlsxImportStatus = 'ready' | 'no-text' | 'file-too-large' | 'selection-limit' | 'text-limit' | 'structure-limit' | 'unsupported' | 'timeout' | 'invalid' | 'unavailable'
export interface XlsxImportOutcome { format: 'xlsx'; status: XlsxImportStatus }
export interface XlsxImportResult { text?: string; documentImport: XlsxImportOutcome }
export function isXlsxFileName(name: unknown): boolean
export function xlsxImportFailure(status: Exclude<XlsxImportStatus, 'ready' | 'no-text'>): XlsxImportResult
export function isXlsxImportOutcome(value: unknown): value is XlsxImportOutcome
export function xlsxImportCopy(outcome?: XlsxImportOutcome): string
