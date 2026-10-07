import {
  IMAGE_OCR_TIMEOUT_MS,
  isImageOcrResult,
  snapshotImageOcrInput,
  type ImageOcrResult,
  type NativeImageOcrBridge,
} from '../../contract/imageOcr.mjs'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
import { runDesktopOcrOperation, type DesktopOcrFailureStatus } from './desktopOcr.ts'

const ADAPTER_TIMEOUT_MS = IMAGE_OCR_TIMEOUT_MS + 5_000
const unavailable = (): ImageOcrResult => ({ status: 'unavailable' })
const cancelled = (): ImageOcrResult => ({ status: 'cancelled' })

function bridge(scope?: DesktopBridgeScope): NativeImageOcrBridge | undefined {
  try {
    const current = scope ?? (typeof window === 'undefined' ? undefined : window)
    return current?.agentCommonsDesktop?.imageOcr
  } catch {
    return undefined
  }
}

function detachedResult(value: unknown): ImageOcrResult {
  if (!isImageOcrResult(value)) return unavailable()
  return value.status === 'ready' ? { status: 'ready', text: value.text } : { status: value.status }
}

export function desktopImageOcrAvailable(scope?: DesktopBridgeScope): boolean {
  const port = bridge(scope)
  return !!port && typeof port.recognize === 'function' && typeof port.cancel === 'function'
}

/** Runs only the explicitly supplied normalized PNG bytes. No backend, file,
 * provider, model, or persistent state is reachable through this adapter. */
export function recognizeDesktopImageText(
  png: Uint8Array,
  signal?: AbortSignal,
  scope?: DesktopBridgeScope,
): Promise<ImageOcrResult> {
  if (signal?.aborted) return Promise.resolve(cancelled())
  const port = bridge(scope)
  if (!port || typeof port.recognize !== 'function' || typeof port.cancel !== 'function') return Promise.resolve(unavailable())

  const input = snapshotImageOcrInput(png)
  if (input.status !== 'ready') return Promise.resolve({ status: input.status })
  return runDesktopOcrOperation({
    port, bytes: input.png, signal, timeoutMs: ADAPTER_TIMEOUT_MS,
    parseResult: detachedResult,
    statusResult: (status: DesktopOcrFailureStatus): ImageOcrResult => ({ status }),
  })
}
