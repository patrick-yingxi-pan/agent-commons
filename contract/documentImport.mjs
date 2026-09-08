import { isPdfImportOutcome, pdfImportCopy } from './pdfImport.mjs'
import { isDocxImportOutcome, docxImportCopy } from './docxImport.mjs'
import { isXlsxImportOutcome, xlsxImportCopy } from './xlsxImport.mjs'

export const isDocumentImportOutcome = (value) => isPdfImportOutcome(value) || isDocxImportOutcome(value) || isXlsxImportOutcome(value)
export const documentImportCopy = (value) => value?.format === 'xlsx' ? xlsxImportCopy(value) : value?.format === 'docx' ? docxImportCopy(value) : pdfImportCopy(value)
