/** Small account-scoped held-attempt store shared by the page shell and lazy
 * MCP envelope. It deliberately contains no transport or command imports. */
import { useSyncExternalStore } from 'react'
import type { ContributionEffectRun } from '../../contract/contributionExecution.ts'
import { onAccountSwitch } from '../api/account.ts'
import type { ContributionMcpEffectIntent } from '../api/contributionMcpEffectCommands.ts'

export type ContributionMcpAttempt = {
  intent: ContributionMcpEffectIntent
  idempotencyKey: string
  state: 'submitting' | 'checking' | 'pending' | 'uncertain' | 'receipt'
  receipt?: ContributionEffectRun
}

const attempts = new Map<string, ContributionMcpAttempt>()
const listeners = new Set<() => void>()
let generation = 0
const keyFor = (projectId: string, contributionId: string) => `${projectId}\0${contributionId}`
const publish = () => { for (const listener of listeners) listener() }

onAccountSwitch(() => {
  generation += 1
  attempts.clear()
  publish()
})

export function contributionMcpEffectGeneration(): number {
  return generation
}

export function contributionMcpEffectAttempt(projectId: string, contributionId: string): ContributionMcpAttempt | null {
  return attempts.get(keyFor(projectId, contributionId)) ?? null
}

export function setContributionMcpEffectAttempt(
  projectId: string,
  contributionId: string,
  attempt: ContributionMcpAttempt | null,
): void {
  const key = keyFor(projectId, contributionId)
  if (attempt) attempts.set(key, attempt)
  else attempts.delete(key)
  publish()
}

export function useContributionMcpEffectAttempt(projectId: string, contributionId: string): ContributionMcpAttempt | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => contributionMcpEffectAttempt(projectId, contributionId),
    () => null,
  )
}
