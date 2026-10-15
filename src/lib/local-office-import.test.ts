import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalPptxImporter, createLocalXlsxImporter } from './localOfficeImport.ts'
import { parseLocalOfficeImportResult } from './localOfficeImportResult.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror = null
  onmessageerror = null
  stopped = 0
  sent: unknown[] = []
  postMessage(value: unknown) { this.sent.push(value) }
  terminate() { this.stopped += 1 }
  answer(value: unknown) { this.onmessage?.({ data: value }) }
}

test('local Office importer requests one combined parse and detaches the validated structure', async () => {
  const port = new Port()
  const run = createLocalXlsxImporter(async () => () => port)
  const resultPromise = run(new Uint8Array([1, 2]))
  await tick()
  assert.deepEqual(port.sent, [{ format: 'xlsx-preview', bytes: new Uint8Array([1, 2]) }])
  const source = { totalSheets: 1, hiddenSheets: 0, unsupportedSheets: 0, worksheets: [{ sourceSheet: 1, name: 'Sparse', cells: [{ row: 1, column: 3, value: 'C1', formula: 'cached' }] }] }
  port.answer({ text: 'Sheet: "Sparse"\nC1: "C1"\n', documentImport: { format: 'xlsx', status: 'ready' },
    workbookImport: { documentImport: { format: 'xlsx', status: 'ready' }, workbook: source } })
  const result = await resultPromise
  assert.equal(result.documentImport.status, 'ready')
  assert.equal(result.text, 'Sheet: "Sparse"\nC1: "C1"\n')
  assert.deepEqual(result.workbookImport?.workbook, source)
  assert.notEqual(result.workbookImport?.workbook, source)
  assert.equal(port.stopped, 1)
})

test('malformed combined result is refused closed, including accessors and extra data', () => {
  const goodWorkbook = { documentImport: { format: 'xlsx', status: 'no-text' } }
  const getter = Object.defineProperty({ documentImport: { format: 'xlsx', status: 'ready' } }, 'text', { enumerable: true, get() { throw new Error('must not execute') } })
  for (const value of [
    { text: 'body', documentImport: { format: 'xlsx', status: 'ready' }, workbookImport: goodWorkbook, bytes: new Uint8Array([1]) },
    getter,
  ]) {
    assert.equal(parseLocalOfficeImportResult(value, 'xlsx').documentImport.status, 'invalid')
  }
  const malformedStructure = parseLocalOfficeImportResult({ text: 'body', documentImport: { format: 'xlsx', status: 'ready' },
    workbookImport: { documentImport: { format: 'xlsx', status: 'ready' }, workbook: { worksheets: [] } } }, 'xlsx')
  assert.equal(malformedStructure.documentImport.status, 'ready', 'structure refusal cannot discard independently valid attachment text')
  assert.equal(malformedStructure.workbookImport?.documentImport.status, 'invalid')
})

test('combined worker envelopes require own text, document, and format structure fields', () => {
  const ready = { format: 'xlsx', status: 'ready' as const }
  const structure = { documentImport: { format: 'xlsx', status: 'no-text' as const } }
  const restore = (key: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(Object.prototype, key, descriptor)
    else delete (Object.prototype as Record<string, unknown>)[key]
  }
  const fields = ['text', 'documentImport', 'workbookImport']
  const previous = new Map(fields.map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]))
  try {
    Object.defineProperty(Object.prototype, 'text', { value: 'inherited text', enumerable: true, configurable: true })
    assert.equal(parseLocalOfficeImportResult({ documentImport: ready, workbookImport: structure }, 'xlsx').documentImport.status, 'invalid')

    delete (Object.prototype as Record<string, unknown>).text
    Object.defineProperty(Object.prototype, 'workbookImport', { value: structure, enumerable: true, configurable: true })
    assert.equal(parseLocalOfficeImportResult({ text: 'body', documentImport: ready }, 'xlsx').documentImport.status, 'invalid')

    delete (Object.prototype as Record<string, unknown>).workbookImport
    Object.defineProperty(Object.prototype, 'documentImport', { value: ready, enumerable: true, configurable: true })
    assert.equal(parseLocalOfficeImportResult({ text: 'body', workbookImport: structure }, 'xlsx').documentImport.status, 'invalid')
  } finally {
    for (const [key, descriptor] of previous) restore(key, descriptor)
  }
})

test('abort terminates combined worker and late structure cannot escape', async () => {
  const port = new Port()
  const run = createLocalPptxImporter(async () => () => port)
  const abort = new AbortController()
  const pending = run(new Uint8Array([1]), abort.signal)
  await tick()
  abort.abort()
  const result = await pending
  assert.equal(result.documentImport.status, 'unavailable')
  assert.equal(result.presentationImport?.documentImport.status, 'unavailable')
  assert.equal(port.stopped, 1)
  port.answer({ text: 'late', documentImport: { format: 'pptx', status: 'ready' }, presentationImport: { documentImport: { format: 'pptx', status: 'ready' }, presentation: { totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: ['late'] }] } } })
  assert.equal(result.text, undefined)
})
