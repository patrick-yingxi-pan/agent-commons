/** The real Routine worker rechecks inherited budgets at attempt admission.
 * The generator is an inert sentinel, so even failure-first runs spend nothing. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Budget } from '../contract/index.ts'
import { createRoutineRunner, type RoutineGenerate } from './routineRunner.ts'
import { store } from './store/index.ts'

const FIVE = '5-hour limit'
const WEEK = 'Weekly · all models'
const budget = (five: number, weekly: number): Budget => ({ windows: [
  { label: FIVE, ceiling: five }, { label: WEEK, ceiling: weekly },
] })
let sequence = 0

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  for (const scenario of ['parent', 'selected', 'partial', 'queued-change'] as const) {
    test(`${protocol} Routine refuses ${scenario} budget exhaustion before generation or retry`, async () => {
      const tenantId = `tenant-routine-spend-${++sequence}`
      const model = 'routine-spend-model'
      const makeProvider = (label: string, plan: Budget) => store.createProvider({ label, plan,
        modelFamily: 'custom', effortLevels: [], models: [{ id: model, label: model }] },
      { protocol, baseURL: 'http://127.0.0.1:1/v1', model, capabilities: { toolUse: false } }, tenantId)
      const parent = makeProvider('Routine parent', scenario === 'parent' ? budget(100, 1_000)
        : scenario === 'partial' ? budget(500, 100) : budget(500, 1_000))
      const selected = makeProvider('Routine selected', scenario === 'selected' ? budget(100, 1_000) : budget(500, 1_000))
      const agent = store.createAgent({ label: 'Routine budget Agent', systemPrompt: 'Complete the task.',
        tools: [], instructions: '', providerId: parent.id,
        ...(scenario === 'partial' ? { budget: { windows: [{ label: FIVE, ceiling: 300 }] } } : {}),
      }, tenantId)
      const task = store.addSchedule({ tenantId, name: 'Routine budget regression', cadence: 'Every hour',
        timezone: 'UTC', next: '', enabled: false, lastStatus: 'pending', subtitle: '', trigger: '',
        prompt: 'Complete the task.', steps: [], runs: [], model: '', agentId: agent.id,
        providerId: selected.id, modelId: model,
        delivery: { tool: { id: 'claude', label: 'Claude', tone: 'claude' }, target: 'Run conversation' },
      })
      let calls = 0
      let timer: ReturnType<typeof setTimeout> | undefined
      const runner = createRoutineRunner(store, (async () => {
        calls++
        return { outcome: 'ok', message: { id: `sentinel-${sequence}`, role: 'assistant', content: 'Not a provider reply.' },
          usage: { inputTokens: 0, outputTokens: 0 } }
      }) as RoutineGenerate)
      try {
        const run = store.runSchedule(task.id)!
        const frozen = structuredClone(run.execution)
        if (scenario === 'queued-change') store.updateProvider(parent.id, { plan: budget(100, 1_000) })
        store.recordUsage(100, 0, tenantId)
        const usage = structuredClone(store.usage(undefined, tenantId).limits)
        let finish!: () => void
        const terminal = new Promise<void>(resolve => { finish = resolve })
        const unsubscribe = store.subscribe(event => {
          if (event.type === 'run.finished' && event.taskId === task.id) finish()
        })
        try {
          runner.enqueue(task.id, run.id)
          await Promise.race([terminal, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Routine did not settle')), 2_000)
          })])
        } finally { unsubscribe() }
        assert.equal(calls, 0, 'an exhausted inherited window must prevent the generator from being invoked')
        assert.equal(run.status, 'failed')
        assert.equal(run.failureCode, 'budget_exceeded')
        assert.equal(run.attempts, 1)
        assert.equal(run.nextAttemptAt, undefined, 'budget refusal is terminal, not an automatic retry')
        assert.ok(run.detail?.includes(scenario === 'partial' ? WEEK : FIVE))
        assert.match(run.detail!, /this run was refused/)
        assert.doesNotMatch(run.detail!, /routine is paused/)
        assert.deepEqual(run.execution, frozen, 'admission cannot rewrite the queued binding')
        assert.deepEqual(store.usage(undefined, tenantId).limits, usage)
        assert.deepEqual(store.pendingScheduleRuns().filter(row => row.taskId === task.id), [])
      } finally {
        runner.stop()
        if (timer) clearTimeout(timer)
        store.removeSchedule(task.id)
        store.deleteAgent(agent.id)
        store.deleteProvider(parent.id)
        store.deleteProvider(selected.id)
      }
    })
  }
}
