/** ── The (mock) agent runtime ───────────────────────────────────────────────
 *  Stands in for the on-host agent's executor. In the real architecture this code
 *  runs *inside the agent* on its host, not in the broker — which is why grant
 *  enforcement lives here, not in the route: the agent, never the broker, is the
 *  policy-enforcement point (D3). The broker (the route) only routes; this module
 *  enforces the scoped grant and then fulfils the capability.
 *
 *  Fulfilment is mock (deterministic, reviewable) but the wire shape is real —
 *  the same seam a production agent would implement against its host. */
import type { Agent, CapabilityRequest, CapabilityResult } from '../contract/index.ts'

/** A capability invocation that the agent refused or couldn't run. `code` maps to
 *  the contract error envelope so the route can surface it verbatim. */
export class CapabilityError extends Error {
  readonly code: 'capability_unavailable' | 'forbidden' | 'bad_request'
  constructor(code: 'capability_unavailable' | 'forbidden' | 'bad_request', message: string) {
    super(message)
    this.code = code
    this.name = 'CapabilityError'
  }
}

/** Does a single granted scope cover `target`? `*` grants everything; otherwise an
 *  exact match or a path/command *under* the scope (`scope` then a `/` boundary),
 *  so `~/projects` grants `~/projects/app` but not `~/projects-secret`. */
export function scopeMatches(scope: string, target: string): boolean {
  if (scope === '*') return true
  if (scope === target) return true
  return target.startsWith(scope.endsWith('/') ? scope : `${scope}/`)
}

/** Is `target` within *any* of the agent's granted scopes for `capability`?
 *  False when the agent doesn't advertise the capability at all. */
export function isGranted(agent: Agent, capability: CapabilityRequest['capability'], target: string): boolean {
  const cap = agent.capabilities.find((c) => c.type === capability)
  return !!cap && cap.scopes.some((s) => scopeMatches(s, target))
}

/** Mock fulfilment per capability — deterministic, real-shaped output. */
function fulfil(request: CapabilityRequest): unknown {
  switch (request.capability) {
    case 'fs.read':
      return { encoding: 'utf-8', content: `// mock contents of ${request.target}\n` }
    case 'fs.write': {
      const content = typeof request.args?.content === 'string' ? request.args.content : ''
      return { written: true, bytes: content.length, target: request.target }
    }
    case 'terminal':
      return { stdout: `mock$ ${request.target}\n(ran on agent)\n`, exitCode: 0 }
    case 'process':
      return { started: true, target: request.target }
    default:
      throw new CapabilityError('bad_request', `Unknown capability '${request.capability}'`)
  }
}

/** Run a capability on this agent's host. Enforces the grant first (D3), then
 *  fulfils. Throws CapabilityError on an unsupported capability or a target
 *  outside the granted scope — the route maps it to the error envelope. The
 *  caller (broker) is expected to have already confirmed the agent is online. */
export function runCapability(agent: Agent, request: CapabilityRequest): CapabilityResult {
  const cap = agent.capabilities.find((c) => c.type === request.capability)
  if (!cap) {
    throw new CapabilityError(
      'capability_unavailable',
      `Agent '${agent.id}' does not offer '${request.capability}'`,
    )
  }
  if (!cap.scopes.some((s) => scopeMatches(s, request.target))) {
    throw new CapabilityError(
      'forbidden',
      `'${request.target}' is outside the granted scope for '${request.capability}' on '${agent.id}'`,
    )
  }
  return {
    capability: request.capability,
    agentId: agent.id,
    target: request.target,
    output: fulfil(request),
  }
}
