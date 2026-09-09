/** Account-scoped facade for acknowledgement-owned external MCP lifecycle
 * intents. Public reviewed views are retained while an addressed row is held;
 * endpoint and credential metadata stay in the private API ceremony. */
import { useSyncExternalStore } from 'react'
import { activeAccount, onAccountSwitch } from '../api/account.ts'
import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import {
  mcpConnectionMutationResourceId,
  type McpConnectionMutationInput,
  type McpConnectionMutationIntent,
} from '../api/mcpConnectionIntent.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createRetryableRuntimeLoader, createRuntimeLoadFailureTracker } from './retryableRuntimeLoader.ts'

export type { McpConnectionMutationInput, McpConnectionMutationIntent } from '../api/mcpConnectionIntent.ts'
export { mcpConnectionMutationResourceId } from '../api/mcpConnectionIntent.ts'

interface HeldMcpMutation {
  intent: McpConnectionMutationIntent
  result: Promise<RevisionedMutationOutcome>
  settle: (outcome: RevisionedMutationOutcome) => void
  issuedGeneration: number
  loading: boolean
}

const statusStore = createMutationStatusStore()
const held = new Map<string, HeldMcpMutation>()
const heldViews = new Map<string, McpConnectionView>()
const heldViewListeners = new Set<() => void>()
let heldViewSnapshot: readonly McpConnectionView[] = []
let accountGeneration = 0
export const publishMcpConnectionMutationStatus = statusStore.publish

const publishHeldViews = (): void => {
  heldViewSnapshot = Object.freeze([...heldViews.values()])
  for (const listener of heldViewListeners) listener()
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  }
  return value
}

const freezeIntent = (intent: McpConnectionMutationIntent): McpConnectionMutationIntent => {
  if (intent.kind === 'create') {
    return Object.freeze({ ...intent, request: Object.freeze({ ...intent.request }) })
  }
  if (intent.kind === 'inspect') {
    return Object.freeze({
      ...intent,
      request: Object.freeze({ ...intent.request }),
      reviewed: intent.reviewed ? freezeDeep(structuredClone(intent.reviewed)) : undefined,
    })
  }
  return Object.freeze({
    ...intent,
    reviewed: intent.reviewed ? freezeDeep(structuredClone(intent.reviewed)) : undefined,
  })
}

type Runtime = typeof import('./mcpConnectionMutationRuntime.ts')
let runtime: Runtime | null = null
const loadRuntime = createRetryableRuntimeLoader<Runtime>(
  () => import('./mcpConnectionMutationRuntime.ts'),
  (loaded) => { runtime = loaded },
)
const loadFailures = createRuntimeLoadFailureTracker()

const publishLoadFailure = (): void => {
  statusStore.publish(loadFailures.status(
    held.size,
    'Couldn’t load the MCP connection controller. Retry safely or Dismiss.',
  ))
}

const activateHeldMutation = (resourceId: string, entry: HeldMcpMutation): void => {
  if (entry.loading || held.get(resourceId) !== entry) return
  entry.loading = true
  statusStore.publish({ busy: true, error: null, retryable: false, activeResourceId: resourceId, pendingCount: held.size })
  void loadRuntime().then(
    (loaded) => {
      entry.loading = false
      if (entry.issuedGeneration !== accountGeneration || held.get(resourceId) !== entry) {
        entry.settle('discarded')
        return
      }
      void loaded.enqueueMcpConnectionMutationRuntime(entry.intent).then(entry.settle)
    },
    () => {
      entry.loading = false
      if (entry.issuedGeneration !== accountGeneration || held.get(resourceId) !== entry) return
      loadFailures.fail(resourceId)
      publishLoadFailure()
    },
  )
}

onAccountSwitch(() => {
  accountGeneration += 1
  loadFailures.clear()
  for (const entry of held.values()) entry.settle('discarded')
  held.clear()
  heldViews.clear()
  publishHeldViews()
  if (runtime) runtime.clearMcpConnectionMutations()
  else statusStore.publish(IDLE_REVISIONED_MUTATION)
})

export const isMcpConnectionHeld = (id: string): boolean =>
  [...held.values()].some(({ intent }) => intent.kind !== 'create' && intent.id === id)

export function useMcpConnectionHeldViews(): readonly McpConnectionView[] {
  return useSyncExternalStore(
    (listener) => {
      heldViewListeners.add(listener)
      return () => heldViewListeners.delete(listener)
    },
    () => heldViewSnapshot,
    () => [],
  )
}

export function enqueueMcpConnectionMutation(
  input: McpConnectionMutationInput,
): Promise<RevisionedMutationOutcome> | null {
  const account = activeAccount()
  const tenantId = input.tenantId ?? account?.tenantId
  if (!tenantId || (account && tenantId !== account.tenantId)) return null
  const intent = freezeIntent({ ...input, tenantId } as McpConnectionMutationIntent)
  const resourceId = mcpConnectionMutationResourceId(intent)
  const existing = held.get(resourceId)
  if (existing) return existing.result
  const issuedGeneration = accountGeneration
  let settle!: (outcome: RevisionedMutationOutcome) => void
  const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
  const entry = { intent, result, settle, issuedGeneration, loading: false }
  held.set(resourceId, entry)
  if (intent.kind !== 'create' && intent.reviewed) heldViews.set(intent.id, intent.reviewed)
  if (loadFailures.active()) publishLoadFailure()
  else statusStore.refresh()
  publishHeldViews()
  if (!loadFailures.active()) activateHeldMutation(resourceId, entry)
  void result.then(() => {
    if (issuedGeneration !== accountGeneration) return
    if (held.get(resourceId)?.result !== result) return
    held.delete(resourceId)
    loadFailures.remove(resourceId, held.keys())
    if (intent.kind !== 'create') heldViews.delete(intent.id)
    if (!runtime) publishLoadFailure()
    else statusStore.refresh()
    publishHeldViews()
  })
  return result
}

export const retryMcpConnectionMutation = (): void => {
  if (runtime) runtime.retryMcpConnectionMutationRuntime()
  else {
    loadFailures.retry()
    for (const [resourceId, entry] of held) activateHeldMutation(resourceId, entry)
  }
}
export const discardMcpConnectionMutation = (): void => {
  if (runtime) runtime.discardMcpConnectionMutationRuntime()
  else {
    const resourceId = loadFailures.active()
    if (resourceId) held.get(resourceId)?.settle('discarded')
  }
}
export const useMcpConnectionMutationStatus = statusStore.useStatus
export const clearMcpConnectionMutations = (): void => { runtime?.clearMcpConnectionMutations() }
