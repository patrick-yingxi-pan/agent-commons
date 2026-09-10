import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { sheetXlsx } from './artifactXlsx.ts'
import { slidesPptx } from './artifactPptx.ts'
import { documentDocx } from './artifactDocx.ts'
import { writeOfficeZip } from './artifactOfficeZip.ts'

function localHeaders(bytes: Uint8Array): Array<{ flags: number; compressedSize: number; uncompressedSize: number; name: string }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result: Array<{ flags: number; compressedSize: number; uncompressedSize: number; name: string }> = []
  let offset = 0
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const uncompressedSize = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    result.push({ flags, compressedSize, uncompressedSize, name })
    offset += 30 + nameLength + extraLength + compressedSize
  }
  assert.equal(offset + 4 <= bytes.byteLength, true, 'local entries terminate at the central directory')
  assert.equal(view.getUint32(offset, true), 0x02014b50, 'central directory follows local entries')
  return result
}

async function assertOfficeHeaders(bytes: Uint8Array, expectedNames: string[]): Promise<void> {
  const headers = localHeaders(bytes)
  assert.deepEqual(headers.map((header) => header.name), expectedNames)
  assert.ok(headers.every((header) => (header.flags & 0x08) === 0), 'every local header has complete sizes and no data descriptor flag')
  assert.ok(headers.every((header) => header.compressedSize === header.uncompressedSize), 'stored entries carry matching local sizes')
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { checkSignature: true })
  try {
    const entries = await reader.getEntries()
    assert.deepEqual(entries.map((entry) => entry.filename), expectedNames)
    for (const entry of entries) await entry.getData!(new TextWriter(), { checkSignature: true })
  } finally { await reader.close() }
}

test('office ZIP finalization is deterministic and writes complete local headers', async () => {
  const parts = [['a.xml', '<a/>'], ['word/document.xml', '<w:document/>']] as const
  const first = await writeOfficeZip(parts)
  assert.deepEqual(await writeOfficeZip(parts), first)
  await assertOfficeHeaders(first, ['a.xml', 'word/document.xml'])
})

test('actual XLSX, PPTX, and DOCX packages visit every entry with complete local headers', async () => {
  const xlsx = await sheetXlsx('headers.xlsx', { type: 'sheet', columns: ['Name'], rows: [['Ada']] })
  const pptx = await slidesPptx('headers.pptx', { type: 'slides', slides: [{ title: 'Title', bullets: ['Body'] }] })
  const docx = await documentDocx('headers.docx', { type: 'doc', title: 'Title', blocks: [{ p: 'Body' }] })
  assert.ok(docx)
  for (const exported of [xlsx, pptx, docx]) {
    const bytes = Uint8Array.from(Buffer.from(exported.content, 'base64'))
    await assertOfficeHeaders(bytes, localHeaders(bytes).map((header) => header.name))
  }
})
