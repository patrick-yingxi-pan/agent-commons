import type { AgentRequestCreate, AgentRequestDecision, AgentRequestOptions, AgentRequestReplyReview, AgentRequestReview, AgentRequestView } from '../../contract/agentRequests.ts'
import { apiGet, apiPost, type ApiMutationOptions } from './client.ts'
import { invalidate, peek, setData, useQuery } from './cache.ts'
import { keys, paths } from './keys.ts'
import { privateOptions } from './agentRequestList.ts'
export { useAgentRequests } from './agentRequestList.ts'

export function acceptAgentRequest(row: AgentRequestView, id = row.id): AgentRequestView {
  if (row.id !== id || !Number.isSafeInteger(row.revision) || row.revision < 1 || !['owner', 'requester'].includes(row.role)) {
    throw new Error('The response did not identify this Agent request.')
  }
  const previous = peek<AgentRequestView>(keys.agentRequest(id))
  if (!previous || previous.revision <= row.revision) {
    setData(keys.agentRequest(id), row)
    // The completion event can precede this pending acknowledgement. setData
    // fences its in-flight read, so start a fresh read after accepting pending
    // work rather than losing completion until the fallback poll. Never replay
    // a decision or infer completion from the acknowledgement itself.
    if (row.status === 'running' || row.execution?.status === 'pending' ||
        row.argumentDraft?.status === 'pending' || row.replyDraft?.status === 'pending') {
      invalidate(keys.agentRequest(id))
    }
  }
  invalidate(keys.agentRequests)
  invalidate(keys.agentRequestReview(id))
  invalidate(keys.agentRequestReplyReview(id))
  return row
}
export async function readAgentRequest(id: string, options: ApiMutationOptions = {}): Promise<AgentRequestView> {
  const row = await apiGet<AgentRequestView>(paths.agentRequest(id), privateOptions(options))
  if (row.id !== id) throw new Error('The response addressed another Agent request.')
  return row
}
export function useAgentRequestOptions() {
  return useQuery<AgentRequestOptions>(keys.agentRequestOptions, () => apiGet(paths.agentRequestOptions, privateOptions()), true, true)
}
export function useAgentRequest(id: string) {
  return useQuery(keys.agentRequest(id), () => readAgentRequest(id), true, true)
}
export function useAgentRequestReview(id: string, enabled: boolean) {
  return useQuery<AgentRequestReview>(keys.agentRequestReview(id), () => apiGet(paths.agentRequestReview(id), privateOptions()), enabled, true)
}
export function useAgentRequestReplyReview(id: string, enabled: boolean) {
  return useQuery<AgentRequestReplyReview>(keys.agentRequestReplyReview(id),
    () => apiGet(paths.agentRequestReplyReview(id), privateOptions()), enabled, true)
}
export async function createAgentRequest(input: AgentRequestCreate, id: string, options: ApiMutationOptions): Promise<AgentRequestView> {
  return acceptAgentRequest(await apiPost<AgentRequestView>(paths.agentRequests, input,
    privateOptions(options)), id)
}
export async function decideAgentRequest(id: string, input: AgentRequestDecision, options: ApiMutationOptions): Promise<AgentRequestView> {
  try {
    const row = await apiPost<AgentRequestView>(paths.agentRequestDecision(id), input, privateOptions(options))
    if (row.revision <= input.expectedRevision) throw new Error('The response did not acknowledge this request decision.')
    return acceptAgentRequest(row, id)
  } catch (error) {
    // A conflict can mean another pane already decided; only fresh GETs may recover it.
    refreshAgentRequests(id)
    throw error
  }
}
export function refreshAgentRequests(id?: string): void {
  invalidate(keys.agentRequests)
  invalidate(keys.agentRequestOptions)
  if (id) { invalidate(keys.agentRequest(id)); invalidate(keys.agentRequestReview(id)); invalidate(keys.agentRequestReplyReview(id)) }
}
/** Browser twin of the durable person-and-namespace request identity. */
export async function agentRequestId(tenantId: string, userId: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(['agent-request-v1', tenantId, userId, key]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `agent-request-${[...digest].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
