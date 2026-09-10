import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { SaxesParser } from 'saxes'
import { documentDocx, hasWordText } from './artifactDocx.ts'
import type { ArtifactContent } from '../contract/index.ts'
import { extractDocx } from '../src/lib/docxExtraction.ts'

async function parts(content: string): Promise<Record<string, string>> {
  const zip = new ZipReader(new Uint8ArrayReader(Buffer.from(content, 'base64')), { checkSignature: true })
  try {
    const entries = await zip.getEntries()
    return Object.fromEntries(await Promise.all(entries.map(async (entry) => [entry.filename, await entry.getData!(new TextWriter(), { checkSignature: true })])))
  } finally { await zip.close() }
}

function paragraphs(xml: string): Array<{ style: string; text: string }> {
  const result: Array<{ style: string; text: string }> = []
  let current: { style: string; text: string } | undefined
  let inText = false
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', (tag) => {
    if (tag.local === 'p') current = { style: '', text: '' }
    if (tag.local === 'pStyle' && current) current.style = String(tag.attributes['w:val']?.value ?? '')
    if (tag.local === 't') inText = true
    if (tag.local === 'br' && current) current.text += '\n'
    if (tag.local === 'tab' && current) current.text += '\t'
  })
  parser.on('text', (value) => { if (inText && current) current.text += value })
  parser.on('closetag', (tag) => {
    if (tag.local === 't') inText = false
    if (tag.local === 'p' && current) { result.push(current); current = undefined }
  })
  parser.write(xml).close()
  return result
}

function assertWordParentsAndStyleOrder(documentXml: string, stylesXml: string): void {
  const stack: string[] = []
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', (tag) => {
    if (tag.local === 'br' || tag.local === 'tab') assert.equal(stack.at(-1), 'r', `${tag.local} must be inside w:r`)
    stack.push(tag.local)
  })
  parser.on('closetag', () => { stack.pop() })
  parser.write(documentXml).close()
  const styleParser = new SaxesParser({ xmlns: true })
  let inStyle = false
  let seenPPr = false
  styleParser.on('opentag', (tag) => {
    if (tag.local === 'style') { inStyle = true; seenPPr = false }
    if (inStyle && tag.local === 'pPr') seenPPr = true
    if (inStyle && tag.local === 'rPr') assert.equal(seenPPr, true, 'paragraph style pPr precedes rPr')
  })
  styleParser.on('closetag', (tag) => { if (tag.local === 'style') inStyle = false })
  styleParser.write(stylesXml).close()
}

