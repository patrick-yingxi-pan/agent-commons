import { SaxesParser, type SaxesTagNS } from 'saxes'
import { IMAGE_MAX_CONTAINER_BYTES, IMAGE_MAX_PIXELS, inspectImageBytes } from '../../contract/imageInput.ts'
import { SVG_MAX_DEPTH, SVG_MAX_EXPANDED_NODES, SVG_MAX_NODES, parseSvgPreparation, svgDimensions, svgFailure, type SvgPreparation } from './svgInput.ts'

const SVG = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'
const XML = 'http://www.w3.org/XML/1998/namespace'
const ELEMENTS = new Set(('svg g defs symbol use image path rect circle ellipse line polyline polygon text tspan textPath ' +
  'linearGradient radialGradient stop clipPath mask pattern marker filter feBlend feColorMatrix feComponentTransfer ' +
  'feFuncR feFuncG feFuncB feFuncA feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight ' +
  'feDropShadow feFlood feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight ' +
  'feSpecularLighting feSpotLight feTile feTurbulence style title desc a switch view').split(' '))
const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const attr = (tag: SaxesTagNS, name: string) => tag.attributes[name]?.uri === '' ? tag.attributes[name]!.value : undefined
const fragment = (value: string) => /^#[^\s"'()<>{}\\]+$/.test(value)
class SvgRefusal extends Error {
  readonly status: 'invalid' | 'unsupported' | 'structure-limit'
  constructor(status: SvgRefusal['status']) { super('SVG import refused.'); this.status = status }
}
function refuse(status: SvgRefusal['status']): never { throw new SvgRefusal(status) }

function css(text: string): void {
  const value = text.replace(/\/\*[\s\S]*?\*\//g, '')
  // Reject ambiguous escapes, imports/fonts and animation, not only a literal
  // network scheme. Every admitted paint URL addresses this same document.
  if (/[\\@]|\/\*|\*\//.test(value) || /(?:animation|transition)\s*(?:-[\w-]+)?\s*:|(?:image-set|cross-fade|image)\s*\(/i.test(value)) refuse('unsupported')
  for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
    const target = match[1]!.trim().replace(/^(['"])(.*)\1$/, '$2')
    if (!fragment(target)) refuse('unsupported')
  }
  if (/url\s*\(/i.test(value.replace(/url\s*\([^)]*\)/gi, ''))) refuse('invalid')
}

function length(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === 'auto') return undefined
  const match = /^\s*(\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc|%)?\s*$/i.exec(value)
  if (!match) return refuse('unsupported')
  if (!Number.isFinite(Number(match[1])) || Number(match[1]) <= 0) return refuse('invalid')
  if (match[2] === '%') return undefined
  const units: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 }
  const pixels = Number(match[1]) * units[(match[2] ?? 'px').toLowerCase()]!
  if (!Number.isFinite(pixels) || pixels <= 0) return refuse('invalid')
  return pixels
}

function rootDimensions(tag: SaxesTagNS) {
  const box = attr(tag, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (box && (box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box[2]! <= 0 || box[3]! <= 0)) refuse('invalid')
  let width = length(attr(tag, 'width')); let height = length(attr(tag, 'height'))
  if (box) {
    if (width === undefined && height === undefined) { width = box[2]; height = box[3] }
    else if (width === undefined) width = height! * box[2]! / box[3]!
    else if (height === undefined) height = width * box[3]! / box[2]!
  }
  if (width === undefined || height === undefined || !svgDimensions(Math.ceil(width), Math.ceil(height))) refuse('invalid')
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

function imageReference(value: string): number {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
  if (!match) return refuse('unsupported')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0)) } catch { return refuse('invalid') }
  const header = inspectImageBytes(bytes)
  if (!header || header.mimeType !== `image/${match[1]}`) refuse('invalid')
  if (header.mimeType === 'image/png') {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let at = 8; at + 12 <= bytes.length; at += 12 + data.getUint32(at)) {
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
      if (type === 'acTL' || type === 'fcTL') refuse('unsupported')
    }
  }
  return header.width * header.height
}

/** XML parsing stays in the terminable local-file worker. The output is only
 * ever a Blob-backed image, never inline SVG, HTML, an object or a document.
 * https://www.w3.org/TR/svg-integration/#secure-static-mode */
