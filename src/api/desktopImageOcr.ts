import {
  IMAGE_OCR_TIMEOUT_MS,
  isImageOcrResult,
  snapshotImageOcrInput,
  type ImageOcrResult,
  type NativeImageOcrBridge,
} from '../../contract/imageOcr.mjs'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
import { accountGeneration, onAccountSwitch as subscribeAccountSwitch } from './account.ts'

const ADAPTER_TIMEOUT_MS = IMAGE_OCR_TIMEOUT_MS + 5_000
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
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
  const operationId = globalThis.crypto?.randomUUID?.()
  if (typeof operationId !== 'string' || !UUID_V4.test(operationId)) return Promise.resolve(unavailable())

  const issuedGeneration = accountGeneration()
  let resolveOutcome!: (result: ImageOcrResult) => void
  const outcome = new Promise<ImageOcrResult>((resolve) => { resolveOutcome = resolve })
  let settled = false
  let accountSwitched = false
  let cancelSent = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = () => {}

  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    signal?.removeEventListener('abort', onAbort)
    unsubscribe()
    unsubscribe = () => {}
  }
  const finish = (result: ImageOcrResult) => {
    if (settled) return
    settled = true
    cleanup()
    resolveOutcome(result)
  }
  const sendCancel = () => {
    if (cancelSent) return
    cancelSent = true
    try { void Promise.resolve(port.cancel(operationId)).catch(() => {}) }
    catch { /* native cancellation is best effort; the local fence is immediate */ }
  }
  const stop = (result: ImageOcrResult) => {
    if (settled) return
    sendCancel()
    finish(result)
  }
  const onAbort = () => stop(cancelled())
  const onAccountSwitch = () => {
    accountSwitched = true
    stop(cancelled())
  }
  const isStale = () => accountSwitched || issuedGeneration !== accountGeneration()

  try {
    unsubscribe = subscribeAccountSwitch(onAccountSwitch)
    if (signal?.aborted) {
      stop(cancelled())
      return outcome
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => stop({ status: 'timeout' }), ADAPTER_TIMEOUT_MS)
    if (isStale()) {
      stop(cancelled())
      return outcome
    }

    let nativeResult: Promise<ImageOcrResult>
    try { nativeResult = Promise.resolve(port.recognize(operationId, input.png)) }
    catch { nativeResult = Promise.reject(new Error('Native OCR request failed.')) }
    void nativeResult.then((value) => {
      if (isStale()) {
        finish(cancelled())
        return
      }
      finish(detachedResult(value))
    }, () => {
      if (isStale()) finish(cancelled())
      else finish(unavailable())
    })
  } catch {
    finish(unavailable())
  }
  return outcome
}
