/** Strict additive admission for real Dispatch state. Legacy simulation rows
 * keep their old format; a real job always joins one same-owner conversation.
 * Historical model bindings need not remain in today's mutable registries. */
import { parseRealDispatchInput } from '../contract/dispatchExecution.ts'
import { parseProjectWorkDraftSource } from '../contract/projectWorkDraft.ts'
import { parseProjectWorkMcpDraftPreview } from '../contract/projectWorkMcpDraft.ts'
import { dispatchSessionId } from './dispatchIdentity.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function validDispatchState(runs: unknown, sessions: unknown, retired: unknown = []): boolean {
  if (runs === undefined) return true
  if (!Array.isArray(runs) || !Array.isArray(sessions) || !Array.isArray(retired)) return false
  const ids = new Set<string>()
  const sessionIds = new Set<string>()
  const realIds = new Set(runs.filter((run) => record(run) && run.execution !== undefined).map((run) => run.id))
  for (const run of runs) {
    if (!record(run)) return false
    if (run.execution === undefined) {
      if (realIds.has(run.id)) return false
      continue
    }
    const execution = run.execution
    if (!record(execution) || typeof run.id !== 'string' || !/^d-new-[a-f0-9]{24}$/.test(run.id) ||
      ids.has(run.id) || typeof run.tenantId !== 'string' || !run.tenantId ||
      !Number.isSafeInteger(run.startedAt) || (run.startedAt as number) < 0 ||
      typeof run.detail !== 'string' || execution.kind !== 'conversation' ||
      execution.sessionId !== dispatchSessionId(run.id) || retired.includes(execution.sessionId) ||
      typeof execution.sessionId !== 'string' || sessionIds.has(execution.sessionId)) return false
    if (Object.keys(execution).some((key) => !['kind', 'sessionId', 'agentId', 'providerId', 'modelId', 'state', 'messageId', 'projectWork', 'mcpProposal'].includes(key))) return false
    if (Object.hasOwn(execution, 'projectWork') && !parseProjectWorkDraftSource(execution.projectWork)) return false
    if (Object.hasOwn(execution, 'mcpProposal') &&
      (!execution.projectWork || !parseProjectWorkMcpDraftPreview(execution.mcpProposal))) return false
    if (!parseRealDispatchInput({
      title: run.title, detail: run.detail,
      execution: { agentId: execution.agentId, providerId: execution.providerId, modelId: execution.modelId },
    })) return false
    const owners = sessions.filter((session) => record(session) && session.id === execution.sessionId)
    if (owners.length !== 1 || owners[0].tenantId !== run.tenantId) return false
    const state = execution.state
    if (!['running', 'replied', 'failed', 'interrupted', 'cancelled'].includes(state as string)) return false
    if (run.status !== (state === 'running' ? 'running' : state === 'replied' ? 'done' : 'failed')) return false
    if (execution.messageId !== undefined && (typeof execution.messageId !== 'string' || !execution.messageId.trim() || execution.messageId.length > 200)) return false
    if (state === 'replied' && execution.messageId === undefined) return false
    if ((state === 'running' || state === 'interrupted') && execution.messageId !== undefined) return false
    ids.add(run.id)
    sessionIds.add(execution.sessionId)
  }
  return true
}
