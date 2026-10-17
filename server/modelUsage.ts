/** Completed model-call accounting is independent of the enclosing operation's
 * success. Persist each report before tools or another model request; returned
 * totals are informational and must not be recorded again by the caller. */
export interface ModelUsage { inputTokens: number; outputTokens: number }
export type ModelUsageHandler = (usage: ModelUsage) => void

export class UsageRecordingError extends Error {
  constructor(options?: ErrorOptions) {
    super('Model usage could not be recorded. No further model work was started.', options)
    this.name = 'UsageRecordingError'
  }
}

/** Validate and normalize one settled provider usage payload. Native Messages
 * reports uncached `input_tokens` separately from cache creation/read tokens;
 * Responses has already folded cached input into `input_tokens`, so callers
 * using that adapter set `inputIncludesCached` and do not add it again. */
export function normalizeModelUsage(
  usage: unknown,
  options: { inputIncludesCached?: boolean } = {},
): ModelUsage {
  try {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new RangeError()
    const row = usage as Record<string, unknown>
    const inputTokens = row.input_tokens
    const outputTokens = row.output_tokens
    if (!Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0 ||
        !Number.isSafeInteger(outputTokens) || (outputTokens as number) < 0) throw new RangeError()

    const cacheTokens = (key: string): number => {
      if (!Object.hasOwn(row, key) || row[key] === null) return 0
      const value = row[key]
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError()
      return value as number
    }
    const totalInput = options.inputIncludesCached
      ? inputTokens as number
      : (inputTokens as number) + cacheTokens('cache_creation_input_tokens') + cacheTokens('cache_read_input_tokens')
    if (!Number.isSafeInteger(totalInput) || !Number.isSafeInteger(totalInput + (outputTokens as number))) throw new RangeError()
    return { inputTokens: totalInput, outputTokens: outputTokens as number }
  } catch (cause) {
    throw new UsageRecordingError({ cause })
  }
}

export function createModelUsageRecorder(onUsage?: ModelUsageHandler) {
  let total: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  let failed = false
  return {
    record(usage: ModelUsage): void {
      if (failed) throw new UsageRecordingError()
      try {
        const { inputTokens, outputTokens } = usage
        const next = { inputTokens: total.inputTokens + inputTokens, outputTokens: total.outputTokens + outputTokens }
        if ([inputTokens, outputTokens, inputTokens + outputTokens, next.inputTokens, next.outputTokens, next.inputTokens + next.outputTokens]
          .some((value) => !Number.isSafeInteger(value) || value < 0)) throw new RangeError('Invalid model token counts.')
        // The recorder cannot mutate the returned accounting or another report.
        onUsage?.({ inputTokens, outputTokens })
        total = next
      } catch (cause) {
        failed = true
        throw new UsageRecordingError({ cause })
      }
    },
    snapshot(): ModelUsage { return { ...total } },
  }
}
