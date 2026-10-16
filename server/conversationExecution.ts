/** The server-owned lifecycle of one admitted conversation turn. HTTP opens a
 * view; a background initiator may omit it. Both use the same model/tool loop,
 * live-turn registry, provenance and per-call consent proposals. Admission and
 * caller authorization belong to the initiating workflow, before this function.
 */
import type { Agent, Message, ModelInfo, ReplyStreamEvent, Session } from '../contract/index.ts'
import type { ProviderConfig } from './data/providers.ts'
import { generateReply, type ReplyHistoryTurn, type ReplySession } from './generate.ts'
import { relayReply } from './relay.ts'
import type { SseChannel } from './http/sse.ts'
import type { ApiToolRuntime } from './model/apiTools.ts'
import { conversationContext } from './conversationContext.ts'
import { store, type GenerationOutcome } from './store/index.ts'
import { turns } from './turns.ts'

export interface ConversationTurnResult {
  outcome: GenerationOutcome
  message?: Message
}

export interface ConversationTurnInput {
  session: ReplySession
  known?: Session
  agent: Agent
  provider: ProviderConfig
  providerId: string
  modelId?: string
  modelInfo?: ModelInfo
  /** Resolved and frozen by interactive admission. Background initiators omit
   * this instead of inheriting some person's composer preference. */
  effort?: string
  tenantId: string
  /** Authenticated human actor for interactive turns; background Dispatch and
   * Routine initiators deliberately leave this absent. */
  actorUserId?: string
  text: string
  history: ReplyHistoryTurn[]
  persist: boolean
  reusePersistedUser?: boolean
  idempotencyKey?: string
  apiRuntime: ApiToolRuntime
  /** One explicit Project-work draft: frozen prompt only, with no ambient
   * registry/context lookup, tools, or model-driven effects. Later ordinary
   * conversation turns are separate owner-controlled acts. Endpoint only. */
  projectWorkDraft?: boolean
  openView?: () => SseChannel
  /** A durable initiator commits its job outcome and assistant message in one
   * synchronous transaction. Ordinary turns use appendMessage instead. Called
   * once, including failure/cancellation; a failed commit is never retried. */
  commit?: (result: ConversationTurnResult) => void
}

export function startConversationTurn(input: ConversationTurnInput) {
  const { session, known, agent, provider, providerId, modelId, tenantId, text, persist, actorUserId } = input
  if (input.projectWorkDraft && provider.kind === 'session') throw new Error('Project drafts require an endpoint provider')
  const ac = new AbortController()
  const active = turns.start(session.id, () => ac.abort(), input.idempotencyKey)
  if (!active) return undefined

  let channel: SseChannel | undefined
  try {
    if (persist && !input.reusePersistedUser) {
      store.appendMessage(session.id, { id: store.mintMessageId('user'), role: 'user', content: text },
        actorUserId ? { actorUserId } : undefined)
    } else if (persist && known) {
      store.emit({ type: 'session.updated', session: known })
    }
    channel = input.openView?.()
  } catch (error) {
    turns.finish(active.id)
    throw error
  }

  const emit = (event: ReplyStreamEvent) => {
    const seq = turns.append(active.id, event)
    channel?.send(event.type === 'message.delta' && seq !== undefined ? { ...event, seq } : event)
  }
  let messageId = ''
  let streamedText = ''
  let outcome: GenerationOutcome = 'error'
  let committed = false
  const stamp = (message: Message): Message => ({
    ...message, agentId: agent.id, providerId, ...(modelId ? { modelId } : {}),
  })
  const commit = (message?: Message) => {
    if (committed) return
    committed = true
    if (input.commit) input.commit({ outcome, ...(message ? { message } : {}) })
    else if (persist && message) store.appendMessage(session.id, message, actorUserId ? { actorUserId } : undefined)
    if (persist && message) turns.markPersisted(active.id, message.id)
  }
  const handlers = {
    onUsage: (usage: { inputTokens: number; outputTokens: number }) => store.recordUsage(usage.inputTokens, usage.outputTokens, tenantId),
    onStart: (id: string) => {
      messageId = id
      emit({ type: 'message.start', sessionId: session.id, turnId: active.id, message: { id, role: 'assistant', content: '' } })
    },
    onDelta: (delta: string) => {
      streamedText += delta
      emit({ type: 'message.delta', sessionId: session.id, messageId, text: delta })
    },
  }

  const finished = (async () => {
    try {
      const { commons, contexts, externalMcpConnections } = input.projectWorkDraft
        ? { commons: undefined, contexts: [], externalMcpConnections: [] }
        : conversationContext(session.id, tenantId, actorUserId)
      const result = provider.kind === 'session'
        ? await relayReply(session, agent, text, handlers, ac.signal, store.relay, providerId, commons, contexts, input.history, input.apiRuntime, externalMcpConnections)
        : await generateReply(session, agent, text, handlers, ac.signal, provider, commons, contexts,
          input.projectWorkDraft ? undefined : input.apiRuntime,
          { externalMcpConnections, effort: input.effort, modelInfo: input.modelInfo,
            ...(input.projectWorkDraft ? { toolPolicy: 'none' as const } : {}) }, input.history)
      outcome = result.outcome
      const message = stamp(result.message)
      if (message.relationActions?.length) emit({ type: 'message.relations', sessionId: session.id, messageId: message.id, relationActions: message.relationActions })
      if (message.escalation) emit({ type: 'message.escalation', sessionId: session.id, messageId: message.id, escalation: message.escalation })
      if (message.toolActivities?.length) emit({ type: 'message.toolActivity', sessionId: session.id, messageId: message.id, toolActivities: message.toolActivities })
      commit(message)
      emit({ type: 'message.end', sessionId: session.id, message })
    } catch {
      outcome = ac.signal.aborted ? 'aborted' : 'error'
      if (ac.signal.aborted && messageId && !committed) {
        const partial = stamp({ id: messageId, role: 'assistant', content: streamedText })
        commit(partial)
        emit({ type: 'message.end', sessionId: session.id, message: partial })
      }
    } finally {
      try {
        commit()
        store.recordGenerationOutcome(outcome)
      } finally {
        turns.finish(active.id)
        channel?.close()
      }
    }
  })()
  return { turn: active, finished }
}
