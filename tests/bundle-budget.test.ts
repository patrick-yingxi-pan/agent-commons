/** Production bundle budget (PD67): the build itself rejects an eager or lazy
 * JavaScript payload large enough to recreate the one-megabyte boot bundle.
 * Pure policy lives in scripts/bundleBudget.ts; Vite is only its adapter. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASYNC_GRAPH_BUDGET_BYTES,
  CHUNK_BUDGET_BYTES,
  INITIAL_GRAPH_BUDGET_BYTES,
  WORKER_BUDGET_BYTES,
  bundleBudgetViolations,
  bundleBudgetPlugin,
  workerBudgetViolations,
} from '../scripts/bundleBudget.ts'

test('bundle budget measures physical chunks, the whole cold graph, and each lazy navigation graph', () => {
  const violations = bundleBudgetViolations([
    {
      fileName: 'entry.js',
      isEntry: true,
      bytes: 400_000,
      imports: ['boot-vendor.js'],
      dynamicImports: ['feature.js'],
    },
    { fileName: 'boot-vendor.js', isEntry: false, bytes: 400_001, imports: [], dynamicImports: [] },
    { fileName: 'feature.js', isEntry: false, bytes: 300_000, imports: ['feature-shared.js'], dynamicImports: [] },
    { fileName: 'feature-shared.js', isEntry: false, bytes: 200_001, imports: [], dynamicImports: [] },
    { fileName: 'chunk-heavy.js', isEntry: false, bytes: CHUNK_BUDGET_BYTES + 1, imports: [], dynamicImports: [] },
  ])
  assert.deepEqual(
    violations.map((item) => [item.fileName, item.kind]),
    [
      ['chunk-heavy.js', 'chunk'],
      ['entry.js', 'initial-graph'],
      ['feature.js', 'async-graph'],
    ],
  )
  assert.match(violations[1]?.reason ?? '', new RegExp(String(INITIAL_GRAPH_BUDGET_BYTES)))
  assert.match(violations[2]?.reason ?? '', new RegExp(String(ASYNC_GRAPH_BUDGET_BYTES)))
})

test('the physical chunk budget stays at Vite’s warning line while graph budgets remain explicit', () => {
  assert.equal(CHUNK_BUDGET_BYTES, 500_000)
  assert.equal(INITIAL_GRAPH_BUDGET_BYTES, 800_000)
  assert.equal(ASYNC_GRAPH_BUDGET_BYTES, 500_000)
  assert.equal(WORKER_BUDGET_BYTES, 1_400_000)
})

test('worker JavaScript assets have a separate aggregate gate that splitting cannot bypass', () => {
  const assets = [
    { fileName: 'parser.js', bytes: 1_000_000 },
    { fileName: 'parser-shared.mjs', bytes: 300_000 },
    { fileName: 'styles.css', bytes: 2_000_000 },
    { fileName: 'parser.js.map', bytes: 5_000_000 },
  ]
  assert.deepEqual(workerBudgetViolations(assets), [])
  const violations = workerBudgetViolations([...assets, { fileName: 'more.cjs', bytes: 100_001 }])
  assert.equal(violations.length, 1)
  assert.equal(violations[0].kind, 'worker')
  assert.equal(violations[0].bytes, 1_400_001)
  assert.equal(violations[0].limit, WORKER_BUDGET_BYTES)
})

test('the post generateBundle adapter rejects a Vite-injected preload map that pushes the final cold graph over budget', () => {
  const plugin = bundleBudgetPlugin()
  const hook = plugin.generateBundle as unknown as {
    order?: string
    handler?: (this: { error(message: string): never }, options: unknown, bundle: Record<string, unknown>) => void
  }
  assert.equal(hook.order, 'post', 'the budget gate runs after Vite normal-priority bundle mutations')
  assert.equal(typeof hook.handler, 'function')

  const injected = 'const __vite__mapDeps=(i)=>i;'
  const finalEntryCode = injected + 'x'.repeat(400_001 - injected.length)
  const encoder = new TextEncoder()
  assert.ok(encoder.encode(finalEntryCode.slice(injected.length)).byteLength + 400_000 <= INITIAL_GRAPH_BUDGET_BYTES,
    'the original chunks pass before the preload map is injected')
  assert.equal(encoder.encode(finalEntryCode).byteLength + 400_000, INITIAL_GRAPH_BUDGET_BYTES + 1,
    'the final emitted graph is one byte over budget')
  const bundle = {
    'entry.js': {
      type: 'chunk', fileName: 'entry.js', isEntry: true, code: finalEntryCode,
      imports: ['shared.js'], dynamicImports: [], modules: {},
    },
    'shared.js': {
      type: 'chunk', fileName: 'shared.js', isEntry: false, code: 'y'.repeat(400_000),
      imports: [], dynamicImports: [], modules: {},
    },
  }
  let failure = ''
  try {
    hook.handler!.call({ error(message) { throw new Error(message) } }, {}, bundle)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  assert.match(failure, /initial graph is 800001 bytes; budget is 800000/)
  assert.match(failure, /JavaScript bundle budget exceeded/)
})
