import { isPdfImportOutcome, pdfImportCopy } from './pdfImport.mjs'
import { isDocxImportOutcome, docxImportCopy } from './docxImport.mjs'

export const isDocumentImportOutcome = (value) => isPdfImportOutcome(value) || isDocxImportOutcome(value)
export const documentImportCopy = (value) => value?.format === 'docx' ? docxImportCopy(value) : pdfImportCopy(value)
