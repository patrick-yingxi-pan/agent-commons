/** ── One guarded executor for every model transport ─────────────────────────
 *  `generateReply` (dial-out Messages) and `relayReply` (dial-in Session
 *  provider) declare tools differently, but authority and execution semantics
 *  must not depend on transport. This module is their single execution seam:
 *
 *   • execute only names declared for this turn;
 *   • preserve serial, same-turn chaining;
 *   • cap every batch and answer every excess call with an error result;
 *   • bound asynchronous work per tool and isolate failures;
 *   • commit effects only after the executor settles successfully;
 *   • keep caller cancellation terminal (never reinterpret it as recoverable).
 *
 *  The current async executor is an API GET. A timed-out read may still finish
 *  inside the router because that boundary has no AbortSignal yet, but its result
 *  is discarded and it cannot mutate state. API mutations and connector writes
 *  remain consent-gated proposals and never dispatch from this loop. */
import type { EscalationProposal, RelationOp, ToolActivity } from '../contract/index.ts'
import { connectorToolRuntime, type ConnectorToolRuntime } from './connectorRuntime.ts'
import { nonNegativeIntEnv, positiveNumberEnv } from './env.ts'
import { runApiTool, type ApiToolRuntime } from './model/apiTools.ts'
import { runConnectorTool, type DerivedConnectorTools } from './model/connectorTools.ts'
import { executeTool, type ToolContext, type ToolEffect } from './model/tools.ts'
import {
  ROUTINE_ARTIFACT_TOOL_NAME,
  commitRoutineArtifact,
  poisonRepeatedRoutineArtifact,
  stageRoutineArtifact,
  type RoutineArtifactCapture,
  type StagedRoutineArtifact,
} from './routineArtifact.ts'

const DEFAULT_MAX_TOOL_CALLS = 16
const HARD_MAX_TOOL_CALLS = 64
const DEFAULT_TOOL_TIMEOUT_MS = 10_000
const DEFAULT_MAX_TOOL_BATCHES = 4
const HARD_MAX_TOOL_BATCHES = 8

export interface ToolExecutionLimits {
  maxCalls: number
  timeoutMs: number
}

export interface ToolLoopLimits {
  /** Tool-use batches the backend may execute before requiring final prose. */
  maxBatches: number
}

/** Read per batch so operators and tests can tune the guard without a restart.
 *  Zero calls is a valid fail-closed posture. The hard ceiling wins over an
 *  unsafe count misconfiguration; timeouts use the shared positive parser. */
export function toolExecutionLimits(env: Record<string, string | undefined> = process.env): ToolExecutionLimits {
  return {
    maxCalls: Math.min(HARD_MAX_TOOL_CALLS, nonNegativeIntEnv(env.MODEL_MAX_TOOL_CALLS, DEFAULT_MAX_TOOL_CALLS)),
    timeoutMs: positiveNumberEnv(env.MODEL_TOOL_TIMEOUT_MS, DEFAULT_TOOL_TIMEOUT_MS),
  }
}

/** The transport-neutral liveness/cost boundary around repeated model→tool
 *  exchanges. `MODEL_MAX_TOOL_ROUNDS` names the operator-facing concept while
 *  `maxBatches` makes its semantics exact: this many batches may execute, then
 *  a further tool request stops locally. Zero is a deliberate fail-closed mode;
 *  the hard ceiling prevents a typo from manufacturing an effectively unbounded
 *  turn. Read once per turn so every exchange in that turn shares one budget. */
export function toolLoopLimits(env: Record<string, string | undefined> = process.env): ToolLoopLimits {
  return {
    maxBatches: Math.min(HARD_MAX_TOOL_BATCHES, nonNegativeIntEnv(env.MODEL_MAX_TOOL_ROUNDS, DEFAULT_MAX_TOOL_BATCHES)),
  }
}

export interface ModelToolCall {
  id: string
  name: string
  input?: unknown
}

export interface ExecutedToolResult {
  callId: string
  content: string
  isError?: boolean
}

