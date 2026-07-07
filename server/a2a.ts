/** ── The A2A edge: translation only (docs/a2a-integration.md, D20) ───────────
 *  Pure builders that re-serve platform-shell objects in the A2A wire format:
 *  a published Agent's D17 directory entry → an **Agent Card**, a D19
 *  `OpenSubGoal` → a **Task**. Nothing here reads the store or checks a wall —
 *  the routes do both through the SAME functions the native routes use, then
 *  hand the result to these mappers ("a protocol translates; it never
 *  authorizes"). JSON-RPC envelope helpers live here too so the routes stay
 *  free of protocol boilerplate. */
import type { ServerResponse } from 'node:http'
import {
  API_BASE_PATH,
  A2A_PROTOCOL_VERSION,
  type A2aAgentCard,
  type A2aMessage,
  type A2aPart,
  type A2aRpcResponse,
  type A2aTask,
  type AgentDirectoryEntry,
  type OpenSubGoal,
} from '../contract/index.ts'
import { sendJson } from './http/respond.ts'

/** The instance's own card — served at the conventional server-root
 *  `/.well-known/agent-card.json` (the deploy shape) and at `GET /a2a/card`
 *  (the router home). Its one skill is the platform-level act a foreign agent
 *  may perform: posting open work to a shared Project (D19 via D20). */
export function platformCard(origin: string): A2aAgentCard {
  const base = `${origin}${API_BASE_PATH}`
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: 'Agent Commons',
    description:
      'A cooperation platform where agents are the main players: shared Projects, published Agent definitions, and an open-work backlog standing Contributors take unprompted. This card is the instance front door; each published Agent serves its own card.',
    url: `${base}/a2a`,
    version: '1',
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'open-work',
        name: 'Post open work to a shared Project',
        description:
          `JSON-RPC message/send to ${base}/a2a/projects/{projectId}: a text part (the sub-goal statement) plus a data part {type, target, note?} (the effect descriptor). The returned Task's id keys tasks/get. Discover shared Projects at ${base}/directory/projects.`,
        tags: ['tasks', 'open-work'],
      },
    ],
    metadata: { directories: { projects: `${base}/directory/projects`, agents: `${base}/directory/agents` } },
  }
}

/** A published Agent's card, built from its D17 **directory entry** — the same
 *  redaction function the directory read uses (one wall, two windows), so a
 *  card can never expose a field the directory withholds. Tools become skills;
 *  the public track record rides `metadata`. */
export function agentCard(entry: AgentDirectoryEntry, origin: string): A2aAgentCard {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: entry.label,
    description: entry.instructions || `A published Agent definition from ${entry.owner}.`,
    url: `${origin}${API_BASE_PATH}/a2a/agents/${entry.id}`,
    version: '1',
    preferredTransport: 'JSONRPC',
    provider: { organization: entry.owner },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: entry.tools.map((tool) => ({
      id: tool,
      name: tool,
      description: `May call the '${tool}' tool when commissioned onto a Project.`,
      tags: ['tool'],
    })),
    metadata: { systemPrompt: entry.systemPrompt, contributions: entry.contributions, forks: entry.forks },
  }
}

/** A minimal agent-role message (status text on a Task). */
function agentMessage(text: string, contextId: string): A2aMessage {
  return { kind: 'message', role: 'agent', messageId: `msg-${contextId}`, parts: [{ kind: 'text', text }], contextId }
}

/** An `OpenSubGoal`'s wire image: task id = item id, contextId = Project id,
 *  and the honest lifecycle — `submitted` while open (nothing is executing
 *  between reads; dispatch is synchronous), `completed` once a standing
 *  Contributor took it, the artifact carrying the D13 public credit line. */
export function taskFromOpenSubGoal(item: OpenSubGoal): A2aTask {
  const meta = { subGoal: item.subGoal, type: item.type, target: item.target, postedBy: item.postedBy, ...(item.via ? { via: item.via } : {}) }
  // The D23 thread as spec `history` (D27's protocol face): one comment = one
  // message; the author's display name rides the metadata (a comment has no
  // A2A role — every commenter is a peer, so `user` throughout).
  const history: A2aMessage[] | undefined = item.comments?.length
    ? item.comments.map((c) => ({
        kind: 'message' as const,
        role: 'user' as const,
        messageId: c.id,
        parts: [{ kind: 'text' as const, text: c.body }],
        taskId: item.id,
        contextId: item.projectId,
        metadata: { author: c.author, at: c.at },
      }))
    : undefined
  if (item.status === 'done') {
    const credit: A2aPart[] = [
      { kind: 'text', text: `Done by ${item.resolvedByLabel ?? item.resolvedBy ?? 'a Contributor'}.` },
      { kind: 'data', data: { resolvedBy: item.resolvedBy ?? '', resolvedByLabel: item.resolvedByLabel ?? '', resolvedAt: item.resolvedAt ?? 0 } },
    ]
    return {
      kind: 'task',
      id: item.id,
      contextId: item.projectId,
      status: { state: 'completed', timestamp: new Date(item.resolvedAt ?? item.postedAt).toISOString() },
      artifacts: [{ artifactId: `${item.id}-credit`, name: 'credit', parts: credit }],
      ...(history ? { history } : {}),
      metadata: meta,
    }
  }
  if (item.status === 'retracted') {
    // The D23 close, spoken in protocol: retract = the spec's `canceled` state.
    return {
      kind: 'task',
      id: item.id,
      contextId: item.projectId,
      status: {
        state: 'canceled',
        timestamp: new Date(item.retractedAt ?? item.postedAt).toISOString(),
        message: agentMessage(`Retracted by ${item.retractedBy ?? item.postedBy} — closed unresolved.`, item.projectId),
      },
      ...(history ? { history } : {}),
      metadata: meta,
    }
  }
  return {
    kind: 'task',
    id: item.id,
    contextId: item.projectId,
    status: {
      state: 'submitted',
      timestamp: new Date(item.postedAt).toISOString(),
      message: agentMessage('Open — on the Project backlog, awaiting a standing Contributor whose role and reach admit it.', item.projectId),
    },
    ...(history ? { history } : {}),
    metadata: meta,
  }
}

/** The D18 refusal, spoken in protocol: an Agent's card advertises a
 *  DEFINITION; its endpoint never leases the owner's capability. A
 *  spec-conformant `rejected` Task explains fork-and-bind instead of 404ing
 *  (a dead link on an advertised url reads as a bug, not a wall). */
export function rejectedAgentTask(agentId: string, origin: string): A2aTask {
  const base = `${origin}${API_BASE_PATH}`
  return {
    kind: 'task',
    id: `task-rejected-${agentId}`,
    contextId: agentId,
    status: {
      state: 'rejected',
      timestamp: new Date().toISOString(),
      message: agentMessage(
        `This published Agent's definition is public; its owner's capability is not — a definition travels, a capability never does. Fork it into your own workspace (POST ${base}/agents/${agentId}/fork) and bind your own provider, authority, and budget; or post open work to a shared Project (${base}/a2a/projects/{projectId}).`,
        agentId,
      ),
    },
  }
}

/** JSON-RPC envelope senders. Errors ride HTTP 200 with an `error` member, per
 *  protocol convention (transport succeeded; the method did not). */
export function rpcResult(res: ServerResponse, id: string | number | null, result: unknown): void {
  sendJson(res, { jsonrpc: '2.0', id, result } satisfies A2aRpcResponse)
}
export function rpcError(res: ServerResponse, id: string | number | null, code: number, message: string): void {
  sendJson(res, { jsonrpc: '2.0', id, error: { code, message } } satisfies A2aRpcResponse)
}
