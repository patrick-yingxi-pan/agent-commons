import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBoundedOcrRunner } from './ocrRunner.mjs'
import {
  IMAGE_OCR_CAPACITY,
  IMAGE_OCR_MAX_OUTPUT_BYTES,
  IMAGE_OCR_TIMEOUT_MS,
  isImageOcrHelperResult,
  snapshotImageOcrInput,
} from '../contract/imageOcr.mjs'

export {
  IMAGE_OCR_CAPACITY,
  IMAGE_OCR_MAX_EDGE,
  IMAGE_OCR_MAX_INPUT_BYTES,
  IMAGE_OCR_MAX_OUTPUT_BYTES,
  IMAGE_OCR_MAX_TEXT_BYTES,
  IMAGE_OCR_TIMEOUT_MS,
} from '../contract/imageOcr.mjs'

export function imageOcrExecutable({ packaged = false, resourcesPath, targetPlatform = process.platform } = {}) {
  if (targetPlatform !== 'darwin') return null
  return packaged ? join(resourcesPath, 'agent-commons-image-ocr')
    : fileURLToPath(new URL('./bin/agent-commons-image-ocr', import.meta.url))
}

/** The helper independently performs complete ImageIO admission. This cheap
 * preflight bounds IPC-sized allocations before any process is started. */
function snapshotInput(bytes) {
  const snapshot = snapshotImageOcrInput(bytes)
  return snapshot.status === 'ready' ? Buffer.from(snapshot.png) : snapshot
}

/** A closed, path-free publication; malformed/native diagnostics never become
 * editable text. Whole output is required, including valid UTF-8 and Unicode. */
export function parseImageOcrOutput(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > IMAGE_OCR_MAX_OUTPUT_BYTES) return { status: 'unavailable' }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { status: 'unavailable' }
    return isImageOcrHelperResult(result) ? result : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Byte-only engine: no file access, persistence, model call or automatic
 * extraction. The host's explicit review workflow supplies normalized image
 * bytes; adopting editable text and saving are separate renderer actions.
 * Packaged hosts must supply imageOcrExecutable({ packaged: true, resourcesPath }). */
export function createImageOcrRunner({
  executable = imageOcrExecutable(),
  targetPlatform = process.platform,
  spawnProcess = spawn,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const runner = createBoundedOcrRunner({
    executable, targetPlatform, spawnProcess, setTimer, clearTimer,
    timeoutMs: IMAGE_OCR_TIMEOUT_MS,
    capacity: IMAGE_OCR_CAPACITY,
    maxOutputBytes: IMAGE_OCR_MAX_OUTPUT_BYTES,
    prepareInput: snapshotInput,
    parseOutput: parseImageOcrOutput,
  })
  return { recognize: runner.run, dispose: runner.dispose }
}
