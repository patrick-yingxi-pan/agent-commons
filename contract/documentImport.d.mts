import type { PdfImportOutcome } from './pdfImport.mjs'
import type { DocxImportOutcome } from './docxImport.mjs'
import type { XlsxImportOutcome } from './xlsxImport.mjs'
import type { PptxImportOutcome } from './pptxImport.mjs'
export type DocumentImportOutcome = PdfImportOutcome | DocxImportOutcome | XlsxImportOutcome | PptxImportOutcome
export function isDocumentImportOutcome(value: unknown): value is DocumentImportOutcome
export function documentImportCopy(value?: DocumentImportOutcome): string
