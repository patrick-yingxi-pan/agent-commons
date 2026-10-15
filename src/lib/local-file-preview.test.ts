import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareLocalFilePreview } from './localFilePreview.ts'
import type { LocalFolderFilePreview } from '../../contract/localFolderBrowse.mjs'

const formats = ['pdf', 'docx', 'xlsx', 'pptx'] as const
function native(format: typeof formats[number]): LocalFolderFilePreview {
  return { version: 1, path: `reports/result.${format}`, sizeBytes: 4, snapshot: { document: { format, bytes: new Uint8Array([1, 2, 3, 4]) } } }
}
const ready = (format: typeof formats[number]) => format === 'pdf'
  ? { format, status: 'ready', pages: 2, textPages: 1 } as const : { format, status: 'ready' } as const

test('one selected Office read retains independently bounded detached structure and exact text', async () => {
  const workbook = { totalSheets: 1, hiddenSheets: 0, unsupportedSheets: 0,
    worksheets: [{ sourceSheet: 1, name: 'Data', cells: [{ row: 1, column: 1, value: 'literal' }] }] }
  const presentation = { totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: ['literal'] }] }
  for (const format of ['xlsx', 'pptx'] as const) {
    const key = format === 'xlsx' ? 'workbookImport' : 'presentationImport'
    const structure = { documentImport: ready(format), ...(format === 'xlsx' ? { workbook } : { presentation }) }
    for (const textReady of [true, false]) {
      let reads = 0
      const preview = await prepareLocalFilePreview(native(format), new AbortController().signal, async () => ({ read: async () => {
        reads++
        return { documentImport: textReady ? ready(format) : { format, status: 'text-limit' },
          ...(textReady ? { text: 'exact\ntext\n' } : {}), [key]: structure }
      } }))
      assert.equal(reads, 1)
      assert.equal(preview.documentImport?.status, textReady ? 'ready' : 'text-limit')
      assert.equal(preview.snapshot.text, textReady ? 'exact\ntext\n' : undefined)
      assert.deepEqual(preview[key], structure)
      assert.notEqual(preview[key], structure)
      assert.equal('document' in preview.snapshot, false)
      assert.equal(JSON.stringify(preview).includes('bytes'), false)
    }
    const textOnly = await prepareLocalFilePreview(native(format), new AbortController().signal,
      async () => ({ read: async () => ({ documentImport: ready(format), text: 'still attachable',
        [key]: { documentImport: { format, status: 'text-limit' } } }) }))
    assert.equal(textOnly.snapshot.text, 'still attachable')
    assert.equal(textOnly[key]?.documentImport.status, 'text-limit')
  }
})

test('cross-format structure and extra byte fields cannot escape through the combined preview path', async () => {
  for (const result of [
    { documentImport: ready('xlsx'), text: 'body', presentationImport: { documentImport: { format: 'pptx', status: 'no-text' } } },
    { documentImport: ready('xlsx'), text: 'body', workbookImport: { documentImport: { format: 'xlsx', status: 'no-text' } }, bytes: new Uint8Array([1]) },
  ]) {
    const preview = await prepareLocalFilePreview(native('xlsx'), new AbortController().signal, async () => ({ read: async () => result }))
    assert.equal(preview.documentImport?.status, 'invalid')
    assert.equal(preview.snapshot.text, undefined)
    assert.equal(preview.workbookImport?.documentImport.status, 'invalid')
    assert.equal('bytes' in preview, false)
  }
})

