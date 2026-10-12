import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RelationOp, ToolActivity } from '../contract/index.ts'
import {
  ROUTINE_ARTIFACT_TOOL_NAME,
  createRoutineArtifactCapture,
  routineArtifactToolDefinition,
} from './routineArtifact.ts'
import { executeToolBatch } from './toolExecution.ts'

function options(capture: ReturnType<typeof createRoutineArtifactCapture>) {
  return {
    declaredNames: new Set([ROUTINE_ARTIFACT_TOOL_NAME]),
    connectorBindings: new Map(),
    context: { session: { id: 'routine-run', title: 'Routine run' } },
    relationOps: [] as RelationOp[],
    toolActivities: [] as ToolActivity[],
    routineArtifact: capture,
    limits: { maxCalls: 4, timeoutMs: 100 },
  }
}

const sheetBody = { type: 'sheet' as const, columns: ['Metric'], rows: [['42']] }

test('the routine tool declares only the approved structured body, never model-controlled name or kind', () => {
  const capture = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const definition = routineArtifactToolDefinition(capture)
  assert.equal(definition.name, ROUTINE_ARTIFACT_TOOL_NAME)
  assert.deepEqual(Object.keys(definition.input_schema.properties), ['body'])
  assert.deepEqual(definition.input_schema.required, ['body'])
  assert.equal(definition.input_schema.additionalProperties, false)
  assert.deepEqual(definition.input_schema.properties.body.oneOf?.map((schema) => schema.properties?.type.enum?.[0]), ['sheet', 'workbook'])
  assert.ok(definition.input_schema.properties.body.oneOf, 'the sheet kind declares legacy sheet and workbook body alternatives')
  assert.throws(() => createRoutineArtifactCapture({ name: 'recap.md', kind: 'doc' }), /sheet or slide/i)
})

test('a sheet-format routine can capture one complete named workbook candidate', async () => {
  const capture = createRoutineArtifactCapture({ name: 'metrics.xlsx', kind: 'sheet' })
  const body = {
    type: 'workbook' as const,
    sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric'], rows: [['42']] },
      { id: 'detail', name: 'Detail', columns: ['Metric'], rows: [['=literal']] },
    ],
  }
  const output = await executeToolBatch(
    [{ id: 'workbook', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body } }],
    options(capture),
  )
  assert.equal(output.results[0]?.isError, undefined)
  assert.deepEqual(capture.result, body)
})

test('routine tool schema admits only explicitly tagged formula cells and captures them detached', async () => {
  const capture = createRoutineArtifactCapture({ name: 'metrics.xlsx', kind: 'sheet' })
  const definition = routineArtifactToolDefinition(capture)
  const workbookSchema = definition.input_schema.properties.body.oneOf?.find((schema) => schema.properties?.type.enum?.[0] === 'workbook')
  const sheetSchema = definition.input_schema.properties.body.oneOf?.find((schema) => schema.properties?.type.enum?.[0] === 'sheet')
  assert.deepEqual(workbookSchema?.properties?.sheets?.items?.properties?.rows?.items?.items?.oneOf?.map((item) => item.type), ['string', 'object'])
  assert.deepEqual(sheetSchema?.properties?.rows?.items?.items?.oneOf?.map((item) => item.type), ['string', 'object'])
  const workbookCell = workbookSchema?.properties?.sheets?.items?.properties?.rows?.items?.items
  const sheetCell = sheetSchema?.properties?.rows?.items?.items
  assert.deepEqual(workbookCell, sheetCell, 'legacy sheet and workbook use the same strict cell contract')
  const formula = sheetCell?.oneOf?.[1]
  assert.equal(formula?.properties?.formula.type, 'string')
  assert.equal(formula?.properties?.formula.minLength, undefined, 'empty source remains admissible and is evaluated as #FORMULA!')
  assert.match(formula?.description ?? '', /named-sheet references such as Sheet!A1/)
  assert.match(formula?.description ?? '', /doubled apostrophes escape apostrophes/)
  assert.match(formula?.description ?? '', /#FORMULA!/)

  const body = { type: 'sheet' as const, columns: ['Formula', 'Literal'], rows: [[{ formula: '=1+1' }, '=1+1']] }
  const input = structuredClone(body)
  const output = await executeToolBatch(
    [{ id: 'formula-sheet', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: input } }],
    options(capture),
  )
  assert.equal(output.results[0]?.isError, undefined)
  assert.deepEqual(capture.result, body)
  input.rows[0]![0]!.formula = '=9'
  assert.deepEqual(capture.result, body, 'the accepted formula source is detached from model input')
})

