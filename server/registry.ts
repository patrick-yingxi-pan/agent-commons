/** ── The native-runner registry ─────────────────────────────────────────────
 *  The broker's live view of which runners are connected and what each can do on
 *  its host (see docs/capability-broker-architecture.md). This is the control
 *  plane's registry: runners enroll/reconnect, heartbeat, re-advertise grants, and
 *  disconnect; every change broadcasts an ambient `runner.*` event.
 *
 *  Identity is **durable** (D4): a disconnect marks a runner `offline` but keeps
 *  its record, so a reconnect re-binds to the same id and the user's references to
 *  it stay stable. The clock is injectable so tests are deterministic. */
import type { Runner, RunnerCapability, CapabilityType, ServerEvent } from '../contract/index.ts'

/** The data a runner supplies to enroll or reconnect. */
export interface RegisterInput {
  /** Omit to mint a new identity (first enrollment); supply a known id to reconnect. */
  id?: string
  label: string
  host: string
  capabilities: RunnerCapability[]
}

let mintSeq = 0
function mintId(now: () => number): string {
  return `runner-${(mintSeq += 1).toString(36)}-${now().toString(36)}`
}

/** Order-insensitive equality for capability sets, so a re-advertisement that
 *  didn't actually change anything stays silent (no spurious event). */
function sameCapabilities(a: RunnerCapability[], b: RunnerCapability[]): boolean {
  if (a.length !== b.length) return false
  const norm = (caps: RunnerCapability[]) =>
    caps
      .map((c) => `${c.type}:${[...c.scopes].sort().join(',')}`)
      .sort()
      .join('|')
  return norm(a) === norm(b)
}

export class RunnerRegistry {
  private readonly runners = new Map<string, Runner>()
  private readonly emit: (e: ServerEvent) => void
  private readonly now: () => number

  // Note: explicit field assignment, not constructor parameter properties —
  // Node's runtime type-stripping only supports erasable TS syntax.
  constructor(emit: (e: ServerEvent) => void, now: () => number = () => Date.now()) {
    this.emit = emit
    this.now = now
  }

  /** Enroll (no id) or reconnect (known id), advertising the current grant set.
   *  A new identity or a return from offline emits `runner.connected`; a capability
   *  change on an already-online runner emits `runner.capabilities.changed`; an
   *  idempotent re-register (online, same grants) emits nothing. */
  register(input: RegisterInput): Runner {
    const id = input.id ?? mintId(this.now)
    const existing = this.runners.get(id)
    const runner: Runner = {
      id,
      label: input.label,
      host: input.host,
      status: 'online',
      lastSeen: this.now(),
      capabilities: input.capabilities,
    }
    this.runners.set(id, runner)

    if (!existing || existing.status === 'offline') {
      this.emit({ type: 'runner.connected', runner })
    } else if (!sameCapabilities(existing.capabilities, input.capabilities)) {
      this.emit({ type: 'runner.capabilities.changed', runner })
    }
    return runner
  }

  /** Liveness ping — refresh `lastSeen`; a ping from an offline runner reconnects
   *  it (emits `runner.connected`). Returns undefined for an unknown id. */
  heartbeat(id: string): Runner | undefined {
    const runner = this.runners.get(id)
    if (!runner) return undefined
    runner.lastSeen = this.now()
    if (runner.status === 'offline') {
      runner.status = 'online'
      this.emit({ type: 'runner.connected', runner })
    }
    return runner
  }

  /** Re-advertise the grant set; emits `runner.capabilities.changed` only when it
   *  actually changed. Returns undefined for an unknown id. */
  setCapabilities(id: string, capabilities: RunnerCapability[]): Runner | undefined {
    const runner = this.runners.get(id)
    if (!runner) return undefined
    if (!sameCapabilities(runner.capabilities, capabilities)) {
      runner.capabilities = capabilities
      runner.lastSeen = this.now()
      this.emit({ type: 'runner.capabilities.changed', runner })
    }
    return runner
  }

  /** Disconnect — the durable identity persists (marked offline) so a reconnect
   *  re-binds. Emits `runner.disconnected`. Returns false if already offline or
   *  unknown (so the route can 404 a no-op). */
  deregister(id: string): boolean {
    const runner = this.runners.get(id)
    if (!runner || runner.status === 'offline') return false
    runner.status = 'offline'
    runner.lastSeen = this.now()
    this.emit({ type: 'runner.disconnected', runnerId: id })
    return true
  }

  /** Liveness reaping (F4): mark online runners whose last heartbeat is older than
   *  `ttlMs` as offline — durable identity is kept (a later reconnect re-binds), so this
   *  mirrors `deregister` for a runner that died without disconnecting. Emits
   *  `runner.disconnected` per reaped runner and returns their ids. The control plane
   *  calls this on a cadence; `find()` already filters to online, so routing stops
   *  targeting a reaped runner immediately. */
  reapStale(ttlMs: number): string[] {
    const cutoff = this.now() - ttlMs
    const reaped: string[] = []
    for (const runner of this.runners.values()) {
      if (runner.status === 'online' && runner.lastSeen < cutoff) {
        runner.status = 'offline'
        this.emit({ type: 'runner.disconnected', runnerId: runner.id })
        reaped.push(runner.id)
      }
    }
    return reaped
  }

  get(id: string): Runner | undefined {
    return this.runners.get(id)
  }

  /** All known runners — online and durable-but-offline — in enrollment order. */
  list(): Runner[] {
    return [...this.runners.values()]
  }

  /** The online runners that currently advertise a capability — the routing
   *  primitive the capability-addressing layer builds on. */
  find(type: CapabilityType): Runner[] {
    return this.list().filter(
      (a) => a.status === 'online' && a.capabilities.some((c) => c.type === type),
    )
  }
}
