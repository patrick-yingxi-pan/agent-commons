import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBoundedOcrRunner } from './ocrRunner.mjs'
import {
  PDF_OCR_CAPACITY,
  PDF_OCR_MAX_OUTPUT_BYTES,
  PDF_OCR_TIMEOUT_MS,
  isPdfOcrHelperResult,
  snapshotPdfOcrInput,
} from '../contract/pdfOcr.mjs'

export {
  PDF_OCR_CAPACITY,
  PDF_OCR_MAX_EDGE,
  PDF_OCR_MAX_INPUT_BYTES,
  PDF_OCR_MAX_OUTPUT_BYTES,
  PDF_OCR_MAX_PAGES,
  PDF_OCR_MAX_TEXT_BYTES,
  PDF_OCR_TIMEOUT_MS,
} from '../contract/pdfOcr.mjs'

export function pdfOcrExecutable({ packaged = false, resourcesPath, targetPlatform = process.platform } = {}) {
  if (targetPlatform !== 'darwin') return null
  const bundle = packaged ? join(resourcesPath, '..', 'Helpers', 'Agent Commons PDF OCR.app')
    : fileURLToPath(new URL('./bin/Agent Commons PDF OCR.app', import.meta.url))
  return join(bundle, 'Contents', 'MacOS', 'agent-commons-pdf-ocr')
}

function snapshotInput(bytes) {
  const snapshot = snapshotPdfOcrInput(bytes)
  return snapshot.status === 'ready' ? Buffer.from(snapshot.pdf) : snapshot
}

export function parsePdfOcrOutput(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > PDF_OCR_MAX_OUTPUT_BYTES) return { status: 'unavailable' }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { status: 'unavailable' }
    return isPdfOcrHelperResult(result) ? result : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Path-free PDF engine. The helper renders pages sequentially and only returns
 * a closed complete result. Cancellation/deadline never releases capacity
 * until the child actually closes. */
export function createPdfOcrRunner({
  executable = pdfOcrExecutable(),
  targetPlatform = process.platform,
  spawnProcess,
  setTimer,
  clearTimer,
} = {}) {
  const runner = createBoundedOcrRunner({
    executable, targetPlatform, spawnProcess, setTimer, clearTimer,
    timeoutMs: PDF_OCR_TIMEOUT_MS,
    capacity: PDF_OCR_CAPACITY,
    maxOutputBytes: PDF_OCR_MAX_OUTPUT_BYTES,
    prepareInput: snapshotInput,
    parseOutput: parsePdfOcrOutput,
  })
  return { recognize: runner.run, dispose: runner.dispose }
}
