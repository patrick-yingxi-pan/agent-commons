/** ── Durable routine execution ─────────────────────────────────────────────
 *  Scheduling decides WHEN a routine fires; this worker decides HOW that fire
 *  becomes a real model turn. The store persists every transition before this
 *  module performs I/O, so process restart resumes `running` rows from their
 *  durable attempt cursor rather than inventing or losing work.
 *
 *  The worker uses the same Anthropic Messages + guarded connector-tool loop as
 *  interactive turns. Its Agent is the routine's explicit identity; built-in
 *  proposal tools are withheld because an unattended turn cannot ask for fresh
 *  consent, while connector contexts authored into the routine carry standing
 *  approval. */
import type { Agent, Message, ScheduledRun, ScheduledTask } from '../contract/index.ts'
import type { ScheduledArtifactSpec } from '../contract/scheduledArtifact.ts'
import { createRoutineArtifactCapture } from './routineArtifact.ts'
import { generateReply, type ReplyResult } from './generate.ts'
import { positiveNumberEnv } from './env.ts'
import { UsageRecordingError } from './modelUsage.ts'
import { PersistenceWriteError } from './persistence/persist.ts'
import { store, type RoutineExecutionContext } from './store/index.ts'

export interface RoutineRunStore {
  pendingScheduleRuns(): Array<{ taskId: string; runId: string; nextAttemptAt: number }>
  routineExecutionContext(taskId: string, runId: string): RoutineExecutionContext | undefined
  /** Production store freezes model retry admission after any Routine MCP
   * reservation. Optional for isolated runner stubs that have no MCP ledger. */
  routineMcpRunMayRetry?(taskId: string, runId: string): boolean
  markScheduleRunAttempt(taskId: string, runId: string, attempt: number, at?: number): ScheduledRun | undefined
  deferScheduleRun(taskId: string, runId: string, nextAttemptAt: number, detail: string): ScheduledRun | undefined
  completeScheduleRun(
    taskId: string,
    runId: string,
    message: Message,
    provenance: { agentId: string; providerId: string; modelId?: string },
    finishedAt?: number,
    structuredOutput?: unknown,
  ): ScheduledRun | undefined
  failScheduleRun(
    taskId: string,
    runId: string,
    code: NonNullable<ScheduledRun['failureCode']>,
    detail: string,
    finishedAt?: number,
  ): ScheduledRun | undefined
  overSpendLimit(agentBudget: Agent['budget'], tenantId: string): { label: string; ceiling: number } | null
  recordUsage(inputTokens: number, outputTokens: number, tenantId?: string): void
  recordGenerationOutcome(outcome: 'ok' | 'fallback' | 'aborted' | 'error'): void
}

export type RoutineGenerate = typeof generateReply

export interface RoutineConcurrencyLimits {
  global: number
  perTenant: number
  perAgent: number
}

function concurrencyLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 64
    ? parsed : fallback
}

/** Operator tuning is bounded too: zero, malformed, and excessive limits never
 * silently turn the desktop worker into an unlimited model-call launcher. */
export function routineConcurrencyLimits(env: Record<string, string | undefined> = process.env): RoutineConcurrencyLimits {
  return {
    global: concurrencyLimit(env.ROUTINE_MAX_CONCURRENT, 4),
    perTenant: concurrencyLimit(env.ROUTINE_MAX_CONCURRENT_PER_TENANT, 2),
    perAgent: concurrencyLimit(env.ROUTINE_MAX_CONCURRENT_PER_AGENT, 1),
  }
}

export interface RoutineRunnerOptions {
  now?: () => number
  retryBaseMs?: number
  concurrency?: Partial<RoutineConcurrencyLimits>
  /** Process supervisor seam. The default terminates on an internal worker
   * fault after closing admission; it never exposes the private store cause. */
  onFatal?: () => void
}

