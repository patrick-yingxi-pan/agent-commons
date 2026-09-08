import type { PdfImportOutcome } from './pdfImport.mjs'
import type { DocxImportOutcome } from './docxImport.mjs'
export type DocumentImportOutcome = PdfImportOutcome | DocxImportOutcome
export function isDocumentImportOutcome(value: unknown): value is DocumentImportOutcome
export function documentImportCopy(value?: DocumentImportOutcome): string
