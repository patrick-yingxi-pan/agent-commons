import { useEffect, useSyncExternalStore } from 'react'
import type { AgentRequestCreate, AgentRequestDecision } from '../../contract/agentRequests.ts'
import type { Identity } from '../../contract/identity.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { peek } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { ApiRequestError } from '../api/client.ts'
import { acceptAgentRequest, agentRequestId, createAgentRequest, decideAgentRequest, readAgentRequest } from '../api/agentRequests.ts'
import { createAgentRequestActions } from './agentRequestActionsCore.ts'

const listeners = new Set<() => void>()
let version = 0, restoredScope: string | undefined, creating = false
const publish = () => { version += 1; for (const listener of listeners) listener() }
const identity = () => peek<Identity>(keys.me)
const source = () => {
  const who = identity()
  if (!who) throw new Error('The current account is not ready.')
  return { expectedSessionUserId: who.via === 'session' ? who.user.id : null }
}
const scopeKey = () => { const who = identity(); return who && `agent-request-recovery:${JSON.stringify([who.tenant.id, who.user.id])}` }
const actions = createAgentRequestActions({
  submit: action => action.kind === 'create'
    ? createAgentRequest(action.input, action.id, { ...source(), idempotencyKey: action.key })
    : decideAgentRequest(action.id, action.input, source()),
  read: id => readAgentRequest(id, source()),
  accept: row => { acceptAgentRequest(row) },
  definitive: error => error instanceof ApiRequestError && error.status >= 400 && error.status < 500,
  changed: publish,
  remember: ids => {
    const key = scopeKey()
    if (!key) return
    try { if (ids.length) localStorage.setItem(key, JSON.stringify(ids)); else localStorage.removeItem(key) } catch { /* memory recovery remains available */ }
  },
})
const drafts = new Map<string, Record<string, string>>()
export function setAgentRequestDraft(id: string, draft: Record<string, string>): void { drafts.set(id, { ...draft }); publish() }
const emptyDraft: Record<string, string> = {}
export function useAgentRequestActions() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => version, () => 0)
  const key = scopeKey()
  useEffect(() => {
    if (!key || restoredScope === key) return
    restoredScope = key
    try {
      const text = localStorage.getItem(key)
      if (!text || text.length > 16_384) return
      const ids: unknown = JSON.parse(text)
      if (Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === 'string' && /^agent-request-[a-f0-9]{32}$/.test(id))) actions.restore(ids)
    } catch { /* unusable browser metadata grants no authority */ }
  }, [key])
  return { attempts: actions.all(), creating, draft: (id: string) => drafts.get(id) ?? emptyDraft }
}
onAccountSwitch(() => {
  restoredScope = undefined; creating = false; drafts.clear(); actions.clear()
})
export async function sendAgentRequest(input: AgentRequestCreate): Promise<void> {
  if (creating || actions.all().some(row => row.action?.kind === 'create' && !['settled', 'refused'].includes(row.state))) return
  const who = identity(), generation = accountGeneration()
  if (!who) return
  const frozen = structuredClone(input), key = crypto.randomUUID()
  creating = true; publish()
  try {
    const id = await agentRequestId(who.tenant.id, who.user.id, key)
    if (generation !== accountGeneration()) return
    await actions.begin({ kind: 'create', id, key, input: frozen })
    if (generation === accountGeneration() && actions.get(id)?.state === 'settled') drafts.delete('create')
  } finally { if (generation === accountGeneration()) { creating = false; publish() } }
}
export function decideRequest(id: string, input: AgentRequestDecision): void {
  void actions.begin({ kind: 'decision', id, input })
}
export const checkAgentRequest = (id: string) => { void actions.check(id) }
export const dismissAgentRequestAttempt = (id: string) => actions.dismiss(id)