export interface ToolBatchOptions {
  /** Exact names offered to the model on this turn — the authority wall. */
  declaredNames: ReadonlySet<string>
  connectorBindings: DerivedConnectorTools['bindings']
  /** One injected connector/MCP effect boundary. Omitted resolves the current
   *  deployment posture (fixture in development, fail-closed in release). */
  connectorRuntime?: ConnectorToolRuntime
  api?: ApiToolRuntime
  context: ToolContext
  /** Live accumulators shared with the turn so serial calls can chain. */
  relationOps: RelationOp[]
  toolActivities: ToolActivity[]
  /** A prior relay round may already have proposed an escalation. */
  escalation?: EscalationProposal
  /** Server-owned sink for one standing-approved structured routine output. */
  routineArtifact?: RoutineArtifactCapture
  signal?: AbortSignal
  /** Optional whole-turn deadline (the relay transport owns one across rounds).
   *  Each local tool deadline is clamped to the remaining turn budget. */
  deadlineAt?: number
  limits?: ToolExecutionLimits
}

export interface ToolBatchOutcome {
  results: ExecutedToolResult[]
  escalation?: EscalationProposal
}

interface PendingEffect {
  content: string
  isError?: boolean
  activity?: ToolActivity
  effect?: ToolEffect
  /** Built-in tools may consume an earlier proposal while chaining. Run them
   *  against a private copy and publish that copy only after settlement. */
  chainedRelations?: RelationOp[]
  routineArtifact?: StagedRoutineArtifact
}

type Settlement<T> = { kind: 'done'; value: T } | { kind: 'failed' } | { kind: 'timeout' } | { kind: 'cancelled' }

export class ToolExecutionCancelledError extends Error {
  constructor() {
    super('tool execution cancelled by caller')
    this.name = 'ToolExecutionCancelledError'
  }
}

/** Race async work against its local deadline and the turn's cancellation.
 *  Executor exceptions are deliberately not returned: raw errors may include
 *  credentials, paths, or tenant data and must not be fed to a model. */
