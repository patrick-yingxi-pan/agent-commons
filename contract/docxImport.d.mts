export const MAX_DOCX_FILE_BYTES: number
export const MAX_DOCX_SELECTION_BYTES: number
export const MAX_DOCX_TEXT_BYTES: number
export const MAX_DOCX_ENTRIES: number
export const MAX_DOCX_PART_BYTES: number
export const MAX_DOCX_EXPANDED_BYTES: number
export const DOCX_IMPORT_TIMEOUT_MS: number
export type DocxImportStatus = 'ready' | 'no-text' | 'file-too-large' | 'selection-limit' | 'text-limit' | 'structure-limit' | 'unsupported' | 'timeout' | 'invalid' | 'unavailable'
export interface DocxImportOutcome { format: 'docx'; status: DocxImportStatus }
export interface DocxImportResult { text?: string; documentImport: DocxImportOutcome }
export function isDocxFileName(name: unknown): boolean
export function docxImportFailure(status: Exclude<DocxImportStatus, 'ready' | 'no-text'>): DocxImportResult
export function isDocxImportOutcome(value: unknown): value is DocxImportOutcome
export function docxImportCopy(outcome?: DocxImportOutcome): string