export function extractSvg(bytes: Uint8Array): SvgPreparation {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return svgFailure('invalid')
  if (bytes.length > IMAGE_MAX_CONTAINER_BYTES) return svgFailure('file-too-large')
  try {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parser = new SaxesParser({ xmlns: true })
    const output: string[] = []
    const stack: number[] = []
    const nodes: Array<{ children: number[]; use?: string }> = []
    const ids = new Map<string, number>()
    let dimensions: { width: number; height: number } | undefined
    let style: string | undefined
    let metadataDepth = 0
    let rasterCount = 0
    let embeddedPixels = 0
    parser.on('error', () => refuse('invalid'))
    parser.on('doctype', () => refuse('unsupported'))
    parser.on('processinginstruction', () => refuse('unsupported'))
    parser.on('opentag', (tag) => {
      if (style !== undefined) refuse('unsupported')
      if (nodes.length >= SVG_MAX_NODES || stack.length >= SVG_MAX_DEPTH || Object.keys(tag.attributes).length > 128) refuse('structure-limit')
      const index = nodes.length
      nodes.push({ children: [] })
      if (stack.length) nodes[stack.at(-1)!]!.children.push(index)
      stack.push(index)
      if (metadataDepth || (tag.uri === SVG && tag.local === 'metadata')) { metadataDepth++; return }
      if (tag.uri !== SVG || !ELEMENTS.has(tag.local)) refuse('unsupported')
      if (stack.length === 1) {
        if (tag.local !== 'svg') refuse('invalid')
        dimensions = rootDimensions(tag)
      }
      for (const attribute of Object.values(tag.attributes)) {
        const { uri, local, value } = attribute
        if (/^on/i.test(local) || (uri === XML && local === 'base')) refuse('unsupported')
        if (local === 'href') {
          if (uri !== '' && uri !== XLINK) refuse('unsupported')
          if (tag.local === 'image' || tag.local === 'feImage') {
            if (fragment(value)) continue
            if (++rasterCount > 8) refuse('structure-limit')
            embeddedPixels += imageReference(value)
            if (embeddedPixels > IMAGE_MAX_PIXELS) refuse('structure-limit')
          } else if (!fragment(value)) refuse('unsupported')
          if (tag.local === 'use') {
            if (nodes[index]!.use && nodes[index]!.use !== value.slice(1)) refuse('invalid')
            nodes[index]!.use = value.slice(1)
          }
        }
        if (uri === '' && local === 'id') {
          if (!value || ids.has(value)) refuse('invalid')
          ids.set(value, index)
        }
        if (uri === '' && (local === 'style' || /url\s*\(|\\/i.test(value))) css(value)
      }
      if (tag.local === 'use' && !nodes[index]!.use) refuse('invalid')
      if (tag.local === 'style') style = ''
      const attributes = Object.values(tag.attributes).filter((entry) => stack.length !== 1 || !['width', 'height', 'style'].includes(entry.name))
        .map((entry) => ` ${entry.name}="${escapeXml(entry.value)}"`).join('')
      const size = stack.length === 1 ? ` width="${dimensions!.width}" height="${dimensions!.height}" style="${escapeXml(attr(tag, 'style') ?? '')};width:${dimensions!.width}px!important;height:${dimensions!.height}px!important"` : ''
      output.push(`<${tag.name}${attributes}${size}>`)
    })
    const text = (value: string) => {
      if (metadataDepth) return
      if (style !== undefined) style += value
      output.push(escapeXml(value))
    }
    parser.on('text', text); parser.on('cdata', text)
    parser.on('closetag', (tag) => {
      if (metadataDepth) metadataDepth--
      else {
        if (tag.local === 'style') { css(style ?? ''); style = undefined }
        output.push(`</${tag.name}>`)
      }
      stack.pop()
    })
    for (let at = 0; at < xml.length; at += 4096) parser.write(xml.slice(at, at + 4096))
    parser.close()
    if (!dimensions) return svgFailure('invalid')
    // Bound recursive <use> amplification before asking the image codec to
    // paint. Tree children and referenced subtrees share one acyclic budget.
    const visiting = new Set<number>()
    const costs = new Map<number, { count: number; depth: number }>()
    const cost = (index: number, nesting = 0): { count: number; depth: number } => {
      if (visiting.has(index) || nesting > SVG_MAX_DEPTH) return refuse('structure-limit')
      const cached = costs.get(index); if (cached) return cached
      visiting.add(index)
      const node = nodes[index]!
      const children = [...node.children]
      if (node.use) { const target = ids.get(node.use); if (target === undefined) return refuse('invalid'); children.push(target) }
      let count = 1; let depth = 1
      for (const child of children) {
        const expanded = cost(child, nesting + 1)
        count += expanded.count; depth = Math.max(depth, expanded.depth + 1)
        if (count > SVG_MAX_EXPANDED_NODES || depth > SVG_MAX_DEPTH) return refuse('structure-limit')
      }
      visiting.delete(index)
      const result = { count, depth }; costs.set(index, result); return result
    }
    cost(0)
    return parseSvgPreparation({ status: 'ready', ...dimensions, xml: output.join('') })
  } catch (error) { return svgFailure(error instanceof SvgRefusal ? error.status : 'invalid') }
}