test('one settled valid submission publishes one detached structured candidate and no product effects', async () => {
  const capture = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const raw = { body: structuredClone(sheetBody) }
  const h = options(capture)
  const out = await executeToolBatch([{ id: 'submit-1', name: ROUTINE_ARTIFACT_TOOL_NAME, input: raw }], h)
  assert.equal(out.results[0]?.isError, undefined)
  assert.deepEqual(capture.result, sheetBody)
  assert.equal(capture.failure, undefined)
  assert.deepEqual(h.relationOps, [])
  assert.deepEqual(h.toolActivities, [])

  raw.body.rows[0]![0] = 'mutated input'
  const observed = capture.result!
  observed.rows[0]![0] = 'mutated getter'
  assert.deepEqual(capture.result, { type: 'sheet', columns: ['Metric'], rows: [['42']] }, 'input and result reads cannot mutate the captured value')
})

test('malformed, wrong-kind, and authority-bearing submissions poison the capture', async () => {
  for (const input of [
    { body: { type: 'slides', slides: [{ title: 'Wrong', bullets: [] }] } },
    { body: { type: 'sheet', columns: ['A', 'B'], rows: [['not rectangular']] } },
    { name: 'other.sheet', kind: 'sheet', body: sheetBody },
  ]) {
    const capture = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
    const out = await executeToolBatch([{ id: 'bad', name: ROUTINE_ARTIFACT_TOOL_NAME, input }], options(capture))
    assert.equal(out.results[0]?.isError, true)
    assert.equal(capture.result, undefined)
    assert.equal(capture.failure, 'invalid_candidate')
  }
})

test('a duplicate submission poisons and removes an earlier valid candidate', async () => {
  const capture = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const out = await executeToolBatch([
    { id: 'first', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } },
    { id: 'second', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } },
  ], options(capture))
  assert.equal(out.results[0]?.isError, undefined)
  assert.equal(out.results[1]?.isError, true)
  assert.equal(capture.result, undefined)
  assert.equal(capture.failure, 'duplicate_candidate')
})

test('a repeated declared submission refused by the call ceiling still poisons the first candidate', async () => {
  const capture = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const h = options(capture)
  h.limits = { maxCalls: 1, timeoutMs: 100 }
  const out = await executeToolBatch([
    { id: 'first', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } },
    { id: 'over-limit', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } },
  ], h)
  assert.equal(out.results[0]?.isError, undefined)
  assert.equal(out.results[1]?.isError, true)
  assert.equal(capture.result, undefined)
  assert.equal(capture.failure, 'duplicate_candidate')
})

test('the declared-name wall, caller cancellation, and expired turn deadline publish nothing', async () => {
  const undeclared = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const undeclaredOptions = options(undeclared)
  undeclaredOptions.declaredNames = new Set()
  const refused = await executeToolBatch(
    [{ id: 'undeclared', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } }],
    undeclaredOptions,
  )
  assert.equal(refused.results[0]?.isError, true)
  assert.equal(undeclared.result, undefined)
  assert.equal(undeclared.failure, undefined)

  const cancelled = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(executeToolBatch(
    [{ id: 'cancelled', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } }],
    { ...options(cancelled), signal: controller.signal },
  ), /cancelled/i)
  assert.equal(cancelled.result, undefined)
  assert.equal(cancelled.failure, undefined)

  const expired = createRoutineArtifactCapture({ name: 'metrics.sheet', kind: 'sheet' })
  const late = await executeToolBatch(
    [{ id: 'late', name: ROUTINE_ARTIFACT_TOOL_NAME, input: { body: sheetBody } }],
    { ...options(expired), deadlineAt: Date.now() - 1 },
  )
  assert.equal(late.results[0]?.isError, true)
  assert.equal(expired.result, undefined)
  assert.equal(expired.failure, undefined)
})
