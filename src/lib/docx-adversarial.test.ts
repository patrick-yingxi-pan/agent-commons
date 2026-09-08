import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docxFixture } from '../../tests/helpers/docxFixture.mjs'
import { MAX_DOCX_PART_BYTES } from '../../contract/docxImport.mjs'
import { docxBodyText } from './docxText.ts'
import { extractDocx } from './docxExtraction.ts'
import { createDocxImporter } from './docxImport.ts'

const CENTRAL_SIGNATURE = Buffer.from('PK\x01\x02')
const END_SIGNATURE = Buffer.from('PK\x05\x06')

function archiveLayout(bytes: Buffer) {
  const end = bytes.lastIndexOf(END_SIGNATURE)
  assert.ok(end >= 0, 'fixture has an EOCD record')
  const count = bytes.readUInt16LE(end + 10)
  const centralSize = bytes.readUInt32LE(end + 12)
  const centralOffset = bytes.readUInt32LE(end + 16)
  assert.equal(end, centralOffset + centralSize, 'fixture central directory ends at EOCD')
  const records: Array<{ offset: number; end: number; name: string; localOffset: number }> = []
  let offset = centralOffset
  while (offset < centralOffset + centralSize) {
    assert.deepEqual(bytes.subarray(offset, offset + 4), CENTRAL_SIGNATURE, 'central record signature')
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength
    assert.ok(recordEnd <= centralOffset + centralSize, 'central record stays inside directory')
    records.push({
      offset,
      end: recordEnd,
      name: bytes.subarray(offset + 46, offset + 46 + nameLength).toString(),
      localOffset: bytes.readUInt32LE(offset + 42),
    })
    offset = recordEnd
  }
  assert.equal(offset, centralOffset + centralSize)
  assert.equal(records.length, count, 'central record count matches EOCD')
  return { end, count, centralSize, centralOffset, records }
}

function mainRecord(bytes: Buffer) {
  const layout = archiveLayout(bytes)
  const record = layout.records.find((entry) => entry.name === 'word/document.xml')
  assert.ok(record, 'fixture has the authoritative main part record')
  return { layout, record }
}

test('keeps moved-to content once while ignoring the old move-from source', () => {
  const body = docxBodyText(`
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>kept</w:t></w:r></w:p>
        <w:moveFrom><w:p><w:r><w:t>moved</w:t></w:r></w:p></w:moveFrom>
        <w:moveTo><w:p><w:r><w:t>moved</w:t></w:r></w:p></w:moveTo>
        <w:sectPr/>
      </w:body>
    </w:document>
  `)
  assert.equal(body, 'kept\nmoved')
  assert.equal(body.match(/moved/g)?.length, 1)
})

test('converts a synchronous worker-loader throw into an unavailable outcome and releases the queue', async () => {
  const run = createDocxImporter(() => { throw new Error('loader failed before returning a promise') }, { timeoutMs: 20 })
  const settle = (promise: Promise<unknown>) => promise.catch((error) => error)
  const [first, second] = await Promise.all([settle(run(new Uint8Array([1]))), settle(run(new Uint8Array([2])))])
  assert.equal((first as { documentImport?: { status?: string } }).documentImport?.status, 'unavailable')
  assert.equal((second as { documentImport?: { status?: string } }).documentImport?.status, 'unavailable')
})

test('rejects a spoofed central-directory expanded size before allocating the part', async () => {
  const bytes = Buffer.from(docxFixture({ paragraphs: ['body'] }))
  const { record } = mainRecord(bytes)
  const originalSize = bytes.readUInt32LE(record.offset + 24)
  assert.ok(originalSize < MAX_DOCX_PART_BYTES, 'fixture starts below the part limit')
  assert.equal(bytes.readUInt32LE(record.localOffset + 22), originalSize, 'fixture central/local sizes agree')
  bytes.writeUInt32LE(MAX_DOCX_PART_BYTES + 1, record.offset + 24)
  assert.notEqual(bytes.readUInt32LE(record.offset + 24), originalSize, 'central size mutation is real')
  assert.deepEqual(await extractDocx(bytes), { documentImport: { format: 'docx', status: 'structure-limit' } })
})

test('rejects duplicate central-directory part identities under strict ZIP parsing', async () => {
  const bytes = Buffer.from(docxFixture({ paragraphs: ['body'] }))
  const { layout, record } = mainRecord(bytes)
  const duplicate = bytes.subarray(record.offset, record.end)
  const central = bytes.subarray(layout.centralOffset, layout.end)
  const tail = bytes.subarray(layout.end)
  const mutated = Buffer.concat([bytes.subarray(0, layout.centralOffset), central, duplicate, tail])
  const mutatedEnd = mutated.length - tail.length
  mutated.writeUInt16LE(layout.count + 1, mutatedEnd + 8)
  mutated.writeUInt16LE(layout.count + 1, mutatedEnd + 10)
  mutated.writeUInt32LE(layout.centralSize + duplicate.length, mutatedEnd + 12)
  const duplicateLayout = archiveLayout(mutated)
  assert.equal(duplicateLayout.records.filter((entry) => entry.name === 'word/document.xml').length, 2, 'duplicate central identity is present')
  assert.equal((await extractDocx(mutated)).documentImport.status, 'invalid')
})

test('rejects a local-header filename that disagrees with the central part identity', async () => {
  const bytes = Buffer.from(docxFixture({ paragraphs: ['body'] }))
  const { record } = mainRecord(bytes)
  const localNameLength = bytes.readUInt16LE(record.localOffset + 26)
  assert.equal(localNameLength, Buffer.byteLength(record.name), 'fixture local name length matches central name')
  const spoofedName = Buffer.from('word/documenX.xml')
  assert.equal(spoofedName.length, localNameLength, 'spoofed local name preserves bounded header shape')
  spoofedName.copy(bytes, record.localOffset + 30)
  assert.notEqual(bytes.subarray(record.localOffset + 30, record.localOffset + 30 + localNameLength).toString(), record.name, 'local filename mutation is real')
  assert.equal((await extractDocx(bytes)).documentImport.status, 'invalid')
})