function executionPrompt(task: ScheduledTask, output?: ScheduledArtifactSpec | null): string {
  const workflow = task.steps.map((step, index) => `${index + 1}. ${step.action} — use ${step.tool.label}`).join('\n')
  return [
    task.prompt,
    workflow ? `Workflow to complete:\n${workflow}` : '',
    output && output.kind !== 'doc'
      ? `Produce the standing-approved ${output.kind === 'sheet' ? 'Sheet or workbook' : 'Slides'} named ${JSON.stringify(output.name)}. Submit its complete literal content exactly once with submit_routine_artifact, then give a brief run recap. The tool captures a candidate; the server saves it only after this run succeeds. Do not serialize the artifact as prose or claim a failed submission was saved.`
      : output
        ? `Write the complete Document text for the standing-approved output named ${JSON.stringify(output.name)} as your final response.`
        : `Deliver the final result for: ${task.delivery.target}.`,
  ].filter(Boolean).join('\n\n')
}

function headlessAgent(agent: Agent): Agent {
  const instruction =
    'This is an unattended scheduled run. Complete the instruction now using only the declared routine contexts. Do not ask for interactive approval or propose unrelated product changes.'
  return {
    ...agent,
    // Built-in tools create interactive consent cards. A routine may instead
    // use the connector contexts that were approved into its definition.
    tools: [],
    instructions: [agent.instructions, instruction].filter(Boolean).join(' '),
  }
}

function terminalFailure(result: ReplyResult): {
  code: NonNullable<ScheduledRun['failureCode']>
  detail: string
  retryable: boolean
} {
  if (result.failure === 'tool_loop_limit') {
    return { code: 'model_loop_limit', detail: result.message.content, retryable: false }
  }
  if (result.failure === 'invalid_model_response') {
    return { code: 'model_unavailable', detail: result.message.content, retryable: false }
  }
  return { code: 'model_unavailable', detail: result.message.content, retryable: true }
}

/** One process-local driver over durable rows. Timers are merely wakeups: the
 *  authoritative attempt number/time lives in the store and `start()` recovers
 *  them after rehydrate. */
