export const PDF_OCR_MAX_INPUT_BYTES: number
export const PDF_OCR_MAX_PAGES: number
export const PDF_OCR_MAX_EDGE: number
export const PDF_OCR_MAX_TEXT_BYTES: number
export const PDF_OCR_MAX_OUTPUT_BYTES: number
export const PDF_OCR_TIMEOUT_MS: number
export const PDF_OCR_CAPACITY: number

export type PdfOcrFailureStatus = 'invalid' | 'too-large' | 'page-limit' | 'protected' | 'unavailable' | 'busy' | 'cancelled' | 'timeout'
export type PdfOcrResult =
  | { status: 'ready'; text: string; pages: number; textPages: number }
  | { status: 'no-text'; pages: number; textPages: 0 }
  | { status: PdfOcrFailureStatus }
export type PdfOcrHelperResult =
  | Extract<PdfOcrResult, { status: 'ready' | 'no-text' }>
  | { status: Exclude<PdfOcrFailureStatus, 'busy' | 'cancelled' | 'timeout'> }
export type PdfOcrInputSnapshot = { status: 'ready'; pdf: Uint8Array } | { status: 'invalid' | 'too-large' }

export interface NativePdfOcrBridge {
  recognize(operationId: string, pdf: Uint8Array): Promise<PdfOcrResult>
  cancel(operationId: string): Promise<boolean>
}

export function snapshotPdfOcrInput(value: unknown): PdfOcrInputSnapshot
export function isPdfOcrResult(value: unknown): value is PdfOcrResult
export function isPdfOcrHelperResult(value: unknown): value is PdfOcrHelperResult
