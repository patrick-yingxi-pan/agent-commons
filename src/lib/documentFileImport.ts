import { isPdfFileName, MAX_PDF_FILE_BYTES, pdfImportFailure } from '../../contract/pdfImport.mjs'
import { isDocxFileName, MAX_DOCX_FILE_BYTES, docxImportFailure } from '../../contract/docxImport.mjs'
import { isXlsxFileName, MAX_XLSX_FILE_BYTES, xlsxImportFailure } from '../../contract/xlsxImport.mjs'
import { isPptxFileName, MAX_PPTX_FILE_BYTES, pptxImportFailure } from '../../contract/pptxImport.mjs'
import { importPdf } from './pdfImport.ts'
import { importDocx } from './docxImport.ts'
import { importXlsx } from './xlsxImport.ts'
import { importPptx } from './pptxImport.ts'

/** Local selection and served-source capture share the same isolated parsers,
 * whole-file limits and extraction policy. No reader saves original bytes. */
export const PPTX_DOCUMENT_READER = { matches: isPptxFileName, maxBytes: MAX_PPTX_FILE_BYTES, failure: pptxImportFailure, read: importPptx }
const DOCUMENT_READERS = [
  { matches: isPdfFileName, maxBytes: MAX_PDF_FILE_BYTES, failure: pdfImportFailure, read: importPdf },
  { matches: isDocxFileName, maxBytes: MAX_DOCX_FILE_BYTES, failure: docxImportFailure, read: importDocx },
  { matches: isXlsxFileName, maxBytes: MAX_XLSX_FILE_BYTES, failure: xlsxImportFailure, read: importXlsx },
  PPTX_DOCUMENT_READER,
] as const

export const documentReaderForName = (name: string) => DOCUMENT_READERS.find((reader) => reader.matches(name))
