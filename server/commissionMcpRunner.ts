/** Bounded process-local wakeup for durable, person-approved Commission work.
 * The store remains authoritative: this runner only projects candidates and
 * calls the one-shot executor. It never retries represented claims. */
export interface CommissionMcpQueueCandidate {
  commissionId: string
  tenantId: string
  userId: string
  projectId: string
  agentId: string
  itemId: string
}

export interface CommissionMcpRunnerPort {
  candidates(): CommissionMcpQueueCandidate[]
  run(candidate: CommissionMcpQueueCandidate, signal: AbortSignal): Promise<unknown>
}

export interface CommissionMcpRunnerTimers {
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>
  clearInterval(handle: ReturnType<typeof setInterval>): void
}

export interface CommissionMcpLegacyDispatchRegistry {
  isWorkBlocked(projectId: string, itemId: string): boolean
  claim(projectId: string, itemId: string): unknown
}

/** Legacy synchronous fixture dispatch may not consume work that belongs to a
 * durable Commission history or an explicit-restore fence. */
export function commissionMcpLegacyDispatchBlocked(
  registry: CommissionMcpLegacyDispatchRegistry, projectId: string, itemId: string,
): boolean {
  return registry.isWorkBlocked(projectId, itemId) || !!registry.claim(projectId, itemId)
}

const systemTimers: CommissionMcpRunnerTimers = { setInterval, clearInterval }
const keyOf = (candidate: CommissionMcpQueueCandidate): string =>
  JSON.stringify([candidate.projectId, candidate.itemId])

export function createCommissionMcpRunner(
  port: CommissionMcpRunnerPort,
  options: { intervalMs?: number; timers?: CommissionMcpRunnerTimers; onError?: (error: unknown) => void } = {},
) {
  const intervalMs = options.intervalMs ?? 5_000
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 60_000) {
    throw new Error('Invalid Commission MCP queue interval.')
  }
  const timers = options.timers ?? systemTimers
  const active = new Map<string, { candidate: CommissionMcpQueueCandidate; controller: AbortController; promise: Promise<void> }>()
  let timer: ReturnType<typeof setInterval> | undefined
  let started = false
  let stopped = false
  let draining = false

  const drain = (): void => {
    if (stopped || !started || draining) return
    draining = true
    try {
      for (const candidate of port.candidates()) {
        if (stopped || active.size >= 4) break
        const key = keyOf(candidate)
        if (active.has(key)) continue
        const calls = [...active.values()].map(value => value.candidate)
        const tenantCalls = calls.filter(call => call.tenantId === candidate.tenantId)
        if (tenantCalls.length >= 2 || tenantCalls.some(call => call.agentId === candidate.agentId)) continue
        const controller = new AbortController()
        const entry = { candidate, controller, promise: Promise.resolve() }
        active.set(key, entry)
        entry.promise = Promise.resolve().then(() => port.run(candidate, controller.signal))
          // The executor durably represents any admitted attempt. Rejections
          // without a claim (for example a shared-capacity refusal) are left
          // for the next bounded tick; there is no immediate retry loop.
          .then(() => {}, error => { options.onError?.(error) })
          .finally(() => {
            if (active.get(key) === entry) active.delete(key)
          })
      }
    } catch (error) {
      options.onError?.(error)
    } finally {
      draining = false
    }
  }

  return {
    start(): void {
      if (started || stopped) return
      started = true
      timer = timers.setInterval(drain, intervalMs)
      ;(timer as unknown as { unref?: () => void }).unref?.()
      drain()
    },
    /** Stop admission, abort preparation, and keep every active slot occupied
     * until the executor promise settles, even when the executor ignores abort. */
    async stop(): Promise<void> {
      if (!stopped) {
        stopped = true
        if (timer !== undefined) timers.clearInterval(timer)
        timer = undefined
        for (const entry of active.values()) entry.controller.abort()
      }
      await Promise.allSettled([...active.values()].map(entry => entry.promise))
    },
    tick(): void { drain() },
    activeCount(): number { return active.size },
  }
}
