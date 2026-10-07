import { accountGeneration, onAccountSwitch as subscribeAccountSwitch } from './account.ts'

export type DesktopOcrFailureStatus = 'unavailable' | 'cancelled' | 'timeout'

export interface DesktopOcrPort {
  recognize(operationId: string, bytes: Uint8Array): Promise<unknown>
  cancel(operationId: string): Promise<unknown>
}

/** Owns the lifecycle shared by the optional native OCR doors. Format-specific
 * byte admission and closed result parsing stay with their owning adapters. */
export function runDesktopOcrOperation<Result extends { status: string }>({
  port,
  bytes,
  signal,
  timeoutMs,
  parseResult,
  statusResult,
}: {
  port: DesktopOcrPort
  bytes: Uint8Array
  signal?: AbortSignal
  timeoutMs: number
  parseResult(value: unknown): Result
  statusResult(status: DesktopOcrFailureStatus): Result
}): Promise<Result> {
  const operationId = globalThis.crypto?.randomUUID?.()
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  if (typeof operationId !== 'string' || !UUID_V4.test(operationId)) {
    return Promise.resolve(statusResult('unavailable'))
  }

  const issuedGeneration = accountGeneration()
  let resolveOutcome!: (result: Result) => void
  const outcome = new Promise<Result>((resolve) => { resolveOutcome = resolve })
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
  const finish = (result: Result) => {
    if (settled) return
    settled = true
    cleanup()
    resolveOutcome(result)
  }
  const sendCancel = () => {
    if (cancelSent) return
    cancelSent = true
    try { void Promise.resolve(port.cancel(operationId)).catch(() => {}) }
    catch { /* cancellation is best effort; the local result fence is immediate */ }
  }
  const stop = (result: Result) => {
    if (settled) return
    sendCancel()
    finish(result)
  }
  const onAbort = () => stop(statusResult('cancelled'))
  const onAccountSwitch = () => {
    accountSwitched = true
    stop(statusResult('cancelled'))
  }
  const isStale = () => accountSwitched || issuedGeneration !== accountGeneration()

  try {
    unsubscribe = subscribeAccountSwitch(onAccountSwitch)
    if (signal?.aborted) {
      stop(statusResult('cancelled'))
      return outcome
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => stop(statusResult('timeout')), timeoutMs)
    if (isStale()) {
      stop(statusResult('cancelled'))
      return outcome
    }

    let nativeResult: Promise<unknown>
    try { nativeResult = Promise.resolve(port.recognize(operationId, bytes)) }
    catch { nativeResult = Promise.reject(new Error('Native OCR request failed.')) }
    void nativeResult.then((value) => {
      if (isStale()) { finish(statusResult('cancelled')); return }
      try { finish(parseResult(value)) }
      catch { finish(statusResult('unavailable')) }
    }, () => finish(isStale() ? statusResult('cancelled') : statusResult('unavailable')))
  } catch {
    finish(statusResult('unavailable'))
  }
  return outcome
}
