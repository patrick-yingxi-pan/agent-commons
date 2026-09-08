import { inflateRawSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { docxFixture } from './docxFixture.mjs'
import { extractDocx } from '../../src/lib/docxExtraction.ts'

function readEntries(source: Buffer) {
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset + 4 <= source.length && source.readUInt32LE(offset) === 0x04034b50) {
    const flags = source.readUInt16LE(offset + 6)
    const method = source.readUInt16LE(offset + 8)
    const compressedSize = source.readUInt32LE(offset + 18)
    const nameSize = source.readUInt16LE(offset + 26)
    const extraSize = source.readUInt16LE(offset + 28)
    const name = source.subarray(offset + 30, offset + 30 + nameSize).toString('utf8')
    const start = offset + 30 + nameSize + extraSize
    const compressed = source.subarray(start, start + compressedSize)
    if (flags & 8) throw new Error('fixture must not use data descriptors')
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed)
    offset = start + compressedSize
  }
  return entries
}

test('DOCX fixture is deterministic and contains a real OOXML package with escaped Unicode paragraphs', () => {
    const options = { paragraphs: ['A & <B>', 'café 世界 😀'] }
    const first = docxFixture(options)
    assert.deepEqual(docxFixture(options), first)
    assert.equal(first.subarray(0, 4).toString('hex'), '504b0304')
    const entries = readEntries(first)
    assert.deepEqual([...entries.keys()], ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
    const document = entries.get('word/document.xml')!.toString('utf8')
    assert.match(document, /A &amp; &lt;B&gt;/)
    assert.match(document, /café 世界 😀/)
    assert.match(document, /http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main/)
    assert.match(entries.get('_rels/.rels')!.toString('utf8'), /Target="word\/document\.xml"/)
})

test('DOCX fixture supports strict namespaces, custom main part, raw body XML and extra entries', () => {
    const source = docxFixture({
      strict: true,
      documentPath: 'word/custom.xml',
      bodyXml: '<w:p xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:r><w:tab/><w:br/></w:r></w:p>',
      entries: { 'word/extra.xml': '<extra>fixture</extra>' },
    })
    const entries = readEntries(source)
    assert.deepEqual([...entries.keys()], ['[Content_Types].xml', '_rels/.rels', 'word/custom.xml', 'word/extra.xml'])
    assert.match(entries.get('word/custom.xml')!.toString('utf8'), /http:\/\/purl\.oclc\.org\/ooxml\/wordprocessingml\/main/)
    assert.match(entries.get('[Content_Types].xml')!.toString('utf8'), /PartName="\/word\/custom\.xml"/)
    assert.match(entries.get('_rels/.rels')!.toString('utf8'), /Target="word\/custom\.xml"/)
})

test('DOCX fixture entries replace generated parts and compound fixtures are unsupported containers', () => {
    const overridden = docxFixture({ entries: { 'word/document.xml': '<broken/>' } })
    assert.equal(readEntries(overridden).get('word/document.xml')!.toString(), '<broken/>')
    const compoundBytes = docxFixture({ compoundContainer: true })
    assert.equal(compoundBytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1')
    assert.equal(compoundBytes.includes(Buffer.from('EncryptedPackage')), true)
})

test('DOCX fixture drives the body-text projection for Unicode, breaks, tabs, tables and omitted revisions', async () => {
  const result = await extractDocx(docxFixture({ bodyXml:
    '<w:p><w:r><w:t>café 世界 😀</w:t><w:tab/><w:t>tab</w:t><w:br/><w:t>line</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:del><w:p><w:r><w:delText>deleted</w:delText></w:r></w:p></w:del>',
  entries: {
    'word/header1.xml': '<header>header is not body</header>',
    'word/footnotes.xml': '<footnotes>footnote is not body</footnotes>',
  } }))
  assert.deepEqual(result, {
    text: 'café 世界 😀\ttab\nline\none\ttwo',
    documentImport: { format: 'docx', status: 'ready' },
  })
})

test('DOCX fixture drives strict and bounded failure outcomes', async () => {
  const strict = await extractDocx(docxFixture({ strict: true, documentPath: 'custom/main.xml', paragraphs: ['strict body'] }))
  assert.deepEqual(strict, { text: 'strict body', documentImport: { format: 'docx', status: 'ready' } })
  assert.deepEqual(await extractDocx(docxFixture()), { documentImport: { format: 'docx', status: 'no-text' } })
  assert.deepEqual(await extractDocx(docxFixture({ compoundContainer: true })), { documentImport: { format: 'docx', status: 'unsupported' } })
  assert.deepEqual(await extractDocx(docxFixture({ paragraphs: ['t'.repeat(64 * 1024 + 1)] })), { documentImport: { format: 'docx', status: 'text-limit' } })
  assert.deepEqual(await extractDocx(docxFixture({ paragraphs: ['x'.repeat(4 * 1024 * 1024 + 1)] })), { documentImport: { format: 'docx', status: 'structure-limit' } })
})
