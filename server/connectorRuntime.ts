/** Connector/MCP execution boundary.
 *
 * Tool derivation and consent are transport-neutral. This module owns the one
 * point where an admitted call may leave the product. Development selects the
 * deterministic fixture adapter explicitly; release profiles select the
 * unavailable adapter and therefore cannot report an external effect until a
 * real stdio/HTTP/OAuth adapter is installed here.
 */
import type { ToolActivity } from '../contract/index.ts'
import { positiveNumberEnv } from './env.ts'

const DEFAULT_CONNECTOR_TIMEOUT_MS = 10_000
export const MAX_CONNECTOR_RESULT_CHARS = 4_000
export const MAX_CONNECTOR_INPUT_CHARS = 32_000
const MAX_CONNECTOR_FAILURE_CHARS = 600

export type ConnectorFailure = NonNullable<ToolActivity['failure']>

export interface ConnectorToolInvocation {
  /** Stable identity for adapter-side idempotency. A consent retry reuses the
   * persisted activity id; adapters must not duplicate a settled write. */
  invocationId: string
  tool: string
  connectorId: string
  connector: string
  kind: ToolActivity['kind']
  input: Record<string, unknown>
  /** Adapters must stop cancellable I/O when aborted. Combined with
   * invocationId, this bounds late completion without trusting cancellation as
   * the sole exactly-once mechanism. */
  signal?: AbortSignal
  /** Development-only fixture content. A production adapter ignores it. */
  developmentFixtureSummary?: string
}

export type ConnectorExecutionResult =
  | { ok: true; summary: string }
  | { ok: false; message: string; failure: ConnectorFailure }

export interface ConnectorToolRuntime {
  mode: 'fixture' | 'unconfigured' | 'adapter'
  execute(invocation: ConnectorToolInvocation): Promise<ConnectorExecutionResult>
}

export type ConnectorRuntimeMode = 'fixture' | 'unconfigured'

/** Direct development/test boots keep the declared deterministic world. Any
 * release-shaped boot fails closed unless its launcher names a real adapter. */
export function connectorRuntimeMode(env: Record<string, string | undefined> = process.env): ConnectorRuntimeMode {
  if (env.DEPLOYMENT_PROFILE) return 'unconfigured'
  const configured = env.CONNECTOR_RUNTIME?.trim().toLowerCase()
  if (!configured) return 'fixture'
  if (configured === 'fixture' || configured === 'unconfigured') return configured
  throw new Error(`CONNECTOR_RUNTIME must be fixture or unconfigured; received "${env.CONNECTOR_RUNTIME}".`)
}

function shortToolName(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
}

export const fixtureConnectorRuntime: ConnectorToolRuntime = {
  mode: 'fixture',
  async execute(invocation) {
    return {
      ok: true,
      summary:
        invocation.developmentFixtureSummary ??
        `(mock) ${shortToolName(invocation.tool)} completed on ${invocation.connector}.`,
    }
  },
}

export const unconfiguredConnectorRuntime: ConnectorToolRuntime = {
  mode: 'unconfigured',
  async execute() {
    return {
      ok: false,
      message: 'Connector execution is not configured in this release. Connect a supported adapter, then try again.',
      failure: { code: 'connector_unconfigured', retryable: false },
    }
  },
}

/** Resolved per call so test/operator posture changes do not require a restart;
 * release launchers still pin it before server modules evaluate. */
export function connectorToolRuntime(env: Record<string, string | undefined> = process.env): ConnectorToolRuntime {
  return connectorRuntimeMode(env) === 'fixture' ? fixtureConnectorRuntime : unconfiguredConnectorRuntime
}

function boundedText(value: unknown, limit: number): string {
  const text = typeof value === 'string' ? value.replaceAll('\u0000', '').trim() : ''
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export type AcceptedConnectorInput =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; result: ConnectorExecutionResult & { ok: false } }

