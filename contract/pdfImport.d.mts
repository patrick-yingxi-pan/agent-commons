export const MAX_PDF_FILE_BYTES: number
export const MAX_PDF_SELECTION_BYTES: number
export const MAX_PDF_PAGES: number
export const MAX_PDF_TEXT_BYTES: number
export const PDF_IMPORT_TIMEOUT_MS: number
export type PdfImportStatus = 'ready' | 'no-text' | 'file-too-large' | 'selection-limit' | 'page-limit' | 'text-limit' | 'protected' | 'timeout' | 'invalid' | 'unavailable'
export interface PdfImportOutcome {
  format: 'pdf'
  status: PdfImportStatus
  /** Present only when ready text came from explicitly requested on-device OCR. */
  method?: 'ocr'
  pages?: number
  textPages?: number
}
export interface PdfImportResult { text?: string; documentImport: PdfImportOutcome }
export function isPdfFileName(name: unknown): boolean
export function pdfImportFailure(status: Exclude<PdfImportStatus, 'ready' | 'no-text'>): PdfImportResult
export function pdfImportCopy(outcome?: PdfImportOutcome): string
export function isPdfImportOutcome(value: unknown): value is PdfImportOutcome
