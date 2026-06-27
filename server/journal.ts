/** ── The effect journal (system of record, D2) ──────────────────────────────
 *  Each runner is the authoritative system of record for its own host's effects
 *  (Option B). This models that log + the server's *projection* of it:
 *
 *   • `append` records an effect on a runner's authoritative log, idempotent by
 *     `commandId` (the idempotency key). A re-append of a seen command returns the
 *     recorded effect without duplicating — the at-least-once delivery guarantee.
 *   • `runnerSeq` is the runner's monotonic per-host ordering.
 *   • The **projection cursor** is how far the server has reconciled a runner's
 *     log. A relayed invoke appends *and* reconciles (the common, online case). A
 *     fast-path or offline effect reaches the server later via `merge` (the outbox
 *     replay), then reconciles. Either way `runner.effect` is emitted as effects
 *     become projected, so every client converges on the server's record.
 *
 *  In the mock the runner runtime and this journal are co-located, so the journal
 *  *is* the runner's authoritative log; a real deployment runs the log inside the
 *  runner and this becomes the server's reconciled projection of it. The clock is
 *  injectable for deterministic tests. */
import type { CapabilityEffect, EffectReport, ServerEvent } from '../contract/index.ts'

interface RunnerLog {
  effects: CapabilityEffect[]
  byCommand: Map<string, CapabilityEffect>
  seq: number
  cursor: number
}

export interface EffectInput {
  commandId: string
  capability: CapabilityEffect['capability']
  target: string
  output: unknown
  at?: number
}

let mintSeq = 0
function mintCommandId(now: () => number): string {
  return `cmd-${(mintSeq += 1).toString(36)}-${now().toString(36)}`
}

export class RunnerJournal {
  private readonly logs = new Map<string, RunnerLog>()
  private readonly emit: (e: ServerEvent) => void
  private readonly now: () => number

  constructor(emit: (e: ServerEvent) => void, now: () => number = () => Date.now()) {
    this.emit = emit
    this.now = now
  }

  private logFor(runnerId: string): RunnerLog {
    let log = this.logs.get(runnerId)
    if (!log) {
      log = { effects: [], byCommand: new Map(), seq: 0, cursor: 0 }
      this.logs.set(runnerId, log)
    }
    return log
  }

  /** Mint a command id when a caller didn't supply one (no cross-retry dedup, but
   *  the effect still records cleanly). */
  mintCommandId(): string {
    return mintCommandId(this.now)
  }

  /** The recorded effect for a command id, if any — the idempotency lookup. */
  find(runnerId: string, commandId: string): CapabilityEffect | undefined {
    return this.logs.get(runnerId)?.byCommand.get(commandId)
  }

  /** Append an effect to the runner's authoritative log, idempotent by commandId.
   *  Returns the effect (the prior one if the command was already recorded) and
   *  whether it was a duplicate. Does NOT advance the projection cursor. */
  append(runnerId: string, input: EffectInput): { effect: CapabilityEffect; deduped: boolean } {
    const log = this.logFor(runnerId)
    const prior = log.byCommand.get(input.commandId)
    if (prior) return { effect: prior, deduped: true }
    const effect: CapabilityEffect = {
      commandId: input.commandId,
      runnerId,
      capability: input.capability,
      target: input.target,
      output: input.output,
      runnerSeq: (log.seq += 1),
      at: input.at ?? this.now(),
    }
    log.effects.push(effect)
    log.byCommand.set(effect.commandId, effect)
    return { effect, deduped: false }
  }

  /** The runner's authoritative log (read-through), optionally the tail after a
   *  sequence number. */
  log(runnerId: string, sinceSeq = 0): CapabilityEffect[] {
    return (this.logs.get(runnerId)?.effects ?? []).filter((e) => e.runnerSeq > sinceSeq)
  }

  /** Effects recorded but not yet projected (runnerSeq beyond the cursor). */
  pending(runnerId: string): CapabilityEffect[] {
    const log = this.logs.get(runnerId)
    if (!log) return []
    return log.effects.filter((e) => e.runnerSeq > log.cursor)
  }

  cursor(runnerId: string): number {
    return this.logs.get(runnerId)?.cursor ?? 0
  }

  /** Advance the projection cursor to the head of the log; return the effects
   *  newly projected (the reconciliation delta) and emit `runner.effect` for each. */
  reconcile(runnerId: string): CapabilityEffect[] {
    const log = this.logs.get(runnerId)
    if (!log) return []
    const newly = log.effects.filter((e) => e.runnerSeq > log.cursor)
    log.cursor = log.seq
    for (const effect of newly) this.emit({ type: 'runner.effect', effect })
    return newly
  }

  /** Merge a batch of effects a runner reports out-of-band (its outbox replay),
   *  idempotent by commandId. Returns the effects that were new (already-recorded
   *  ones are skipped). Does not project — the caller reconciles after. */
  merge(runnerId: string, batch: EffectReport[]): CapabilityEffect[] {
    const added: CapabilityEffect[] = []
    for (const report of batch) {
      const { effect, deduped } = this.append(runnerId, report)
      if (!deduped) added.push(effect)
    }
    return added
  }
}