export function createRoutineRunner(
  runStore: RoutineRunStore = store,
  generate: RoutineGenerate = generateReply,
  options: RoutineRunnerOptions = {},
) {
  const now = options.now ?? Date.now
  const retryBaseMs = options.retryBaseMs ?? positiveNumberEnv(process.env.ROUTINE_RETRY_BASE_MS, 5_000)
  const defaults = routineConcurrencyLimits()
  const limits: RoutineConcurrencyLimits = {
    global: concurrencyLimit(options.concurrency?.global, defaults.global),
    perTenant: concurrencyLimit(options.concurrency?.perTenant, defaults.perTenant),
    perAgent: concurrencyLimit(options.concurrency?.perAgent, defaults.perAgent),
  }
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const ready = new Map<string, { taskId: string; runId: string }>()
  const active = new Map<string, { tenantId: string; agentId: string; controller: AbortController }>()
  let stopped = false
  let faulted = false
  let draining = false

  const key = (taskId: string, runId: string) => JSON.stringify([taskId, runId])

  const stop = (): void => {
    stopped = true
    for (const handle of timers.values()) clearTimeout(handle)
    timers.clear()
    ready.clear()
    for (const call of active.values()) call.controller.abort()
  }

  /** Cancel one durable run after its owner has committed the terminal state.
   * Keep active capacity reserved until the provider/MCP promise actually
   * settles; cancellation is best-effort and never releases a live call. */
  const cancel = (taskId: string, runId: string): void => {
    const k = key(taskId, runId)
    const timer = timers.get(k)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(k)
    ready.delete(k)
    active.get(k)?.controller.abort()
  }

  const fatal = (): void => {
    if (faulted) return
    faulted = true
    stop()
    if (options.onFatal) options.onFatal()
    else queueMicrotask(() => { throw new Error('Routine worker state failed. Restart is required before more work can run.') })
  }

  const drain = (): void => {
    if (stopped || draining) return
    draining = true
    try {
      // Map order is ready-time FIFO. A saturated tenant/Agent cannot hold up a
      // different eligible scope. Waiting does not spend an attempt or tokens.
      for (const [k, job] of ready) {
        if (active.size >= limits.global) break
        if (active.has(k)) continue
        const ctx = runStore.routineExecutionContext(job.taskId, job.runId)
        if (!ctx) { ready.delete(k); continue }
        const tenantId = ctx.tenantId
        // taskForRun supplies the frozen binding. A missing Agent's fallback
        // face must not merge its capacity with an unrelated default Agent.
        const agentId = ctx.task.agentId ?? ctx.agent.id
        const tenantCalls = [...active.values()].filter((call) => call.tenantId === tenantId)
        if (tenantCalls.length >= limits.perTenant ||
            tenantCalls.filter((call) => call.agentId === agentId).length >= limits.perAgent) continue
        ready.delete(k)
        const call = { tenantId, agentId, controller: new AbortController() }
        active.set(k, call)
        void execute(job.taskId, job.runId, call.controller).then(() => {
          // Cancellation is not completion. Even an abort-ignoring endpoint
          // occupies its slot until its promise settles, across stop/start.
          if (active.get(k) === call) active.delete(k)
          drain()
        }, () => {
          // A failed state transition is not a retryable provider failure.
          // Close every admission before reporting it to the supervisor.
          fatal()
          if (active.get(k) === call) active.delete(k)
        })
      }
    } catch {
      fatal()
    } finally {
      draining = false
    }
  }

  const schedule = (taskId: string, runId: string, at: number): void => {
    if (stopped) return
    const k = key(taskId, runId)
    const prior = timers.get(k)
    if (prior) clearTimeout(prior)
    const handle = setTimeout(() => {
      timers.delete(k)
      ready.set(k, { taskId, runId })
      drain()
    }, Math.max(0, at - now()))
    handle.unref?.()
    timers.set(k, handle)
  }

  const retryOrFail = (
    ctx: RoutineExecutionContext,
    code: NonNullable<ScheduledRun['failureCode']>,
    detail: string,
    retryable: boolean,
  ): void => {
    // A model fallback/throw after an external reservation is not retryable:
    // replaying the prompt could repeat a remote effect. The durable ledger is
    // authoritative, including after restart and before each new model attempt.
    if (retryable && runStore.routineMcpRunMayRetry &&
        !runStore.routineMcpRunMayRetry(ctx.task.id, ctx.run.id)) retryable = false
    const attempts = ctx.run.attempts ?? 1
    const maxAttempts = ctx.run.maxAttempts ?? 1
    if (!stopped && retryable && attempts < maxAttempts) {
      const delay = retryBaseMs * 2 ** Math.max(0, attempts - 1)
      const nextAttemptAt = now() + delay
      if (runStore.deferScheduleRun(ctx.task.id, ctx.run.id, nextAttemptAt, detail)) {
        schedule(ctx.task.id, ctx.run.id, nextAttemptAt)
      }
      return
    }
    if (!stopped) runStore.failScheduleRun(ctx.task.id, ctx.run.id, code, detail, now())
  }

  const execute = async (taskId: string, runId: string, controller: AbortController): Promise<void> => {
    if (stopped || controller.signal.aborted) return
    let ctx = runStore.routineExecutionContext(taskId, runId)
    if (!ctx) return
    const attempt = (ctx.run.attempts ?? 0) + 1
    if (!runStore.markScheduleRunAttempt(taskId, runId, attempt, now())) return
    ctx = runStore.routineExecutionContext(taskId, runId)
    if (!ctx || stopped || controller.signal.aborted) return

    // A restarted running row is not a fresh model attempt. Any prior MCP
    // reservation (including one converted to uncertain during recovery) makes
    // prompt replay unsafe even though this process has not called generate yet.
    if (runStore.routineMcpRunMayRetry && !runStore.routineMcpRunMayRetry(taskId, runId)) {
      retryOrFail(ctx, 'execution_error',
        'This routine run already reserved an external MCP call. Its outcome must be reviewed; the prompt was not replayed.', false)
      return
    }

    if (ctx.blocked) {
      retryOrFail(ctx, ctx.blocked.code, ctx.blocked.detail, false)
      return
    }
    const output = ctx.run.execution?.standing?.artifact
    if (output && output.kind !== 'doc' && ctx.providerConfig.capabilities?.toolUse === false) {
      retryOrFail(ctx, 'model_unavailable',
        'This routine’s structured output requires a provider with tool use. Choose a compatible provider; its saved artifact was not changed.', false)
      return
    }
    const over = runStore.overSpendLimit(ctx.agent.budget, ctx.tenantId)
    if (over) {
      retryOrFail(
        ctx,
        'budget_exceeded',
        `Plan limit reached for '${over.label}' — this routine is paused until the window resets or its budget changes.`,
        false,
      )
      return
    }

    try {
      const routineArtifact = output && output.kind !== 'doc' ? createRoutineArtifactCapture(output) : undefined
      const providerConfig = { ...ctx.providerConfig, ...(ctx.modelId ? { model: ctx.modelId } : {}) }
      const result = await generate(
        { id: ctx.sessionId, title: ctx.task.name },
        headlessAgent(ctx.agent),
        executionPrompt(ctx.task, output),
        {
          onStart: () => {},
          onDelta: () => {},
          onUsage: (usage) => runStore.recordUsage(usage.inputTokens, usage.outputTokens, ctx.tenantId),
        },
        controller.signal,
        providerConfig,
        undefined,
        ctx.contexts,
        undefined,
        { standingApprovedContextIds: ctx.approvedContextIds, effort: ctx.task.effort, routineArtifact,
          externalMcpConnections: ctx.externalMcpConnections, routineMcp: ctx.routineMcp },
      )
      // A non-conformant endpoint may ignore AbortSignal. Shutdown still hands
      // ownership back to restart recovery; it must not settle the durable row.
      if (stopped || controller.signal.aborted) return
      runStore.recordGenerationOutcome(result.outcome)
      if (result.outcome !== 'ok') {
        const failure = terminalFailure(result)
        retryOrFail(ctx, failure.code, failure.detail, failure.retryable)
        return
      }
      const unapproved =
        result.message.escalation !== undefined ||
        (result.message.relationActions?.length ?? 0) > 0 ||
        result.message.toolActivities?.some((activity) => activity.status === 'proposed') === true
      if (unapproved) {
        retryOrFail(ctx, 'authority_denied', 'The model requested an action outside this routine’s standing approvals.', false)
        return
      }
      const connectorFailure = result.message.toolActivities?.find((activity) => activity.status === 'failed')
      if (connectorFailure) {
        retryOrFail(
          ctx,
          'context_unavailable',
          connectorFailure.summary,
          connectorFailure.failure?.retryable ?? true,
        )
        return
      }
      if (routineArtifact && (routineArtifact.failure || !routineArtifact.result)) {
        retryOrFail(ctx, 'execution_error',
          'The routine did not submit exactly one valid artifact in the approved format. Its saved artifact was not changed.', false)
        return
      }
      runStore.completeScheduleRun(
        taskId,
        runId,
        result.message,
        { agentId: ctx.agent.id, providerId: ctx.provider.id, ...(ctx.modelId ? { modelId: ctx.modelId } : {}) },
        now(),
        routineArtifact?.result,
      )
    } catch (error) {
      if (error instanceof PersistenceWriteError) throw error
      if (stopped || controller.signal.aborted) return // durable row resumes after restart
      runStore.recordGenerationOutcome('error')
      // Accounting failure is terminal: the model may already have consumed
      // tokens, so retrying would launch another paid attempt against an
      // uncertain meter. UsageRecordingError deliberately exposes only its
      // sanitized message; never surface its private cause in the run detail.
      const retryable = !(error instanceof UsageRecordingError)
      retryOrFail(
        ctx,
        'execution_error',
        error instanceof Error ? `Routine execution failed: ${error.message}` : 'Routine execution failed unexpectedly.',
        retryable,
      )
    }
  }

  const enqueue = (taskId: string, runId: string): void => {
    if (stopped) return
    const k = key(taskId, runId)
    const running = active.get(k)
    // A restart may queue a still-running durable row behind an abort-ignoring
    // old request; drain will wait for that exact promise before re-admission.
    if (timers.has(k) || ready.has(k) || (running && !running.controller.signal.aborted)) return
    const ctx = runStore.routineExecutionContext(taskId, runId)
    if (ctx) schedule(taskId, runId, ctx.run.nextAttemptAt ?? now())
  }

  return {
    /** Called by the store after it durably mints a run. */
    enqueue,
    /** The store calls after the stopped state is durable. */
    cancel,
    /** Recover every execution-aware running row after persistence rehydrate. */
    start(): void {
      if (faulted) return
      stopped = false
      for (const pending of runStore.pendingScheduleRuns()) {
        enqueue(pending.taskId, pending.runId)
      }
    },
    stop,
  }
}