async function settle<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<Settlement<T>> {
  if (signal?.aborted) throw new ToolExecutionCancelledError()

  const local = new AbortController()
  let interrupted: 'timeout' | 'cancelled' | undefined
  const work: Promise<Settlement<T>> = Promise.resolve()
    .then(() => task(local.signal))
    .then(
      (value) => ({ kind: 'done', value }),
      () => ({ kind: interrupted ?? 'failed' }),
    )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Settlement<T>>((resolve) => {
    timer = setTimeout(() => {
      interrupted = 'timeout'
      local.abort()
      resolve({ kind: 'timeout' })
    }, Math.max(1, timeoutMs))
    ;(timer as { unref?: () => void }).unref?.()
  })
  let onAbort: (() => void) | undefined
  const cancelled = signal
      ? new Promise<Settlement<T>>((resolve) => {
        onAbort = () => {
          interrupted = 'cancelled'
          local.abort()
          resolve({ kind: 'cancelled' })
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    : undefined

  try {
    return await Promise.race(cancelled ? [work, timeout, cancelled] : [work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}

const asInput = (input: unknown): Record<string, unknown> =>
  input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

/** Resolve one declared call without mutating the turn accumulators. The caller
 *  commits the returned effect only after `settle` reports success. */
async function invoke(call: ModelToolCall, options: ToolBatchOptions, signal: AbortSignal): Promise<PendingEffect> {
  if (call.name === ROUTINE_ARTIFACT_TOOL_NAME && options.routineArtifact) {
    const staged = stageRoutineArtifact(options.routineArtifact, call.input)
    return staged.status === 'candidate'
      ? { content: 'Accepted the structured routine output candidate. Give a brief run recap.', routineArtifact: staged }
      : {
          content: staged.status === 'duplicate'
            ? 'The routine output was submitted more than once; this run cannot publish an artifact.'
            : 'The routine output did not match its approved name, kind, or bounded body schema; this run cannot publish an artifact.',
          isError: true,
          routineArtifact: staged,
        }
  }
  const activity = await runConnectorTool(
    call.name,
    options.connectorBindings,
    call.id,
    asInput(call.input),
    options.connectorRuntime ?? connectorToolRuntime(),
    signal,
  )
  if (activity) {
    return {
      activity,
      content:
        activity.status === 'proposed'
          ? 'Proposed to the user — awaiting their confirmation; not executed yet.'
          : activity.summary,
      isError: activity.status === 'failed',
    }
  }

  if (options.api) {
    const outcome = await runApiTool(call.name, asInput(call.input), call.id, options.api)
    if (outcome) return { content: outcome.content, isError: outcome.isError, activity: outcome.activity }
  }

  const chainedRelations = [...options.relationOps]
  const effect = executeTool(call.name, asInput(call.input), { ...options.context, pending: chainedRelations })
  return { content: effect.summary, effect, chainedRelations }
}

/** Execute a model-emitted batch serially. Results remain one-for-one with the
 *  calls (including refusals and excess calls), which keeps Anthropic's
 *  tool_use/tool_result shape valid and the relay continuation self-contained. */
export async function executeToolBatch(calls: readonly ModelToolCall[], options: ToolBatchOptions): Promise<ToolBatchOutcome> {
  const limits = options.limits ?? toolExecutionLimits()
  const results: ExecutedToolResult[] = []
  let escalation = options.escalation
  // Same-turn chaining: built-in tools see exactly the successfully committed
  // relation proposals made by earlier calls and earlier relay rounds.
  options.context.pending = options.relationOps

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]
    if (options.signal?.aborted) throw new ToolExecutionCancelledError()
    if (index >= limits.maxCalls) {
      if (call.name === ROUTINE_ARTIFACT_TOOL_NAME && options.routineArtifact && options.declaredNames.has(call.name)) {
        poisonRepeatedRoutineArtifact(options.routineArtifact)
      }
      results.push({
        callId: call.id,
        content: `Tool batch limit reached; '${call.name}' was not executed. Continue with the completed results or ask the user to split the request.`,
        isError: true,
      })
      continue
    }
    if (!options.declaredNames.has(call.name)) {
      results.push({
        callId: call.id,
        content: `Tool '${call.name}' was not offered this turn and was not executed.`,
        isError: true,
      })
      continue
    }

    const remainingTurnMs = options.deadlineAt === undefined ? limits.timeoutMs : options.deadlineAt - Date.now()
    if (remainingTurnMs <= 0) {
      if (call.name === ROUTINE_ARTIFACT_TOOL_NAME && options.routineArtifact) {
        poisonRepeatedRoutineArtifact(options.routineArtifact)
      }
      results.push({
        callId: call.id,
        content: `Tool '${call.name}' did not run because the turn deadline was reached.`,
        isError: true,
      })
      continue
    }
    const settled = await settle((signal) => invoke(call, options, signal), Math.min(limits.timeoutMs, remainingTurnMs), options.signal)
    if (settled.kind === 'cancelled') throw new ToolExecutionCancelledError()
    if (settled.kind === 'timeout') {
      results.push({
        callId: call.id,
        content: `Tool '${call.name}' did not complete before its deadline; its result was discarded.`,
        isError: true,
      })
      continue
    }
    if (settled.kind === 'failed') {
      results.push({
        callId: call.id,
        content: `Tool '${call.name}' failed; no result was accepted.`,
        isError: true,
      })
      continue
    }

    const pending = settled.value
    if (pending.activity) options.toolActivities.push(pending.activity)
    if (pending.chainedRelations) options.relationOps.splice(0, options.relationOps.length, ...pending.chainedRelations)
    if (pending.effect?.relationOps) options.relationOps.push(...pending.effect.relationOps)
    if (pending.effect?.escalation) escalation = pending.effect.escalation
    if (pending.routineArtifact && options.routineArtifact) {
      commitRoutineArtifact(options.routineArtifact, pending.routineArtifact)
    }
    results.push({
      callId: call.id,
      content: pending.content,
      ...(pending.isError ? { isError: true } : {}),
    })
  }

  return { results, escalation }
}
