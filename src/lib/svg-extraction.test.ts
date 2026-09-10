import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSvg } from './svgExtraction.ts'
import { parseSvgPreparation, SVG_MAX_NODES } from './svgInput.ts'
import { svgFixture } from '../../tests/helpers/svgFixture.mjs'
import { imageFixture } from '../../tests/helpers/imageFixture.mjs'
import { IMAGE_MAX_PIXELS } from '../../contract/imageInput.ts'

const svg = (body: string, attributes = 'width="160" height="80"') => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`)

function structuralPng(width: number, height: number): Uint8Array {
  const u32 = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)
  const bytes = new Uint8Array(58)
  bytes.set(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), 0)
  bytes.set(u32(13), 8); bytes.set(Uint8Array.from([73, 72, 68, 82]), 12)
  bytes.set(u32(width), 16); bytes.set(u32(height), 20); bytes[24] = 8; bytes[25] = 2
  bytes.set(u32(1), 33); bytes.set(Uint8Array.from([73, 68, 65, 84]), 37)
  bytes.set(u32(0), 42); bytes.set(Uint8Array.from([73, 69, 78, 68]), 50)
  bytes.set(u32(0), 54)
  return bytes
}

test('static SVG diagrams retain local gradients, clipping and CSS with finite normalized dimensions', () => {
  for (const options of [{}, { viewBoxOnly: true }]) {
    const found = extractSvg(svgFixture(160, 80, options))
    assert.equal(found.status, 'ready')
    if (found.status !== 'ready') throw new Error('Missing SVG preparation')
    assert.equal(found.width, 160); assert.equal(found.height, 80)
    assert.match(found.xml, /linearGradient/); assert.match(found.xml, /clipPath/); assert.match(found.xml, /<style/)
    assert.match(found.xml, /width:160px!important;height:80px!important/)
  }
  assert.deepEqual(extractSvg(svg('', 'width="1in" height="36pt"')), {
    status: 'ready', width: 96, height: 48,
    xml: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48" style=";width:96px!important;height:48px!important"></svg>',
  })
})

test('SVG admission rejects active markup, external resources and ambiguous stylesheet syntax', () => {
  for (const body of [
    '<script>window.svgMarker=true</script>', '<rect onclick="window.svgMarker=true"/>', '<foreignObject/>', '<animate/>', '<set/>',
    '<image href="https://example.invalid/pixel.png"/>', '<use href="file:///private/data.svg#x"/>',
    '<style>@import "https://example.invalid/style.css";</style>', '<style>.x{fill:url(https://example.invalid/x)}</style>',
    '<style>.x{fill:u\\72l(https://example.invalid/x)}</style>', '<style>.x{animation-name:spin}</style>',
    '<style>/* unclosed</style>', '<rect fill="url(&#x68;ttps://example.invalid/x)"/>',
    '<g xml:base="https://example.invalid/"><use href="#x"/></g>', '<?xml-stylesheet href="https://example.invalid/x"?>',
  ]) assert.equal(extractSvg(svg(body)).status, 'unsupported', body)
  assert.equal(extractSvg(new TextEncoder().encode('<!DOCTYPE svg [<!ENTITY x "value">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">&x;</svg>')).status, 'unsupported')
})

test('SVG admission rejects malformed XML, missing/oversized geometry and duplicate identifiers', () => {
  for (const bytes of [svg('<g>'), svg('<g id="x"/><g id="x"/>'), svg('', ''), svg('', 'width="8001" height="1"'),
    svg('', 'width="8000" height="8000"'), svg('', 'viewBox="0 0 0 1"'), svg('', 'width="0" height="1"'), new Uint8Array([255, 254]),
  ]) assert.equal(extractSvg(bytes).status, 'invalid')
  assert.equal(extractSvg(new Uint8Array(8 * 1024 * 1024 + 1)).status, 'file-too-large')
})

test('SVG percentage geometry is well-formed and style elements cannot hide nested markup', () => {
  assert.equal(extractSvg(svg('<rect/>', 'width="100%" height="100%" viewBox="0 0 160 80"')).status, 'ready')
  for (const dimension of ['garbage%', '-10%', '0%', 'Infinity%']) {
    assert.notEqual(extractSvg(svg('', `width="${dimension}" height="100%" viewBox="0 0 160 80"`)).status, 'ready', dimension)
  }
  assert.equal(extractSvg(svg('<style><style>.x{fill:red}</style>.x{fill:blue}</style>')).status, 'unsupported')
})

test('SVG embeds only validated static PNG/JPEG resources, with a bounded image count', () => {
  const png = imageFixture(2, 2)
  const embed = (mime: string, bytes: Uint8Array) => `<image href="data:image/${mime};base64,${Buffer.from(bytes).toString('base64')}" width="2" height="2"/>`
  assert.equal(extractSvg(svg(embed('png', png))).status, 'ready')
  assert.equal(extractSvg(svg(embed('png', png).repeat(9))).status, 'structure-limit')
  assert.equal(extractSvg(svg(embed('jpeg', png))).status, 'invalid')
  for (const mime of ['svg+xml', 'gif', 'webp']) assert.equal(extractSvg(svg(embed(mime, png))).status, 'unsupported')
  // An animation control chunk needs no frame decoding to disqualify a PNG.
  const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write('acTL', 4); chunk.writeUInt32BE(1, 8)
  const animated = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])
  assert.equal(extractSvg(svg(embed('png', animated))).status, 'unsupported')
})

test('SVG embedded raster pixels share the 32 megapixel budget before codec decoding', () => {
  const structural = structuralPng(8000, Math.floor(IMAGE_MAX_PIXELS / 8000))
  const embed = (bytes: Uint8Array) => `<image href="data:image/png;base64,${Buffer.from(bytes).toString('base64')}"/>`
  assert.equal(extractSvg(svg(embed(structural))).status, 'ready', 'one structural header at the exact budget is admitted; it is not codec-valid')
  assert.equal(extractSvg(svg(embed(structural) + embed(structural))).status, 'structure-limit', 'the second structural header exceeds the aggregate budget')
})

test('SVG reuse is same-document, acyclic and bounded before browser painting', () => {
  assert.equal(extractSvg(svg('<defs><g id="one"><rect width="1" height="1"/></g></defs><use href="#one"/>')).status, 'ready')
  assert.equal(extractSvg(svg('<use href="#missing"/>')).status, 'invalid')
  assert.equal(extractSvg(svg('<g id="loop"><use href="#loop"/></g>')).status, 'structure-limit')
  assert.equal(extractSvg(svg('<g>'.repeat(65) + '</g>'.repeat(65))).status, 'structure-limit')
  assert.equal(extractSvg(svg('<rect/>'.repeat(SVG_MAX_NODES))).status, 'structure-limit')
  const exponential = '<g id="n0"><rect/></g>' + Array.from({ length: 17 }, (_, index) => `<g id="n${index + 1}"><use href="#n${index}"/><use href="#n${index}"/></g>`).join('')
  assert.equal(extractSvg(svg(exponential)).status, 'structure-limit')
})

test('transient SVG worker results are closed and bounded; metadata is not rendered', () => {
  const valid = extractSvg(svg('<metadata><x xmlns="urn:exporter">private metadata</x></metadata><text>A &amp; B</text>'))
  assert.equal(valid.status, 'ready')
  if (valid.status !== 'ready') throw new Error('Missing SVG preparation')
  assert.doesNotMatch(valid.xml, /private metadata|urn:exporter/)
  assert.match(valid.xml, /A &amp; B/)
  assert.deepEqual(parseSvgPreparation({ ...valid, path: '/private/source.svg' }), { status: 'invalid' })
  assert.deepEqual(parseSvgPreparation({ ...valid, width: Infinity }), { status: 'invalid' })
  assert.deepEqual(parseSvgPreparation({ status: 'unsupported', xml: valid.xml }), { status: 'invalid' })
})
