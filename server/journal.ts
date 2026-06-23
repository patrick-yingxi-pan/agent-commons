/** ── The effect journal (system of record, D2) ──────────────────────────────
 *  Each agent is the authoritative system of record for its own host's effects
 *  (Option B). This models that log + the server's *projection* of it:
 *
 *   • `append` records an effect on an agent's authoritative log, idempotent by
 *     `commandId` (the idempotency key). A re-append of a seen command returns the
 *     recorded effect without duplicating — the at-least-once delivery guarantee.
 *   • `agentSeq` is the agent's monotonic per-host ordering.
 *   • The **projection cursor** is how far the server has reconciled an agent's
 *     log. A relayed invoke appends *and* reconciles (the common, online case). A
 *     fast-path or offline effect reaches the server later via `merge` (the outbox
 *     replay), then reconciles. Either way `agent.effect` is emitted as effects
 *     become projected, so every client converges on the server's record.
 *
 *  In the mock the agent runtime and this journal are co-located, so the journal
 *  *is* the agent's authoritative log; a real deployment runs the log inside the
 *  agent and this becomes the server's reconciled projection of it. The clock is
 *  injectable for deterministic tests. */
import type { CapabilityEffect, EffectReport, ServerEvent } from '../contract/index.ts'

interface AgentLog {
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

export class AgentJournal {
  private readonly logs = new Map<string, AgentLog>()
  private readonly emit: (e: ServerEvent) => void
  private readonly now: () => number

  constructor(emit: (e: ServerEvent) => void, now: () => number = () => Date.now()) {
    this.emit = emit
    this.now = now
  }

  private logFor(agentId: string): AgentLog {
    let log = this.logs.get(agentId)
    if (!log) {
      log = { effects: [], byCommand: new Map(), seq: 0, cursor: 0 }
      this.logs.set(agentId, log)
    }
    return log
  }

  /** Mint a command id when a caller didn't supply one (no cross-retry dedup, but
   *  the effect still records cleanly). */
  mintCommandId(): string {
    return mintCommandId(this.now)
  }

  /** The recorded effect for a command id, if any — the idempotency lookup. */
  find(agentId: string, commandId: string): CapabilityEffect | undefined {
    return this.logs.get(agentId)?.byCommand.get(commandId)
  }

  /** Append an effect to the agent's authoritative log, idempotent by commandId.
   *  Returns the effect (the prior one if the command was already recorded) and
   *  whether it was a duplicate. Does NOT advance the projection cursor. */
  append(agentId: string, input: EffectInput): { effect: CapabilityEffect; deduped: boolean } {
    const log = this.logFor(agentId)
    const prior = log.byCommand.get(input.commandId)
    if (prior) return { effect: prior, deduped: true }
    const effect: CapabilityEffect = {
      commandId: input.commandId,
      agentId,
      capability: input.capability,
      target: input.target,
      output: input.output,
      agentSeq: (log.seq += 1),
      at: input.at ?? this.now(),
    }
    log.effects.push(effect)
    log.byCommand.set(effect.commandId, effect)
    return { effect, deduped: false }
  }

  /** The agent's authoritative log (read-through), optionally the tail after a
   *  sequence number. */
  log(agentId: string, sinceSeq = 0): CapabilityEffect[] {
    return (this.logs.get(agentId)?.effects ?? []).filter((e) => e.agentSeq > sinceSeq)
  }

  /** Effects recorded but not yet projected (agentSeq beyond the cursor). */
  pending(agentId: string): CapabilityEffect[] {
    const log = this.logs.get(agentId)
    if (!log) return []
    return log.effects.filter((e) => e.agentSeq > log.cursor)
  }

  cursor(agentId: string): number {
    return this.logs.get(agentId)?.cursor ?? 0
  }

  /** Advance the projection cursor to the head of the log; return the effects
   *  newly projected (the reconciliation delta) and emit `agent.effect` for each. */
  reconcile(agentId: string): CapabilityEffect[] {
    const log = this.logs.get(agentId)
    if (!log) return []
    const newly = log.effects.filter((e) => e.agentSeq > log.cursor)
    log.cursor = log.seq
    for (const effect of newly) this.emit({ type: 'agent.effect', effect })
    return newly
  }

  /** Merge a batch of effects an agent reports out-of-band (its outbox replay),
   *  idempotent by commandId. Returns the effects that were new (already-recorded
   *  ones are skipped). Does not project — the caller reconciles after. */
  merge(agentId: string, batch: EffectReport[]): CapabilityEffect[] {
    const added: CapabilityEffect[] = []
    for (const report of batch) {
      const { effect, deduped } = this.append(agentId, report)
      if (!deduped) added.push(effect)
    }
    return added
  }
}
