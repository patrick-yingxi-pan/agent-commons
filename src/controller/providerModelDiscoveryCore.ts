import type {
  DiscoverProviderModelsRequest,
  DiscoverProviderModelsResult,
} from '../../contract/providerDiscovery.ts'
import type { ModelInfo } from '../../contract/providers.ts'

export interface ProviderModelDiscoveryState {
  status: 'idle' | 'loading' | 'loaded' | 'failed'
  models: ModelInfo[]
  error: string | null
  hasCredential: boolean
}

export interface ProviderModelDiscoveryDependencies {
  discover(request: DiscoverProviderModelsRequest, signal: AbortSignal): Promise<DiscoverProviderModelsResult>
  provision(secret: string): Promise<string>
  discard(reference: string): Promise<void>
  assertCurrentAccount(): void
  publish(state: ProviderModelDiscoveryState): void
  /** Clear the raw draft key only after its reference is safely staged. */
  onProvisioned(): void
}

const FAILURE = 'Could not load models. Check the connection and try again, or enter a model manually.'
const idle = (): ProviderModelDiscoveryState => ({ status: 'idle', models: [], error: null, hasCredential: false })

/** One unsaved provider draft owns an explicit catalog read and at most one
 * never-submitted desktop key. Creation takes ownership before it can submit. */
export function createProviderModelDiscoveryCore(deps: ProviderModelDiscoveryDependencies) {
  let state = idle()
  let credential: string | undefined
  let disposed = false
  let epoch = 0
  let pending: { controller: AbortController; promise: Promise<void> } | undefined

  // Cleanup is exact and remains permitted after the initiating account leaves.
  const discard = (reference: string): void => {
    try { void deps.discard(reference).catch(() => {}) } catch { /* Best-effort native cleanup. */ }
  }
  const invalidate = (): void => {
    epoch += 1
    pending?.controller.abort()
    pending = undefined
    const previous = credential
    credential = undefined
    state = idle()
    if (previous) discard(previous)
  }
  const currentAccount = (): boolean => {
    if (disposed) return false
    try {
      deps.assertCurrentAccount()
      return true
    } catch {
      // An instance belongs to the account generation that opened the dialog.
      disposed = true
      invalidate()
      return false
    }
  }
  const publish = (next: ProviderModelDiscoveryState): void => {
    if (!currentAccount()) return
    state = next
    deps.publish(state)
  }

  const load = (request: DiscoverProviderModelsRequest, deviceSecret?: string): Promise<void> => {
    if (!currentAccount()) return Promise.resolve()
    if (pending) return pending.promise
    const readEpoch = epoch
    const controller = new AbortController()
    const read = { controller, promise: Promise.resolve() }
    const captured = { ...request }
    const isCurrent = (): boolean => readEpoch === epoch && pending === read && !controller.signal.aborted && currentAccount()
    pending = read
    read.promise = Promise.resolve().then(async () => {
      if (!isCurrent()) return
      try {
        if (!credential && deviceSecret) {
          const fresh = await deps.provision(deviceSecret)
          deviceSecret = undefined
          if (!isCurrent()) {
            discard(fresh)
            return
          }
          credential = fresh
          deps.onProvisioned()
          if (!isCurrent()) return
          publish({ ...state, hasCredential: true })
        }
        if (!isCurrent()) return
        const result = await deps.discover({ ...captured, ...(credential ? { apiKeyEnv: credential } : {}) }, controller.signal)
        if (!isCurrent()) return
        publish({ status: 'loaded', models: structuredClone(result.models), error: null, hasCredential: !!credential })
      } catch {
        // Upstream bodies may contain credentials or endpoint diagnostics.
        if (isCurrent()) publish({ status: 'failed', models: [], error: FAILURE, hasCredential: !!credential })
      } finally {
        deviceSecret = undefined
        if (pending === read) pending = undefined
      }
    })
    publish({ status: 'loading', models: [], error: null, hasCredential: !!credential })
    return read.promise
  }

  const reset = (): void => {
    invalidate()
    publish(state)
  }
  const takeCredential = (): string | undefined => {
    if (!currentAccount()) throw new Error('This provider draft is no longer active.')
    if (pending) throw new Error('Wait for model loading to finish before creating the provider.')
    const taken = credential
    credential = undefined
    if (taken) publish({ ...state, hasCredential: false })
    return taken
  }
  const dispose = (): void => {
    disposed = true
    invalidate()
  }

  return { load, reset, takeCredential, dispose, snapshot: (): ProviderModelDiscoveryState => state }
}
