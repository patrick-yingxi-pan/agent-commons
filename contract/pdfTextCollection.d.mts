import type { PdfImportResult } from './pdfImport.mjs'

export function collectPdfText(document: {
  numPages: number
  getPage(page: number): Promise<{
    streamTextContent(): ReadableStream<{ items: Array<{ str?: string; hasEOL?: boolean }> }>
    cleanup(): unknown
  }>
}): Promise<PdfImportResult>
