import {
  PDF_OCR_TIMEOUT_MS,
  isPdfOcrResult,
  snapshotPdfOcrInput,
  type PdfOcrResult,
  type NativePdfOcrBridge,
} from '../../contract/pdfOcr.mjs'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
import { runDesktopOcrOperation, type DesktopOcrFailureStatus } from './desktopOcr.ts'

const ADAPTER_TIMEOUT_MS = PDF_OCR_TIMEOUT_MS + 5_000
const unavailable = (): PdfOcrResult => ({ status: 'unavailable' })
const cancelled = (): PdfOcrResult => ({ status: 'cancelled' })

function bridge(scope?: DesktopBridgeScope): NativePdfOcrBridge | undefined {
  try {
    const current = scope ?? (typeof window === 'undefined' ? undefined : window)
    return current?.agentCommonsDesktop?.pdfOcr
  } catch { return undefined }
}

function detachedResult(value: unknown): PdfOcrResult {
  if (!isPdfOcrResult(value)) return unavailable()
  if (value.status === 'ready') return { status: 'ready', text: value.text, pages: value.pages, textPages: value.textPages }
  if (value.status === 'no-text') return { status: 'no-text', pages: value.pages, textPages: 0 }
  return { status: value.status }
}

export function desktopPdfOcrAvailable(scope?: DesktopBridgeScope): boolean {
  const port = bridge(scope)
  return !!port && typeof port.recognize === 'function' && typeof port.cancel === 'function'
}

/** Only explicitly selected PDF bytes cross this local adapter. It has no
 * backend, provider, model, storage, or path capability. */
export function recognizeDesktopPdfText(pdf: Uint8Array, signal?: AbortSignal, scope?: DesktopBridgeScope): Promise<PdfOcrResult> {
  if (signal?.aborted) return Promise.resolve(cancelled())
  const port = bridge(scope)
  if (!port || typeof port.recognize !== 'function' || typeof port.cancel !== 'function') return Promise.resolve(unavailable())
  const input = snapshotPdfOcrInput(pdf)
  if (input.status !== 'ready') return Promise.resolve({ status: input.status })
  return runDesktopOcrOperation({
    port, bytes: input.pdf, signal, timeoutMs: ADAPTER_TIMEOUT_MS,
    parseResult: detachedResult,
    statusResult: (status: DesktopOcrFailureStatus): PdfOcrResult => ({ status }),
  })
}
