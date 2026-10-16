import type { EndpointProtocol, ModelInfo } from '../../contract/providers.ts'

/** Exact selected-model metadata, not a name, effort label or generic thinking
 * flag, enables adaptive Messages requests. Unknown support leaves the endpoint
 * default unchanged. This adds no budget and never invents a legacy token cap. */
export function replyThinking(
  modelId: string,
  protocol: EndpointProtocol | undefined,
  modelInfo?: ModelInfo,
): { type: 'adaptive' } | undefined {
  if ((protocol !== undefined && protocol !== 'anthropic-messages') || modelInfo?.id !== modelId ||
    modelInfo.capabilities?.thinking === false || modelInfo.capabilities?.adaptiveThinking !== true) return undefined
  return { type: 'adaptive' }
}
