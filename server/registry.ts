/** ── The native-agent registry ─────────────────────────────────────────────
 *  The broker's live view of which agents are connected and what each can do on
 *  its host (see docs/capability-broker-architecture.md). This is the control
 *  plane's registry: agents enroll/reconnect, heartbeat, re-advertise grants, and
 *  disconnect; every change broadcasts an ambient `agent.*` event.
 *
 *  Identity is **durable** (D4): a disconnect marks an agent `offline` but keeps
 *  its record, so a reconnect re-binds to the same id and the user's references to
 *  it stay stable. The clock is injectable so tests are deterministic. */
import type { Agent, AgentCapability, CapabilityType, ServerEvent } from '../contract/index.ts'

/** The data an agent supplies to enroll or reconnect. */
export interface RegisterInput {
  /** Omit to mint a new identity (first enrollment); supply a known id to reconnect. */
  id?: string
  label: string
  host: string
  capabilities: AgentCapability[]
}

let mintSeq = 0
function mintId(now: () => number): string {
  return `agent-${(mintSeq += 1).toString(36)}-${now().toString(36)}`
}

/** Order-insensitive equality for capability sets, so a re-advertisement that
 *  didn't actually change anything stays silent (no spurious event). */
function sameCapabilities(a: AgentCapability[], b: AgentCapability[]): boolean {
  if (a.length !== b.length) return false
  const norm = (caps: AgentCapability[]) =>
    caps
      .map((c) => `${c.type}:${[...c.scopes].sort().join(',')}`)
      .sort()
      .join('|')
  return norm(a) === norm(b)
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>()
  private readonly emit: (e: ServerEvent) => void
  private readonly now: () => number

  // Note: explicit field assignment, not constructor parameter properties —
  // Node's runtime type-stripping only supports erasable TS syntax.
  constructor(emit: (e: ServerEvent) => void, now: () => number = () => Date.now()) {
    this.emit = emit
    this.now = now
  }

  /** Enroll (no id) or reconnect (known id), advertising the current grant set.
   *  A new identity or a return from offline emits `agent.connected`; a capability
   *  change on an already-online agent emits `agent.capabilities.changed`; an
   *  idempotent re-register (online, same grants) emits nothing. */
  register(input: RegisterInput): Agent {
    const id = input.id ?? mintId(this.now)
    const existing = this.agents.get(id)
    const agent: Agent = {
      id,
      label: input.label,
      host: input.host,
      status: 'online',
      lastSeen: this.now(),
      capabilities: input.capabilities,
    }
    this.agents.set(id, agent)

    if (!existing || existing.status === 'offline') {
      this.emit({ type: 'agent.connected', agent })
    } else if (!sameCapabilities(existing.capabilities, input.capabilities)) {
      this.emit({ type: 'agent.capabilities.changed', agent })
    }
    return agent
  }

  /** Liveness ping — refresh `lastSeen`; a ping from an offline agent reconnects
   *  it (emits `agent.connected`). Returns undefined for an unknown id. */
  heartbeat(id: string): Agent | undefined {
    const agent = this.agents.get(id)
    if (!agent) return undefined
    agent.lastSeen = this.now()
    if (agent.status === 'offline') {
      agent.status = 'online'
      this.emit({ type: 'agent.connected', agent })
    }
    return agent
  }

  /** Re-advertise the grant set; emits `agent.capabilities.changed` only when it
   *  actually changed. Returns undefined for an unknown id. */
  setCapabilities(id: string, capabilities: AgentCapability[]): Agent | undefined {
    const agent = this.agents.get(id)
    if (!agent) return undefined
    if (!sameCapabilities(agent.capabilities, capabilities)) {
      agent.capabilities = capabilities
      agent.lastSeen = this.now()
      this.emit({ type: 'agent.capabilities.changed', agent })
    }
    return agent
  }

  /** Disconnect — the durable identity persists (marked offline) so a reconnect
   *  re-binds. Emits `agent.disconnected`. Returns false if already offline or
   *  unknown (so the route can 404 a no-op). */
  deregister(id: string): boolean {
    const agent = this.agents.get(id)
    if (!agent || agent.status === 'offline') return false
    agent.status = 'offline'
    agent.lastSeen = this.now()
    this.emit({ type: 'agent.disconnected', agentId: id })
    return true
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  /** All known agents — online and durable-but-offline — in enrollment order. */
  list(): Agent[] {
    return [...this.agents.values()]
  }

  /** The online agents that currently advertise a capability — the routing
   *  primitive the capability-addressing layer builds on. */
  find(type: CapabilityType): Agent[] {
    return this.list().filter(
      (a) => a.status === 'online' && a.capabilities.some((c) => c.type === type),
    )
  }
}