test('DOCX preserves ordered saved title, headings, prose, lists, code, and email fields', async () => {
  const body: Extract<ArtifactContent, { type: 'doc' }> = {
    type: 'doc', revision: 11, title: 'Q1 <Review> 😀', blocks: [
      { h: 'Summary & goals' },
      { p: 'Literal =1+1, 00123, _x000A_,  leading\t tab\nnext' },
      { ul: ['first', 'second\ncontinued'] },
      { code: ['To: team@example.test', 'x < y\ttrue'] },
      { email: { to: 'ada@example.test', subject: 'Re: <literal> & text' } },
    ],
  }
  assert.equal(hasWordText(body), true)
  const file = await documentDocx('folder/brief.docx', body)
  assert.ok(file)
  assert.equal(file.filename, 'brief.docx')
  assert.equal(file.mediaType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(file.revision, 11)
  assert.deepEqual(await documentDocx('folder/brief.docx', body), file, 'export is deterministic')
  const files = await parts(file.content)
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/numbering.xml', 'word/styles.xml'].sort())
  const extracted = paragraphs(files['word/document.xml'])
  assert.deepEqual(extracted.map(({ text }) => text), [
    body.title, 'Summary & goals', body.blocks[1].p, 'first', 'second\ncontinued',
    'To: team@example.test', 'x < y\ttrue', 'To: ada@example.test', 'Subject: Re: <literal> & text',
  ])
  assert.equal(extracted[0].style, 'Title')
  assert.equal(extracted[1].style, 'Heading1')
  assert.match(files['word/document.xml'], /<w:t xml:space="preserve">To: <\/w:t>/, 'email labels retain their visible separator before the value')
  assert.match(files['word/document.xml'], /<w:t xml:space="preserve">Subject: <\/w:t>/)
  assertWordParentsAndStyleOrder(files['word/document.xml'], files['word/styles.xml'])
  const extractedByRenderer = await extractDocx(Uint8Array.from(Buffer.from(file.content, 'base64')))
  assert.deepEqual(extractedByRenderer, {
    text: 'Q1 <Review> 😀\nSummary & goals\nLiteral =1+1, 00123, _x000A_,  leading\t tab\nnext\nfirst\nsecond\ncontinued\nTo: team@example.test\nx < y\ttrue\nTo: ada@example.test\nSubject: Re: <literal> & text',
    documentImport: { format: 'docx', status: 'ready' },
  })
  assert.match(files['word/document.xml'], /<w:pgSz w:w="12240" w:h="15840"\/>/)
  for (const xml of Object.values(files)) new SaxesParser({ xmlns: true }).write(xml).close()
  assert.doesNotMatch(files['word/document.xml'], /TargetMode="External"|w:instrText|w:fldChar|altChunk|vbaProject/)
  assert.match(files['word/_rels/document.xml.rels'], /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/styles" Target="styles\.xml"/)
  const relParser = new SaxesParser({ xmlns: true })
  relParser.on('opentag', (tag) => {
    if (tag.local !== 'Relationship') return
    const target = String(tag.attributes.Target.value)
    assert.ok(target === 'styles.xml' || target === 'numbering.xml')
    assert.ok(files[`word/${target}`], `relationship target ${target} exists`)
  })
  relParser.write(files['word/_rels/document.xml.rels']).close()
  assert.deepEqual(body.blocks[1], { p: 'Literal =1+1, 00123, _x000A_,  leading\t tab\nnext' })
})

test('DOCX refuses incompatible controls, lone surrogates, wrong shapes, and oversized bodies whole', async () => {
  for (const value of ['bad\0', 'bad\u000b', 'bad\uffff', 'lone\ud800', 'lone\udfff']) {
    const body = { type: 'doc' as const, title: 'T', blocks: [{ p: value }] }
    assert.equal(hasWordText(body), false)
    assert.equal(await documentDocx('bad.docx', body), null)
  }
  assert.equal(await documentDocx('sheet.xlsx', { type: 'sheet', columns: ['x'], rows: [] } as ArtifactContent & { type: 'sheet' }), null)
  const tooMany = { type: 'doc' as const, title: 'T', blocks: Array.from({ length: 101 }, () => ({ p: 'x' })) }
  assert.equal(await documentDocx('many.docx', tooMany), null)
  const tooLong = { type: 'doc' as const, title: 'T', blocks: [{ p: 'x'.repeat(2_001) }] }
  assert.equal(await documentDocx('long.docx', tooLong), null)
  for (const malformed of [
    { type: 'doc', blocks: [] },
    { type: 'doc', title: 'T', blocks: [null] },
    { type: 'doc', title: 'T', blocks: [{ ul: [null] }] },
    { type: 'doc', title: 'T', blocks: [{ code: Array.from({ length: 101 }, () => '') }] },
  ]) assert.equal(await documentDocx('malformed.docx', malformed as never), null)
})

test('DOCX accepts exact per-field and document-body boundaries without truncation', async () => {
  const body: Extract<ArtifactContent, { type: 'doc' }> = {
    type: 'doc', title: 'T'.repeat(2_000), blocks: Array.from({ length: 10 }, () => ({ p: 'x'.repeat(2_000) })),
  }
  assert.equal(hasWordText(body), true)
  assert.ok(await documentDocx('boundary.docx', body))
})

test('DOCX bounded maximum accepted body remains a compact native package', async () => {
  const body: Extract<ArtifactContent, { type: 'doc' }> = {
    type: 'doc', title: 'Maximum', blocks: Array.from({ length: 100 }, (_, index) => ({ p: `${index}: ${'日本語😀 '.repeat(25)}` })),
  }
  assert.equal(hasWordText(body), true)
  const file = await documentDocx('maximum.docx', body)
  assert.ok(file)
  assert.ok(Buffer.from(file.content, 'base64').byteLength < 2 * 1024 * 1024)
})

test('DOCX local ZIP headers carry completed part sizes for Office format detection', async () => {
  const file = await documentDocx('header.docx', { type: 'doc', title: 'Header', blocks: [{ p: 'Complete part sizes.' }] })
  assert.ok(file)
  const bytes = Buffer.from(file.content, 'base64')
  let offset = 0
  let entries = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 6) & 8, 0, 'stored Office parts must not defer sizes to streaming descriptors')
    const size = bytes.readUInt32LE(offset + 18)
    assert.ok(size > 0)
    assert.equal(size, bytes.readUInt32LE(offset + 22))
    offset += 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28) + size
    entries++
  }
  assert.equal(entries, 6, 'the check visits every actual package part')
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'central directory starts only after all complete local entries')
})