test('only explicitly enabled selected PDF previews retain detached transient OCR bytes', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 captured fixture')
  const input: LocalFolderFilePreview = { version: 1, path: 'scan.pdf', sizeBytes: bytes.length,
    snapshot: { document: { format: 'pdf', bytes } } }
  const signal = new AbortController().signal
  const loader = async () => ({ read: async () => ({ documentImport: { format: 'pdf', status: 'no-text', pages: 1, textPages: 0 } }) })
  const ordinary = await prepareLocalFilePreview(input, signal, loader)
  assert.equal('pdfOcrInput' in ordinary, false)
  for (const outcome of [
    { documentImport: { format: 'pdf', status: 'no-text', pages: 1, textPages: 0 } },
    { documentImport: { format: 'pdf', status: 'protected' } },
    { documentImport: ready('pdf'), text: 'embedded text' },
  ]) {
    const result = await prepareLocalFilePreview(input, signal, async () => ({ read: async () => outcome }), undefined, { retainPdfOcrInput: true })
    assert.deepEqual(result.pdfOcrInput, bytes)
    assert.notEqual(result.pdfOcrInput, bytes)
    assert.equal('document' in result.snapshot, false)
  }
  const original = bytes.slice()
  const transferred = await prepareLocalFilePreview(input, signal, async () => ({ read: async candidate => {
    structuredClone(candidate, { transfer: [candidate.buffer as ArrayBuffer] })
    return { documentImport: ready('pdf'), text: 'embedded' }
  } }), undefined, { retainPdfOcrInput: true })
  assert.equal(bytes.byteLength, 0)
  assert.deepEqual(transferred.pdfOcrInput, original)
})

test('invalid or mismatched PDF bytes and other formats never acquire OCR eligibility', async () => {
  for (const input of [native('pdf'), native('docx'), native('xlsx'), native('pptx'),
    { version: 1, path: 'scan.pdf', sizeBytes: 9, snapshot: { document: { format: 'pdf', bytes: new TextEncoder().encode('%PDF-1.7') } } },
  ] as LocalFolderFilePreview[]) {
    const result = await prepareLocalFilePreview(input, new AbortController().signal,
      async () => ({ read: async () => ({ text: 'text', documentImport: ready(input.path.split('.').at(-1) as typeof formats[number]) }) }),
      undefined, { retainPdfOcrInput: true })
    assert.equal(result.pdfOcrInput, undefined)
  }
})

test('embedded extraction cannot claim OCR provenance', async () => {
  const result = await prepareLocalFilePreview(native('pdf'), new AbortController().signal,
    async () => ({ read: async () => ({ text: 'text', documentImport: { ...ready('pdf'), method: 'ocr' } }) }))
  assert.deepEqual(result.documentImport, { format: 'pdf', status: 'invalid' })
  assert.deepEqual(result.snapshot, { omitted: 'document-extraction' })
})

for (const format of formats) test(`${format} publishes only exact extracted text and a detached validated outcome`, async () => {
  const input = native(format)
  const documentImport = ready(format)
  const signal = new AbortController().signal
  const result = await prepareLocalFilePreview(input, signal, async path => {
    assert.equal(path, input.path)
    return { read: async (bytes, receivedSignal) => {
      assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4]))
      assert.equal(receivedSignal, signal)
      return { text: 'exact extracted\ntext\n', documentImport }
    } }
  })
  assert.deepEqual(result, { version: 1, path: input.path, sizeBytes: 4, snapshot: { text: 'exact extracted\ntext\n' }, documentImport })
  assert.notEqual(result.documentImport, documentImport)
  assert.equal(JSON.stringify(result).includes('bytes'), false)
  assert.equal('document' in result.snapshot, false)
})

test('text and native omissions never load document readers; source size is not the extracted-text limit', async () => {
  let loads = 0
  const load = async () => { loads++; return undefined }
  const signal = new AbortController().signal
  assert.deepEqual(await prepareLocalFilePreview({ version: 1, path: 'empty.txt', sizeBytes: 0, snapshot: { text: '' } }, signal, load),
    { version: 1, path: 'empty.txt', sizeBytes: 0, snapshot: { text: '' } })
  const tooLarge = await prepareLocalFilePreview({ version: 1, path: 'huge.xlsx', sizeBytes: 8 * 1024 * 1024 + 1, snapshot: { omitted: 'too-large' } }, signal, load)
  assert.deepEqual(tooLarge.documentImport, { format: 'xlsx', status: 'file-too-large' })
  assert.equal(loads, 0)
  const input = { ...native('docx'), sizeBytes: 100_000 }
  const result = await prepareLocalFilePreview(input, signal, async () => ({ read: async () => ({ text: 'short extracted text', documentImport: ready('docx') }) }))
  assert.equal(result.snapshot.text, 'short extracted text')
  assert.equal(result.sizeBytes, 100_000)
})

