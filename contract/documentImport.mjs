import { isPdfImportOutcome, pdfImportCopy } from './pdfImport.mjs'
import { isDocxImportOutcome, docxImportCopy } from './docxImport.mjs'
import { isXlsxImportOutcome, xlsxImportCopy } from './xlsxImport.mjs'
import { isPptxImportOutcome, pptxImportCopy } from './pptxImport.mjs'

export const isDocumentImportOutcome = (value) => isPdfImportOutcome(value) || isDocxImportOutcome(value) || isXlsxImportOutcome(value) || isPptxImportOutcome(value)
export const documentImportCopy = (value) => value?.format === 'pptx' ? pptxImportCopy(value) : value?.format === 'xlsx' ? xlsxImportCopy(value) : value?.format === 'docx' ? docxImportCopy(value) : pdfImportCopy(value)
