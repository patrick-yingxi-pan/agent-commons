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