test('format-specific no-text, protected, unsupported and timeout outcomes are retained without attachable text', async () => {
  for (const documentImport of [
    { format: 'pdf', status: 'no-text', pages: 2, textPages: 0 }, { format: 'pdf', status: 'protected' },
    { format: 'docx', status: 'no-text' }, { format: 'xlsx', status: 'unsupported' }, { format: 'pptx', status: 'timeout' },
  ] as const) {
    const result = await prepareLocalFilePreview(native(documentImport.format), new AbortController().signal, async () => ({ read: async () => ({ documentImport }) }))
    assert.deepEqual(result.documentImport, documentImport)
    assert.deepEqual(result.snapshot, { omitted: 'document-extraction' })
  }
})

test('malformed, partial, cross-format and over-budget extracted results fail closed without clipping', async () => {
  for (const [result, status] of [
    [{ text: 'unsafe', documentImport: ready('xlsx') }, 'invalid'],
    [{ text: 'partial', documentImport: { format: 'docx', status: 'timeout' } }, 'invalid'],
    [{ text: ' ', documentImport: ready('docx') }, 'invalid'],
    [{ text: 'secret', documentImport: ready('docx'), bytes: new Uint8Array([1]) }, 'invalid'],
    [{ text: 'x'.repeat(65_537), documentImport: ready('docx') }, 'text-limit'],
    [{ text: 'é'.repeat(32_769), documentImport: ready('docx') }, 'text-limit'],
    [{ text: 'body', documentImport: { ...ready('docx'), privatePath: '/private/source' } }, 'invalid'],
  ] as const) {
    const preview = await prepareLocalFilePreview(native('docx'), new AbortController().signal, async () => ({ read: async () => result }))
    assert.deepEqual(preview.snapshot, { omitted: 'document-extraction' })
    assert.deepEqual(preview.documentImport, { format: 'docx', status })
  }
  const accepted = await prepareLocalFilePreview(native('docx'), new AbortController().signal, async () => ({ read: async () => ({ text: 'é'.repeat(32_768), documentImport: ready('docx') }) }))
  assert.equal(accepted.snapshot.text, 'é'.repeat(32_768))
})

test('abort before loading, during lazy loading, and during extraction never returns late document text', async () => {
  const before = new AbortController(); before.abort()
  await assert.rejects(prepareLocalFilePreview(native('pdf'), before.signal, async () => { assert.fail('cancelled result must not load the importer') }))
  const duringLoad = new AbortController()
  await assert.rejects(prepareLocalFilePreview(native('pdf'), duringLoad.signal, async () => {
    duringLoad.abort()
    return { read: async () => { assert.fail('cancelled lazy load must not start extraction') } }
  }))
  const duringExtraction = new AbortController()
  await assert.rejects(prepareLocalFilePreview(native('pdf'), duringExtraction.signal, async () => ({
    read: async (_bytes, signal) => {
      assert.equal(signal, duringExtraction.signal)
      duringExtraction.abort()
      return { text: 'late private body', documentImport: ready('pdf') }
    },
  })))
})

test('non-enumerable outcome fields cannot validate then disappear from the stored projection', async () => {
  const documentImport = Object.defineProperties({}, {
    format: { value: 'pdf', enumerable: false }, status: { value: 'no-text', enumerable: false },
    pages: { value: 1, enumerable: false }, textPages: { value: 0, enumerable: false },
  })
  const preview = await prepareLocalFilePreview(native('pdf'), new AbortController().signal, async () => ({ read: async () => ({ documentImport }) }))
  assert.deepEqual(preview.documentImport, { format: 'pdf', status: 'invalid' })
  assert.deepEqual(preview.snapshot, { omitted: 'document-extraction' })
})

test('cancellation settles before a stalled lazy loader finishes and cannot start late extraction', async () => {
  const controller = new AbortController()
  let finish!: (reader: { read: () => Promise<unknown> }) => void
  const operation = prepareLocalFilePreview(native('pdf'), controller.signal, () => new Promise(resolve => { finish = resolve }))
  controller.abort()
  const outcome = await Promise.race([
    operation.then(() => 'resolved', () => 'aborted'),
    new Promise(resolve => setImmediate(() => resolve('still pending'))),
  ])
  finish({ read: async () => { assert.fail('late loader may not start extraction') } })
  await assert.rejects(operation)
  assert.equal(outcome, 'aborted')
})
