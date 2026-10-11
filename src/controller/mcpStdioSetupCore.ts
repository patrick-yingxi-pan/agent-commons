import type { McpStdioLaunch, McpStdioSetupSource, McpStdioSetupView, NativeMcpStdioBridge } from '../../contract/mcpStdioSetup.ts'

export type McpStdioPhase = Exclude<McpStdioSetupView['status'], 'ready'> | 'preparing' | 'authorizing' | 'checking' | 'cancelling'
export interface McpStdioSetupState {
  readonly connectionId: string
  readonly label: string
  readonly revision: number
  readonly phase: McpStdioPhase
  readonly flowId?: string
  readonly error?: string
}
export const mcpStdioTerminal = (phase: McpStdioPhase) => ['connected', 'disconnected', 'failed', 'cancelled'].includes(phase)
export const mcpStdioBusy = (phase: McpStdioPhase) => ['preparing', 'authorizing', 'checking', 'cancelling'].includes(phase)
const sourceMatches = (a: McpStdioSetupSource | null, b: McpStdioSetupSource) => a?.tenantId === b.tenantId && a?.userId === b.userId
const safeFailure = 'The native result could not be confirmed. Check status reads only; it never starts another inspection.'
const unavailableHandle = (cause: unknown) => {
  const descriptor = cause && typeof cause === 'object' ? Object.getOwnPropertyDescriptor(cause, 'code') : undefined
  return descriptor && Object.hasOwn(descriptor, 'value') && ['expired', 'stale'].includes(descriptor.value)
}
type Entry = { state: McpStdioSetupState; source: McpStdioSetupSource; epoch: number; sequence: number }

/** A single account-scoped owner for every pane and shell recovery projection.
 * Only begin may authorize, and only after storing its exact native flow ID.
 * Launch input never enters observable state or any persistence mechanism. */
export function createMcpStdioSetupController(deps: {
  api: NativeMcpStdioBridge
  currentSource: () => McpStdioSetupSource | null
  refresh: (id: string) => void
}) {
  let epoch = 0
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  let snapshot: readonly McpStdioSetupState[] = Object.freeze([])
  const publish = () => { snapshot = Object.freeze([...entries.values()].map(entry => entry.state)); for (const listener of listeners) listener() }
  const current = (entry: Entry) => entry.epoch === epoch && entries.get(entry.state.connectionId) === entry && sourceMatches(deps.currentSource(), entry.source)
  const set = (entry: Entry, changes: Partial<McpStdioSetupState>) => { entry.state = Object.freeze({ ...entry.state, ...changes }); publish() }
  const cancelDetached = (flowId: string) => { void deps.api.cancel({ flowId }).catch(() => {}) }
  const accept = (entry: Entry, result: McpStdioSetupView) => {
    if (result.connectionId !== entry.state.connectionId || result.flowId !== entry.state.flowId || result.revision < entry.state.revision || result.status === 'ready') throw new Error('Invalid native receipt.')
    set(entry, { phase: result.status, error: undefined })
    deps.refresh(entry.state.connectionId)
  }
  const recover = async (id: string, method: 'reconcile' | 'cancel') => {
    const entry = entries.get(id)
    if (!entry || !current(entry) || mcpStdioTerminal(entry.state.phase)) return
    if (method === 'reconcile' && mcpStdioBusy(entry.state.phase)) return
    const flowId = entry.state.flowId
    const sequence = ++entry.sequence
    if (!flowId) {
      if (method === 'cancel') set(entry, { phase: 'cancelled', error: undefined })
      return
    }
    set(entry, { phase: method === 'cancel' ? 'cancelling' : 'checking', error: undefined })
    try {
      const result = await deps.api[method]({ flowId })
      if (current(entry) && sequence === entry.sequence) accept(entry, result)
    } catch (cause) {
      if (current(entry) && sequence === entry.sequence) {
        if (unavailableHandle(cause)) {
          set(entry, { phase: 'failed', error: 'This recovery handle expired or its account source changed. The saved connection shows current status; earlier inspection effects are not undone. No inspection was retried. Close this review before starting new setup.' })
          deps.refresh(id)
        } else set(entry, { phase: 'uncertain', error: safeFailure })
      }
    }
  }
  return Object.freeze({
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async begin(connection: { id: string; label: string; revision: number }, source: McpStdioSetupSource, launch: McpStdioLaunch) {
      if (!sourceMatches(deps.currentSource(), source)) return
      const existing = entries.get(connection.id)
      if (existing && !mcpStdioTerminal(existing.state.phase)) return
      if (entries.size >= 64 && !existing) return
      const entry: Entry = { state: Object.freeze({ connectionId: connection.id, label: connection.label, revision: connection.revision, phase: 'preparing' }), source: Object.freeze({ ...source }), epoch, sequence: 0 }
      entries.set(connection.id, entry); publish()
      // Detached before the first await; later edits cannot change reviewed input.
      const request = { connectionId: connection.id, expectedRevision: connection.revision, source: entry.source,
        launch: Object.freeze({ ...launch, args: Object.freeze([...launch.args]), env: Object.freeze({ ...launch.env }) }) }
      try {
        const ready = await deps.api.start(request)
        if (!current(entry) || entry.sequence !== 0) { cancelDetached(ready.flowId); return }
        if (ready.connectionId !== connection.id || ready.revision !== connection.revision || ready.status !== 'ready') {
          cancelDetached(ready.flowId); set(entry, { phase: 'failed', error: 'This connection changed. Close setup and review its current saved state.' }); return
        }
        // The recovery handle is published BEFORE the one possibly-effectful IPC.
        set(entry, { phase: 'authorizing', flowId: ready.flowId })
        if (!current(entry) || entry.sequence !== 0) { cancelDetached(ready.flowId); return }
        const result = await deps.api.authorize({ flowId: ready.flowId })
        if (current(entry) && entry.sequence === 0) accept(entry, result)
      } catch {
        if (current(entry) && entry.sequence === 0) {
          set(entry, { phase: entry.state.flowId ? 'uncertain' : 'failed',
            error: entry.state.flowId ? safeFailure : 'Could not prepare local server setup. No execution approval was requested. Close and review the connection before trying again.' })
          // An acknowledgement may be lost after commit or native-sync failure.
          // Refresh public truth without treating it as consent or a receipt.
          if (entry.state.flowId) deps.refresh(connection.id)
        }
      }
    },
    check: (id: string) => recover(id, 'reconcile'),
    cancel: (id: string) => recover(id, 'cancel'),
    dismiss(id: string) { const entry = entries.get(id); if (entry && mcpStdioTerminal(entry.state.phase)) { entries.delete(id); publish() } },
    reset() { epoch++; for (const entry of entries.values()) if (entry.state.flowId && !mcpStdioTerminal(entry.state.phase)) cancelDetached(entry.state.flowId); entries.clear(); publish() },
  })
}
