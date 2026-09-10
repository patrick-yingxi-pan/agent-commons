import { deflateRawSync } from 'node:zlib'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPresentation, extractPptx } from './pptxExtraction.ts'
import { MAX_PRESENTATION_PARAGRAPHS } from '../../contract/presentationImport.ts'
import { MAX_PPTX_ENTRIES, MAX_PPTX_FILE_BYTES, MAX_PPTX_PART_BYTES, MAX_PPTX_TEXT_BYTES } from '../../contract/pptxImport.mjs'
import { pptxFixture as sharedPptxFixture } from '../../tests/helpers/pptxFixture.mjs'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const SLIDE_REL = `${R}/slide`
const MAIN_REL = `${R}/officeDocument`
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
const SLIDE_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'

const esc = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[character]!)
const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function zipArchive(entries: Array<[string, string | Uint8Array]>): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [name, source] of entries) {
    const plain = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source)
    const compressed = plain.length ? deflateRawSync(plain, { level: 9 }) : plain
    const method = plain.length ? 8 : 0
    const nameBytes = Buffer.from(name)
    const crc = crc32(plain)
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(plain.length), u16(nameBytes.length), u16(0), nameBytes, compressed])
    const dir = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc), u32(compressed.length), u32(plain.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes])
    locals.push(local); central.push(dir); offset += local.length
  }
  const local = Buffer.concat(locals), directory = Buffer.concat(central)
  return Buffer.concat([local, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(local.length), u16(0)])
}

