/** Private, memory-only drafts and receipt identities, shared across panes.
 * Account switches erase answers and fence every late asynchronous callback. */
import { useSyncExternalStore } from 'react'
import type { McpInputCommand, McpInputReceipt, McpInputReview } from '../../contract/mcpInput.ts'
import type { McpInputScope } from '../api/mcpInputCommands.ts'
import { onAccountSwitch } from '../api/account.ts'
import type { McpInputDraft } from '../lib/mcpInputDraft.ts'

export type McpInputAttempt = {
  scope: McpInputScope
  command: McpInputCommand
  state: 'submitting' | 'checking' | 'uncertain' | 'receipt'
  receipt?: McpInputReceipt
  error?: string
}
export type McpInputHeldState = { round: number; draft: McpInputDraft; review?: McpInputReview; attempt?: McpInputAttempt }
const held = new Map<string, McpInputHeldState>()
const listeners = new Set<() => void>()
let generation = 0
let attempts: readonly McpInputAttempt[] = []
export const mcpInputKey = (scope: Pick<McpInputScope, 'sessionId' | 'activityId' | 'decisionId'>) =>
  JSON.stringify([scope.sessionId, scope.activityId, scope.decisionId])
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const publish = () => {
  attempts = [...held.values()].flatMap((value) => value.attempt ? [value.attempt] : [])
  for (const listener of listeners) listener()
}
onAccountSwitch(() => { generation += 1; held.clear(); publish() })
export const mcpInputGeneration = () => generation
export const mcpInputHeld = (scope: McpInputScope): McpInputHeldState | null => held.get(mcpInputKey(scope)) ?? null
export function setMcpInputHeld(scope: McpInputScope, value: McpInputHeldState | null): void {
  if (value) held.set(mcpInputKey(scope), value)
  else held.delete(mcpInputKey(scope))
  publish()
}
export function updateMcpInputDraft(scope: McpInputScope, review: McpInputReview, draft: McpInputDraft): void {
  const current = mcpInputHeld(scope)
  if (current?.attempt) return
  setMcpInputHeld(scope, { round: review.round, draft: structuredClone(draft) })
}
export function useMcpInputHeld(scope: McpInputScope): McpInputHeldState | null {
  return useSyncExternalStore(subscribe, () => mcpInputHeld(scope), () => null)
}
export function useMcpInputAttempts(): readonly McpInputAttempt[] {
  return useSyncExternalStore(subscribe, () => attempts, () => attempts)
}