/** Canonical JSON is the consent and adapter input. This both snapshots caller
 * data against later mutation and prevents a model response from manufacturing
 * an unbounded durable activity. */
export function acceptConnectorInput(input: Record<string, unknown>): AcceptedConnectorInput {
  try {
    const encoded = JSON.stringify(input)
    if (encoded.length > MAX_CONNECTOR_INPUT_CHARS) {
      return {
        ok: false,
        result: {
          ok: false,
          message: `Connector input exceeds the ${MAX_CONNECTOR_INPUT_CHARS.toLocaleString('en-US')}-character safety limit. Narrow the request and try again.`,
          failure: { code: 'connector_failed', retryable: false },
        },
      }
    }
    return { ok: true, input: JSON.parse(encoded) as Record<string, unknown> }
  } catch {
    return {
      ok: false,
      result: {
        ok: false,
        message: 'Connector input is not valid JSON and was not accepted.',
        failure: { code: 'connector_failed', retryable: false },
      },
    }
  }
}

/** Accept only bounded, nonempty, non-secret-safe result shapes from an adapter.
 * MCP/provider output is untrusted content; raw exceptions and unbounded strings
 * must not reach the model, transcript, persistence, or rendered card. */
export async function invokeConnectorRuntime(
  runtime: ConnectorToolRuntime,
  invocation: ConnectorToolInvocation,
): Promise<ConnectorExecutionResult> {
  try {
    const result = await runtime.execute(invocation)
    if (result.ok) {
      const summary = boundedText(result.summary, MAX_CONNECTOR_RESULT_CHARS)
      return summary
        ? { ok: true, summary }
        : {
            ok: false,
            message: 'The connector returned no usable result.',
            failure: { code: 'connector_failed', retryable: true },
          }
    }
    return {
      ok: false,
      message: boundedText(result.message, MAX_CONNECTOR_FAILURE_CHARS) || 'The connector failed without accepting a result. Try again.',
      failure: result.failure,
    }
  } catch (error) {
    if (invocation.signal?.aborted) throw error
    return {
      ok: false,
      message: 'The connector failed without accepting a result. Try again.',
      failure: { code: 'connector_failed', retryable: true },
    }
  }
}

/** Rebuild the runtime request from a persisted consent activity. The exact
 * original input is load-bearing: confirmation never guesses or drops args. */
export function executeConnectorActivity(
  activity: ToolActivity,
  runtime: ConnectorToolRuntime = connectorToolRuntime(),
  options: { timeoutMs?: number } = {},
): Promise<ConnectorExecutionResult> {
  const acceptedInput = acceptConnectorInput(activity.input ?? {})
  if (!acceptedInput.ok) return Promise.resolve(acceptedInput.result)
  const timeoutMs = options.timeoutMs ?? positiveNumberEnv(process.env.CONNECTOR_TOOL_TIMEOUT_MS, DEFAULT_CONNECTOR_TIMEOUT_MS)
  const controller = new AbortController()
  const deadlineFailure: ConnectorExecutionResult = {
    ok: false,
    message: 'The connector did not complete before its deadline. Nothing was accepted; try again.',
    failure: { code: 'connector_unavailable', retryable: true },
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<ConnectorExecutionResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(deadlineFailure)
    }, Math.max(1, timeoutMs))
    timer.unref?.()
  })
  const executed = Promise.resolve()
    .then(() => invokeConnectorRuntime(runtime, {
      invocationId: activity.id,
      tool: activity.tool,
      connectorId: activity.connectorId,
      connector: activity.connector,
      kind: activity.kind,
      input: acceptedInput.input,
      signal: controller.signal,
    }))
    .catch((): ConnectorExecutionResult => controller.signal.aborted
      ? deadlineFailure
      : {
          ok: false,
          message: 'The connector failed without accepting a result. Try again.',
          failure: { code: 'connector_failed', retryable: true },
        })

  return Promise.race([executed, timedOut]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
