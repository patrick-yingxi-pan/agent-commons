import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbookImporter } from './workbookImport.ts'

const workbook = () => ({
  totalSheets: 1,
  hiddenSheets: 0,
  unsupportedSheets: 0,
  worksheets: [{ sourceSheet: 1, name: 'Sheet1', cells: [{ row: 1, column: 1, value: 'value' }] }],
})

function workerHarness(result: unknown, seen: { request?: unknown; terminated?: number } = {}) {
  return async () => () => {
    const worker = {
      postMessage(request: unknown) { seen.request = request; queueMicrotask(() => worker.onmessage?.({ data: result })) },
      terminate() { seen.terminated = (seen.terminated ?? 0) + 1 },
      onmessage: undefined as ((event: MessageEvent) => void) | null, onerror: null, onmessageerror: null,
    }
    return worker as unknown as Worker
  }
}

test('workbook importer sends the structural worker format and returns a detached snapshot', async () => {
  const source = workbook()
  const seen: { request?: unknown; terminated?: number } = {}
  const result = await createWorkbookImporter(workerHarness({
    documentImport: { format: 'xlsx', status: 'ready' }, workbook: source,
  }, seen))(new Uint8Array([1, 2, 3]))

  assert.equal((seen.request as { format: string }).format, 'xlsx-workbook')
  assert.deepEqual(result.workbook, workbook())
  assert.notEqual(result.workbook, source)
  assert.notEqual(result.workbook?.worksheets[0], source.worksheets[0])
  source.worksheets[0].cells[0].value = 'mutated'
  assert.equal(result.workbook?.worksheets[0].cells[0].value, 'value')
  assert.equal(seen.terminated, 1)
})

test('malformed and text-mixed workbook worker outcomes are refused', async () => {
  const malformed = await createWorkbookImporter(workerHarness({
    documentImport: { format: 'xlsx', status: 'ready' }, workbook: { ...workbook(), worksheets: [] },
  }))(new Uint8Array([1]))
  assert.deepEqual(malformed, { documentImport: { format: 'xlsx', status: 'invalid' } })

  const mixed = await createWorkbookImporter(workerHarness({
    documentImport: { format: 'xlsx', status: 'ready' }, workbook: workbook(), text: 'second source',
  }))(new Uint8Array([1]))
  assert.deepEqual(mixed, { documentImport: { format: 'xlsx', status: 'invalid' } })
})

test('pre-aborted workbook imports do not create a worker', async () => {
  let loads = 0
  const controller = new AbortController()
  controller.abort()
  const result = await createWorkbookImporter(async () => { loads++; return workerHarness({})() })(new Uint8Array([1]), controller.signal)
  assert.deepEqual(result, { documentImport: { format: 'xlsx', status: 'unavailable' } })
  assert.equal(loads, 0)
})

test('late workbook worker responses are fenced after cancellation and terminate the worker', async () => {
  let worker: Worker | undefined
  let terminated = 0
  const load = async () => () => {
    const created = {
      postMessage() {}, terminate() { terminated++ }, onmessage: null, onerror: null, onmessageerror: null,
    } as unknown as Worker
    worker = created
    return created
  }
  const controller = new AbortController()
  const pending = createWorkbookImporter(load)(new Uint8Array([1]), controller.signal)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  controller.abort()
  const result = await pending
  worker?.onmessage?.({ data: { documentImport: { format: 'xlsx', status: 'ready' }, workbook: workbook() } } as MessageEvent)
  assert.deepEqual(result, { documentImport: { format: 'xlsx', status: 'unavailable' } })
  assert.equal(terminated, 1)
})
