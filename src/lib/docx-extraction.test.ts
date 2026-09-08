import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractDocx } from './docxExtraction.ts'
import { docxBodyText, docxMainPart, packagePartName } from './docxText.ts'
import { docxFixture } from '../../tests/helpers/docxFixture.mjs'
import { MAX_DOCX_TEXT_BYTES, MAX_DOCX_PART_BYTES, MAX_DOCX_ENTRIES } from '../../contract/docxImport.mjs'

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const document = (body: string) => `<w:document xmlns:w="${WORD}"><w:body>${body}</w:body></w:document>`
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

test('real Word packages preserve Unicode, paragraphs, inline breaks, tabs and table cells', async () => {
  const bodyXml = `<w:p><w:pPr><w:tabs><w:tab/></w:tabs></w:pPr><w:r><w:t>café 世界 😀 &amp; &lt;script&gt;</w:t><w:tab/><w:t>next</w:t><w:br/><w:t>line</w:t></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc>${p('first')}</w:tc><w:tc>${p('second')}</w:tc></w:tr><w:tr><w:tc>${p('third')}</w:tc><w:tc>${p('fourth')}</w:tc></w:tr></w:tbl>${p('conclusion')}`
  const result = await extractDocx(docxFixture({ bodyXml }))
  assert.deepEqual(result, { documentImport: { format: 'docx', status: 'ready' }, text: 'café 世界 😀 & <script>\tnext\nline\nfirst\tsecond\nthird\tfourth\nconclusion' })
})

test('extraction follows the internal main-part relationship, not a conventional filename', async () => {
  const result = await extractDocx(docxFixture({ documentPath: 'word/relocated.xml', paragraphs: ['actual body'], entries: { 'word/document.xml': document(p('decoy body')) } }))
  assert.equal(result.text, 'actual body')
})

test('the exact UTF-8 text budget is usable and overflow saves no partial content', async () => {
  for (const body of ['a'.repeat(MAX_DOCX_TEXT_BYTES), '😀'.repeat(MAX_DOCX_TEXT_BYTES / 4)]) {
    assert.equal((await extractDocx(docxFixture({ paragraphs: [body] }))).text, body)
    const rejected = await extractDocx(docxFixture({ paragraphs: [body + 'x'] }))
    assert.deepEqual(rejected, { documentImport: { format: 'docx', status: 'text-limit' } })
  }
})

test('empty body, old/encrypted container, wrong content type, invalid ZIP and invalid XML are explicit', async () => {
  assert.equal((await extractDocx(docxFixture())).documentImport.status, 'no-text')
  assert.equal((await extractDocx(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).documentImport.status, 'unsupported')
  assert.equal((await extractDocx(new TextEncoder().encode('not a ZIP'))).documentImport.status, 'invalid')
  for (const xml of ['<broken>', '<w:document xmlns:w="wrong"><w:body/></w:document>', document(p('unclosed')).slice(0, -3)]) {
    assert.equal((await extractDocx(docxFixture({ entries: { 'word/document.xml': xml } }))).documentImport.status, 'invalid')
  }
  const wrongType = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'
  assert.equal((await extractDocx(docxFixture({ entries: { '[Content_Types].xml': wrongType } }))).documentImport.status, 'unsupported')
})

test('expanded ZIP entries, XML nesting and DTDs are bounded before a body can be accepted', async () => {
  for (const [entries, status] of [
    [{ 'word/document.xml': document(p('x'.repeat(MAX_DOCX_PART_BYTES))) }, 'structure-limit'],
    [Object.fromEntries(Array.from({ length: MAX_DOCX_ENTRIES }, (_, i) => [`empty${i}`, ''])), 'structure-limit'],
    [{ 'word/document.xml': '<!DOCTYPE document [<!ENTITY injected "do not read">]>' + document(p('&injected;')) }, 'unsupported'],
    [{ 'word/document.xml': document('<w:customXml>'.repeat(129) + p('too deep') + '</w:customXml>'.repeat(129)) }, 'structure-limit'],
  ] as const) {
    assert.deepEqual(await extractDocx(docxFixture({ entries })), { documentImport: { format: 'docx', status } })
  }
})

test('current body excludes deleted revisions, field code and auxiliary parts without executing references', async () => {
  const bodyXml = p('before') + `<w:del>${p('deleted')}</w:del><w:moveFrom>${p('moved away')}</w:moveFrom><w:ins>${p('inserted')}</w:ins>` +
    `<w:p><w:r><w:instrText>INCLUDETEXT file:///private/secret</w:instrText><w:t>field result</w:t></w:r></w:p>` +
    `<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="external">${p('link label')}</w:hyperlink>`
  const result = await extractDocx(docxFixture({ bodyXml, entries: {
    'word/footnotes.xml': document(p('private footnote')),
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="hyperlink" Target="https://example.invalid/never-fetch" TargetMode="External"/></Relationships>',
  } }))
  assert.equal(result.text, 'before\ninserted\nfield result\nlink label')
})

test('compatibility variants never duplicate text and unrepresentable embedded documents are refused', () => {
  const alternate = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="w">${p('choice')}</mc:Choice><mc:Fallback>${p('fallback')}</mc:Fallback></mc:AlternateContent>`
  assert.equal(docxBodyText(document(alternate)), 'fallback')
  assert.throws(() => docxBodyText(document('<w:altChunk/>')), (error) => error.status === 'unsupported')
  assert.throws(() => docxBodyText(document(alternate.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/, ''))), (error) => error.status === 'unsupported')
})

test('package part identity cannot become an external URL or escape the archive', () => {
  assert.equal(packagePartName('/word/./text%20body.xml'), 'word/text body.xml')
  for (const name of ['https://example.invalid/main', 'file:///tmp/main', '//example.invalid/main', '../../main.xml', 'word/%2e%2e/%2e%2e/main.xml', 'word\\main.xml', 'word/main.xml#fragment', 'word/%00main.xml']) {
    assert.throws(() => packagePartName(name), (error) => error.status === 'invalid')
  }
  assert.throws(() => docxMainPart('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://example.invalid/main" TargetMode="External"/></Relationships>'), (error) => error.status === 'unsupported')
})
