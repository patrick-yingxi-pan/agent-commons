import type { EndpointProtocol } from './providers.ts'

/** App request bounds, not model capabilities or a monetary/whole-turn quota.
 * New forms make the default explicit; old connections retain their old cap. */
export const DEFAULT_REPLY_OUTPUT_TOKENS = 8192
export const MIN_REPLY_OUTPUT_TOKENS = 128
export const MAX_REPLY_OUTPUT_TOKENS = 65536

export function isReplyOutputTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= MIN_REPLY_OUTPUT_TOKENS && value <= MAX_REPLY_OUTPUT_TOKENS
}

export function resolveReplyOutputTokens(config: { protocol?: EndpointProtocol; replyOutputTokens?: number }): number {
  if (config.replyOutputTokens === undefined) return config.protocol === 'openai-responses' ? 8192 : 1024
  if (!isReplyOutputTokens(config.replyOutputTokens)) throw new Error('replyOutputTokens must be an integer from 128 to 65536.')
  return config.replyOutputTokens
}
