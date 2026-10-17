import { formatUsagePercent, withLiveMessages, type ContextUsage, type UsageModelRef, type UsageSnapshot } from '../../contract/usage.ts'
import type { QueryState } from '../api/cache.ts'

export function estimatedContextTokens(context: ContextUsage): number {
  return context.segments.filter((segment) => !segment.deferred && segment.id !== 'free')
    .reduce((total, segment) => total + segment.rawTokens, 0)
}

export function contextPercentLabel(context: ContextUsage): string {
  return context.windowTokens === undefined ? '—' : formatUsagePercent(estimatedContextTokens(context), context.windowTokens)
}

type UsageView = {
  phase: 'loading' | 'error' | 'ready'
  title: string
  usage?: UsageSnapshot
  updating?: boolean
}

/** Missing/failed reads must never impersonate zero usage. Account-wide limits
 * remain separate from the selected model's partial context estimate. */
export function usagePresentation(
  query: Pick<QueryState<UsageSnapshot>, 'status' | 'data'>,
  messageTokens?: number,
  model?: UsageModelRef & { windowTokens?: number },
): UsageView {
  if (query.status === 'error') return { phase: 'error', title: 'Usage — unavailable' }
  const snapshot = query.data
  if (!snapshot) return { phase: 'loading', title: 'Usage — loading' }
  const liveTokens = messageTokens ?? snapshot.context.segments.find((segment) => segment.id === 'messages')?.rawTokens ?? 0
  const usage = messageTokens === undefined && !model ? snapshot : {
    ...snapshot,
    context: withLiveMessages(snapshot.context, liveTokens, model ? { window: model.windowTokens } : undefined),
    ...(model ? { model } : {}),
  }
  const capacity = usage.context.windowTokens === undefined
    ? 'window unknown' : `${contextPercentLabel(usage.context)} of catalog window`
  const updating = query.status === 'loading'
  return {
    phase: 'ready', usage, updating,
    title: `Usage — estimated context ${usage.context.used} tokens (${capacity})${updating ? ' — updating' : ''}`,
  }
}