function shape(text: string, hidden = false): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="shape"${hidden ? ' hidden="1"' : ''}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
}
function table(rows: string[][]): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${rows.map((row) => `<a:tr>${row.map((cell) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>${esc(cell)}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}
function slide(body: string, strict = false, show?: string): string {
  const p = strict ? 'http://purl.oclc.org/ooxml/presentationml/main' : P
  const a = strict ? 'http://purl.oclc.org/ooxml/drawingml/main' : A
  return `<p:sld xmlns:p="${p}" xmlns:a="${a}"${show === undefined ? '' : ` show="${show}"`}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld><p:clrMapOvr/></p:sld>`
}
function pptxFixture({ slides = [{ body: shape('slide one') }], strict = false, entries = {}, contentType = MAIN_TYPE }: { slides?: Array<{ body: string; show?: string }>; strict?: boolean; entries?: Record<string, string | Uint8Array>; contentType?: string } = {}): Uint8Array {
  const p = strict ? 'http://purl.oclc.org/ooxml/presentationml/main' : P
  const relOffice = strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument' : MAIN_REL
  const relSlide = strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships/slide' : SLIDE_REL
  const presentation = `<?xml version="1.0"?><p:presentation xmlns:p="${p}" xmlns:r="${strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships' : R}"><p:sldMasterIdLst/><p:notesMasterIdLst/><p:handoutMasterIdLst/><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`
  const rels = `<Relationships xmlns="${REL}">${slides.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${relSlide}" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`
  const types = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${contentType}"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="${SLIDE_TYPE}"/>`).join('')}</Types>`
  const generated: Array<[string, string | Uint8Array]> = [
    ['[Content_Types].xml', types],
    ['_rels/.rels', `<Relationships xmlns="${REL}"><Relationship Id="rId0" Type="${relOffice}" Target="ppt/presentation.xml"/></Relationships>`],
    ['ppt/presentation.xml', presentation], ['ppt/_rels/presentation.xml.rels', rels],
    ...slides.map((item, index) => [`ppt/slides/slide${index + 1}.xml`, slide(item.body, strict, item.show)] as [string, string]),
  ]
  const map = new Map(generated)
  for (const [name, value] of Object.entries(entries)) map.set(name, value)
  return zipArchive([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

test('visible slide order, exact original numbers, ordinary textboxes, tables and hidden shapes', async () => {
  const chartText = `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:title><c:tx><c:rich><a:p><a:r><a:t>chart secret</a:t></a:r></a:p></c:rich></c:tx></c:title></c:chart></a:graphicData></a:graphic></p:graphicFrame>`
  const extensionText = `<p:sp><p:extLst><p:ext><a:txBody><a:bodyPr/><a:p><a:r><a:t>extension secret</a:t></a:r></a:p></a:txBody></p:ext></p:extLst></p:sp>`
  const alternateText = `<p:sp><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x"><p:txBody><a:bodyPr/><a:p><a:r><a:t>choice secret</a:t></a:r></a:p></p:txBody></mc:Choice><mc:Fallback><p:txBody><a:bodyPr/><a:p><a:r><a:t>fallback secret</a:t></a:r></a:p></p:txBody></mc:Fallback></mc:AlternateContent></p:sp>`
  const textExtension = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="text extension"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>ordinary</a:t><a:extLst><a:ext><a:t>extension leak</a:t></a:ext></a:extLst></a:r></a:p></p:txBody></p:sp>`
  const nonTableGraphic = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="not table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="urn:not-table"><a:tbl><a:tr><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>graphic leak</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  const result = await extractPptx(pptxFixture({
    slides: [{ body: `${shape('first')}${textExtension}${chartText}${extensionText}${alternateText}${nonTableGraphic}<p:sp>${shape('hidden', true).replace('<p:sp>', '').replace('</p:sp>', '')}</p:sp>${table([['A', 'B']])}` }, { body: shape('hidden slide'), show: 'false' }, { body: shape('third') }],
    entries: {
      'ppt/notesSlides/notesSlide1.xml': slide(shape('secret note')),
      'ppt/comments/comment1.xml': '<comments>comment secret</comments>',
      'ppt/slideLayouts/slideLayout1.xml': slide(shape('layout secret')),
      'ppt/slideMasters/slideMaster1.xml': slide(shape('master secret')),
    },
  }))
  assert.deepEqual(result, { documentImport: { format: 'pptx', status: 'ready' }, text: 'Slide 1: first\nordinary\nA\tB\nSlide 3: third' })
})

test('strict namespaces, no visible text and auxiliary parts do not become input', async () => {
  assert.deepEqual(await extractPptx(pptxFixture({ strict: true, slides: [{ show: 'false', body: '<p:sp><p:nvSpPr><p:cNvPr id="1" name="hidden" hidden="1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>hidden</a:t></a:r></a:p></p:txBody></p:sp>' }] })), { documentImport: { format: 'pptx', status: 'no-text' } })
  assert.deepEqual(await extractPptx(pptxFixture({ strict: true, slides: [{ body: table([['strict one', 'strict two']]) }] })), { documentImport: { format: 'pptx', status: 'ready' }, text: 'Slide 1: strict one\tstrict two' })
})

test('presentation relationship order, not ZIP or target filename order, labels visible slides', async () => {
  const result = await extractPptx(sharedPptxFixture({ slides: [
    { shapes: ['first in deck'] },
    { shapes: ['second in deck'] },
  ], slideOrder: [1, 0] }))
  assert.equal(result.documentImport.status, 'ready')
  assert.equal(result.text, 'Slide 1: second in deck\nSlide 2: first in deck')
})

test('visible text keeps authored edge whitespace while blank slides remain no-text', async () => {
  const result = await extractPptx(pptxFixture({ slides: [{ body: shape('  keep spaces  ') }, { body: shape('   ') }] }))
  assert.deepEqual(result, { documentImport: { format: 'pptx', status: 'ready' }, text: 'Slide 1:   keep spaces  ' })
})

test('hidden group shapes mask nested text while visible siblings remain', async () => {
  const hiddenGroup = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="hidden group" hidden="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape('group secret')}</p:grpSp>`
  assert.deepEqual(await extractPptx(pptxFixture({ slides: [{ body: `${hiddenGroup}${shape('visible sibling')}` }] })), { documentImport: { format: 'pptx', status: 'ready' }, text: 'Slide 1: visible sibling' })
})

test('malformed, external, macro and relationship/path failures are explicit', async () => {
  assert.equal((await extractPptx(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).documentImport.status, 'unsupported')
  assert.equal((await extractPptx(new TextEncoder().encode('not a ZIP'))).documentImport.status, 'invalid')
  assert.equal((await extractPptx(pptxFixture({ contentType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml' }))).documentImport.status, 'unsupported')
  for (const entries of [
    { 'ppt/slides/slide1.xml': '<broken>' },
    { '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="bad"/></Types>' },
    { 'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${SLIDE_REL}" Target="https://example.invalid/slide.xml" TargetMode="External"/></Relationships>` },
    { 'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${SLIDE_REL}" Target="../outside.xml"/></Relationships>` },
  ]) {
    assert.equal((await extractPptx(pptxFixture({ entries }))).documentImport.status, entries['ppt/slides/slide1.xml'] ? 'invalid' : 'unsupported')
  }
})

test('text and package bounds never return partial ready text', async () => {
  assert.equal((await extractPptx(new Uint8Array(MAX_PPTX_FILE_BYTES + 1))).documentImport.status, 'file-too-large')
  const tooLong = 'x'.repeat(MAX_PPTX_TEXT_BYTES + 1)
  assert.deepEqual(await extractPptx(pptxFixture({ slides: [{ body: shape(tooLong) }, { body: shape('later') }] })), { documentImport: { format: 'pptx', status: 'text-limit' } })
  assert.deepEqual(await extractPptx(pptxFixture({ entries: { 'ppt/slides/slide1.xml': '<p:sld xmlns:p="' + P + '">' + 'x'.repeat(MAX_PPTX_PART_BYTES) + '</p:sld>' } })), { documentImport: { format: 'pptx', status: 'structure-limit' } })
  const extra = Object.fromEntries(Array.from({ length: MAX_PPTX_ENTRIES }, (_, index) => [`extra/${index}.xml`, '']))
  assert.equal((await extractPptx(pptxFixture({ entries: extra }))).documentImport.status, 'structure-limit')
  const tooManySlides = Array.from({ length: 129 }, (_, index) => ({ body: shape(`slide ${index + 1}`) }))
  assert.equal((await extractPptx(pptxFixture({ slides: tooManySlides }))).documentImport.status, 'structure-limit')
})

test('structural extraction preserves visible order, source boundaries, tables, hidden slides and visible empty slides', async () => {
  const result = await extractPresentation(pptxFixture({ slides: [
    { body: `${shape('Slide 42: authored marker')}${shape('second')}${table([['A', 'B']])}` },
    { body: shape('hidden slide'), show: 'false' },
    { body: '<p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>   </a:t></a:r></a:p></p:txBody></p:sp>' },
  ] }))
  assert.deepEqual(result, {
    documentImport: { format: 'pptx', status: 'ready' },
    presentation: {
      totalSlides: 3,
      hiddenSlides: 1,
      slides: [
        { sourceSlide: 1, paragraphs: ['Slide 42: authored marker', 'second', 'A\tB'] },
        { sourceSlide: 3, paragraphs: ['   '] },
      ],
    },
  })
})

test('structural extraction returns no-text without a partial snapshot', async () => {
  const result = await extractPresentation(pptxFixture({ slides: [{ body: shape('   ') }, { body: shape('hidden'), show: 'false' }] }))
  assert.deepEqual(result, { documentImport: { format: 'pptx', status: 'no-text' } })
  assert.equal((await extractPresentation(new Uint8Array(MAX_PPTX_FILE_BYTES + 1))).documentImport.status, 'file-too-large')
  assert.equal((await extractPresentation(pptxFixture({ slides: [{ body: shape('x'.repeat(MAX_PPTX_TEXT_BYTES + 1)) }] }))).documentImport.status, 'text-limit')
})

test('structural paragraph floods and excessive UTF-8 text reject the whole deck', async () => {
  const paragraphs = '<a:p><a:r><a:t>x</a:t></a:r></a:p>'.repeat(MAX_PRESENTATION_PARAGRAPHS + 1)
  const body = `<p:sp><p:txBody>${paragraphs}</p:txBody></p:sp>`
  assert.deepEqual(await extractPresentation(pptxFixture({ slides: [{ body }] })), { documentImport: { format: 'pptx', status: 'structure-limit' } })
  assert.deepEqual(await extractPresentation(pptxFixture({ slides: [{ body: shape('é'.repeat(MAX_PPTX_TEXT_BYTES / 2 + 1)) }] })), { documentImport: { format: 'pptx', status: 'text-limit' } })
})

test('structural extraction fails closed for malformed and unsupported packages', async () => {
  assert.equal((await extractPresentation(new TextEncoder().encode('not a ZIP'))).documentImport.status, 'invalid')
  assert.equal((await extractPresentation(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).documentImport.status, 'unsupported')
})
