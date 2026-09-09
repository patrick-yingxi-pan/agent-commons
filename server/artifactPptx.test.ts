import assert from 'node:assert/strict'
import { test } from 'node:test'
import { posix } from 'node:path'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { SaxesParser } from 'saxes'
import { parseStructuredArtifactBody } from '../contract/artifactAuthoring.ts'
import { slidesPptx } from './artifactPptx.ts'
import { hasPowerPointText, presentationLines, presentationPages } from './artifactPptxLayout.ts'

async function parts(content: string) {
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.from(content, 'base64')), { checkSignature: true })
  try {
    const entries = await reader.getEntries()
    return Object.fromEntries(await Promise.all(entries.map(async (entry) => [entry.filename, await entry.getData!(new TextWriter(), { checkSignature: true })])))
  } finally { await reader.close() }
}

function sourceText(xml: string) {
  const boxes: Array<{ name: string; text: string }> = []
  let box: { name: string; text: string } | undefined
  let inText = false
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', (tag) => {
    if (tag.local === 'sp') box = { name: '', text: '' }
    if (tag.local === 'cNvPr' && box) box.name = tag.attributes.name.value
    if (tag.local === 't') inText = true
    if (tag.local === 'br' && box) box.text += '\n'
  })
  parser.on('text', (text) => { if (inText && box) box.text += text })
  parser.on('closetag', (tag) => {
    if (tag.local === 't') inText = false
    if (tag.local === 'sp' && box) { boxes.push(box); box = undefined }
  })
  parser.write(xml).close()
  return boxes.filter((box) => box.name !== 'Source slide')
}

test('PPTX literal text stays editable, ordered, self-contained and independent of filename', async () => {
  const body = { type: 'slides' as const, revision: 8, slides: [
    { title: 'Review <&> "Q1"', bullets: ['  leading and trailing  ', '00123 =1+1 _x000A_', '日本語 😀 café', 'line1\r\nline2\rline3\nline4\ttab', ''] },
    { title: 'A title without bullets', bullets: [] },
  ] }
  const before = structuredClone(body)
  const file = await slidesPptx('folder/Revenue.Q1.pptx', body)
  assert.equal(file.filename, 'Revenue.Q1.pptx')
  assert.equal(file.revision, 8)
  assert.deepEqual(await slidesPptx('folder/Revenue.Q1.pptx', body), file)
  assert.deepEqual(body, before)
  const files = await parts(file.content)
  assert.deepEqual(sourceText(files['ppt/slides/slide1.xml']), [
    { name: 'Slide title', text: body.slides[0].title },
    ...body.slides[0].bullets.map((text, index) => ({ name: `Bullet ${index + 1}`, text: text.replace(/\r\n?/g, '\n') })),
  ])
  assert.deepEqual(sourceText(files['ppt/slides/slide2.xml']), [{ name: 'Slide title', text: body.slides[1].title }])
  assert.match(files['ppt/slides/slide1.xml'], /<a:buChar char="•"/)
  for (const [name, xml] of Object.entries(files)) {
    new SaxesParser({ xmlns: true }).write(xml).close()
    assert.doesNotMatch(xml, /TargetMode="External"|hlinkClick|vbaProject|oleObj|<p:pic/)
    if (name.endsWith('.rels')) {
      const parser = new SaxesParser({ xmlns: true })
      parser.on('opentag', (tag) => {
        if (tag.local !== 'Relationship') return
        const directory = name === '_rels/.rels' ? '' : posix.dirname(posix.dirname(name))
        const target = posix.normalize(posix.join(directory, tag.attributes.Target.value))
        assert.ok(files[target], `${name} must resolve ${target}`)
      })
      parser.write(xml).close()
    }
  }
})

test('PPTX continuation layout preserves every title/bullet fragment without tiny fonts or off-slide boxes', () => {
  const body = { type: 'slides' as const, slides: [{ title: 'Long title '.repeat(21), bullets: ['日本語 '.repeat(400), 'W'.repeat(2000), '\n'.repeat(2000), '', 'last'] }] }
  assert.ok(parseStructuredArtifactBody(body))
  const pages = presentationPages(body)
  assert.ok(pages.length > 3)
  const boxes = pages.flatMap((page) => page.boxes)
  for (const [name, text] of [['Slide title', body.slides[0].title], ...body.slides[0].bullets.map((text, index) => [`Bullet ${index + 1}`, text])]) {
    assert.equal(boxes.filter((box) => box.name === name).map((box) => box.text).join(''), text)
  }
  for (const [index, page] of pages.entries()) {
    assert.equal(page.sourceSlide, 1)
    assert.equal(page.part, index + 1)
    let bottom = 0
    for (const box of page.boxes) {
      assert.ok(box.y >= bottom && box.y + box.height <= 486)
      assert.ok(box.x >= 54 && box.x + box.width <= 906)
      assert.ok(box.fontSize >= 24)
      bottom = box.y + box.height
    }
  }
  for (const text of ['a\r\nb\nc\r', '日本語😀 '.repeat(30), 'x'.repeat(2000), ' spaces  ']) {
    assert.equal(presentationLines(text, 24, 100).join(''), text)
  }
})

test('PPTX refuses XML-illegal saved units without substituting or corrupting text', async () => {
  for (const title of ['NUL\0', 'vertical\vtab', 'bad\uffff', 'lone\ud800']) {
    const body = { type: 'slides' as const, slides: [{ title, bullets: [] }] }
    assert.equal(hasPowerPointText(body), false)
    await assert.rejects(slidesPptx('Refused', body), /XML cannot represent/)
  }
  assert.equal(hasPowerPointText({ type: 'slides', slides: [{ title: 'Valid 😀', bullets: ['\t\r\n'] }] }), true)
})

test('maximum accepted hard-break content fits the bounded PowerPoint download envelope', async () => {
  const slides = Array.from({ length: 9 }, (_value, index) => ({ title: `${'\n'.repeat(239)}A`, bullets: [index < 8 ? '\n'.repeat(2000) : '\n'.repeat(1800)] }))
  const body = { type: 'slides' as const, slides }
  assert.ok(parseStructuredArtifactBody(body))
  const result = await slidesPptx('Maximum.pptx', body)
  assert.ok(Buffer.from(result.content, 'base64').byteLength <= 8 * 1024 * 1024)
  assert.ok(presentationPages(body).length > 1000, 'test must exercise the extreme continuation path')
})
