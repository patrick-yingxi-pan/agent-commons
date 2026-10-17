/** Keep the SDK's Messages wire/parser, but own pre-response retry waits so Stop
 * and the original deadline cover backoff as well as the active request. */
import Anthropic from '@anthropic-ai/sdk'
import { positiveNumberEnv } from '../env.ts'
import { EndpointHttpError, EndpointRetryWaitError, fetchEndpointWithRetry } from './endpointRequest.ts'

type Options = { signal?: AbortSignal | null }
type Request = Anthropic.MessageCreateParamsNonStreaming

export function anthropicMessagesClient(baseURL: string, key: string, fetcher: typeof fetch, maxRetries: number) {
  const native = new Anthropic({ baseURL, apiKey: key, maxRetries: 0 })
  const operation = (options: Options = {}) => {
    const signal = options.signal ?? AbortSignal.timeout(positiveNumberEnv(process.env.MODEL_TIMEOUT_MS, 60_000))
    // The SDK replaces aborted fetch errors and can wrap other transport errors.
    // Retain only our private typed failures, per operation (never on the shared
    // client), so a deadline cannot erase an unfulfilled server wait's policy.
    let failure: EndpointHttpError | EndpointRetryWaitError | undefined
    const client = native.withOptions({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        try {
          return await fetchEndpointWithRetry(url, {
            ...init,
            signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
          }, fetcher, maxRetries)
        } catch (error) {
          if (error instanceof EndpointHttpError || error instanceof EndpointRetryWaitError) failure = error
          throw error
        }
      },
    })
    const settle = async <T>(result: PromiseLike<T>): Promise<T> => {
      try { return await result }
      catch (error) { throw failure ?? error }
    }
    return { client, signal, settle }
  }
  return {
    models: {
      list(params: { limit: number; after_id?: string }, options?: Options): Promise<unknown> {
        const { client, signal, settle } = operation(options)
        // Preserve malformed raw pagination instead of SDK Page defaults.
        return settle(client.get<unknown>('/v1/models', { query: params, signal }))
      },
    },
    messages: {
      create(body: Request, options?: Options) {
        const { client, signal, settle } = operation(options)
        return settle(client.messages.create(body, { signal }))
      },
      stream(body: Request, options?: Options) {
        const { client, signal, settle } = operation(options)
        const stream = client.messages.stream(body, { signal })
        return {
          on: stream.on.bind(stream),
          finalMessage: () => settle(stream.finalMessage()),
        }
      },
    },
  }
}
