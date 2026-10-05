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
import { store, type RoutineExecutionContext } from './store/index.ts'

export interface RoutineRunStore {
  pendingScheduleRuns(): Array<{ taskId: string; runId: string; nextAttemptAt: number }>
  routineExecutionContext(taskId: string, runId: string): RoutineExecutionContext | undefined
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

export interface RoutineRunnerOptions {
  now?: () => number
  retryBaseMs?: number
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
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const controllers = new Map<string, AbortController>()
  let stopped = false

  const key = (taskId: string, runId: string) => `${taskId}\u0000${runId}`

  const schedule = (taskId: string, runId: string, at: number): void => {
    if (stopped) return
    const k = key(taskId, runId)
    const prior = timers.get(k)
    if (prior) clearTimeout(prior)
    const handle = setTimeout(() => {
      timers.delete(k)
      void execute(taskId, runId)
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

  const execute = async (taskId: string, runId: string): Promise<void> => {
    if (stopped) return
    let ctx = runStore.routineExecutionContext(taskId, runId)
    if (!ctx) return
    const attempt = (ctx.run.attempts ?? 0) + 1
    if (!runStore.markScheduleRunAttempt(taskId, runId, attempt, now())) return
    ctx = runStore.routineExecutionContext(taskId, runId)
    if (!ctx) return

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

    const controller = new AbortController()
    controllers.set(key(taskId, runId), controller)
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
        { standingApprovedContextIds: ctx.approvedContextIds, effort: ctx.task.effort, routineArtifact },
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
    } finally {
      controllers.delete(key(taskId, runId))
    }
  }

  return {
    /** Called by the store after it durably mints a run. */
    enqueue(taskId: string, runId: string): void {
      const ctx = runStore.routineExecutionContext(taskId, runId)
      if (ctx) schedule(taskId, runId, ctx.run.nextAttemptAt ?? now())
    },
    /** Recover every execution-aware running row after persistence rehydrate. */
    start(): void {
      stopped = false
      for (const pending of runStore.pendingScheduleRuns()) {
        schedule(pending.taskId, pending.runId, pending.nextAttemptAt)
      }
    },
    stop(): void {
      stopped = true
      for (const handle of timers.values()) clearTimeout(handle)
      timers.clear()
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    },
  }
}
