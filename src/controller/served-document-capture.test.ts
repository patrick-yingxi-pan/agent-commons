import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureServedDocument } from './servedDocumentCapture.ts'
import { refreshAccount } from '../api/account.ts'
import { documentReaderForName } from '../lib/documentFileImport.ts'
import { documentFormatForName } from '../../contract/servedTextSnapshot.ts'

const id = '11111111-1111-4111-8111-111111111111'
const ready = { text: 'whole extracted text', documentImport: { format: 'docx', status: 'ready' } }

function deps(read = async () => ready) {
  return { read: async () => new Uint8Array([1]), reader: () => ({ maxBytes: 8, read }) } as unknown as Parameters<typeof captureServedDocument>[4]
}

test('local and served document intake share the four format readers and byte ceilings', () => {
  for (const format of ['pdf', 'docx', 'xlsx', 'pptx']) {
    const name = `docs/FILE.${format.toUpperCase()}`
    const reader = documentReaderForName(name)
    assert.equal(documentFormatForName(name), format)
    assert.ok(reader)
    assert.equal(reader.maxBytes, 8 * 1024 * 1024)
    assert.equal(reader.failure('file-too-large').documentImport.format, format)
  }
  for (const name of ['pdf', 'old.doc', 'macro.xlsm', 'deck.ppt', 'image.png']) assert.equal(documentReaderForName(name), undefined)
})

test('explicit extraction saves only a validated text projection under the requested identity', async () => {
  const snapshot = await captureServedDocument('cloud', 'report.docx', id, undefined, deps())
  assert.deepEqual({ ...snapshot, capturedAt: 'time' }, {
    version: 2, snapshotId: id, capturedAt: 'time', sourceId: 'cloud', path: 'report.docx', ...ready,
  })
  assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)))
  assert.equal('bytes' in snapshot, false)
})

test('failed or partial extraction never becomes a saved document', async () => {
  for (const result of [
    { documentImport: { format: 'docx', status: 'invalid' } },
    { text: 'partial', documentImport: { format: 'docx', status: 'text-limit' } },
    { ...ready, text: 'x'.repeat(65_537) },
    { ...ready, documentImport: { format: 'xlsx', status: 'ready' } },
  ]) await assert.rejects(captureServedDocument('cloud', 'report.docx', id, undefined, deps(async () => result)), /not imported|invalid saved copy/)
})

test('cancellation and account changes during extraction cancel the importer and withhold output', async () => {
  for (const kind of ['account', 'cancel']) {
    const controller = new AbortController()
    let parserSignal: AbortSignal | undefined
    const custom = deps(async (_bytes, signal) => {
      parserSignal = signal
      if (kind === 'account') refreshAccount({ userId: 'other', tenantId: 'other' })
      else controller.abort()
      return ready
    })
    try {
      await assert.rejects(captureServedDocument('cloud', 'report.docx', id, controller.signal, custom), /account changed|aborted/i)
      assert.equal(parserSignal?.aborted, true)
    } finally { refreshAccount(null) }
  }
})
