/** Resolve the honest execution posture of a dial-out Model provider.
 *
 * Development deliberately boots the wire-compatible local mock. Release
 * profiles set `MODEL_INLINE=0`, so an inherited endpoint is unavailable until
 * the operator supplies the ambient Anthropic connection. A provider with its
 * own endpoint is configured independently; when it names a credential env var,
 * that variable must still exist after restart.
 */
import type { ModelExecution } from '../../contract/index.ts'

type Env = Record<string, string | undefined>
type EndpointConfig = { protocol?: string; baseURL?: string; apiKeyEnv?: string; model?: string }

function loopback(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host === '::1'
  } catch {
    return false
  }
}

export function endpointExecution(config: EndpointConfig = {}, env: Env = process.env): ModelExecution {
  const protocol = config.protocol ?? 'anthropic-messages'
  if (protocol !== 'anthropic-messages' && protocol !== 'openai-responses') return 'unconfigured'
  // Responses does not inherit Anthropic's ambient endpoint, model, key, or the
  // development Messages mock. It is runnable only from a complete explicit
  // provider connection.
  if (protocol === 'openai-responses' && (!config.baseURL?.trim() || !config.model?.trim())) return 'unconfigured'

  if (config.baseURL) {
    return config.apiKeyEnv && !env[config.apiKeyEnv]?.trim() ? 'unconfigured' : 'configured'
  }

  const ambientURL = env.ANTHROPIC_BASE_URL?.trim()
  if (env.MODEL_INLINE !== '0' && (!ambientURL || loopback(ambientURL))) return 'mock'
  if (!ambientURL) return 'unconfigured'
  if (!loopback(ambientURL) && !env.ANTHROPIC_API_KEY?.trim()) return 'unconfigured'
  return 'configured'
}
