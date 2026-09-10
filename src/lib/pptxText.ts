import type { SaxesTagNS } from 'saxes'
import { MAX_PPTX_SLIDES } from '../../contract/pptxImport.mjs'
import {
  OfficeExtractionError, officeAttribute as attr, parseOfficeXml as parseXml,
  resolvePackagePartName,
} from './officePackage.ts'

const PRESENTATION = new Set([
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
])
const OFFICE_REL = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
])
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const SLIDE_RELATIONS = new Set([...OFFICE_REL].map((namespace) => `${namespace}/slide`))
export const slideContentType = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'

function invalid(): never { throw new OfficeExtractionError('invalid') }
function unsupported(): never { throw new OfficeExtractionError('unsupported') }
function bounded(): never { throw new OfficeExtractionError('structure-limit') }

function qualifiedAttribute(tag: SaxesTagNS, uri: string, local: string): string | undefined {
  return Object.values(tag.attributes).find((value) => value.uri === uri && value.local === local)?.value
}

function booleanAttribute(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim()
  if (!['0', '1', 'true', 'false'].includes(normalized)) invalid()
  return normalized === '1' || normalized === 'true'
}

export function presentationSlides(xml: string): Array<{ relation: string }> {
  const result: Array<{ relation: string }> = []
  const ids = new Set<string>()
  const relations = new Set<string>()
  let namespace = ''
  let listDepth = 0
  let lists = 0
  parseXml(xml, { open(tag, depth) {
    if (depth === 1) {
      if (!PRESENTATION.has(tag.uri) || tag.local !== 'presentation') invalid()
      namespace = tag.uri
    }
    if (depth === 2 && tag.uri === namespace && tag.local === 'sldIdLst') {
      if (++lists > 1) invalid()
      listDepth = depth
    }
    if (depth !== listDepth + 1 || tag.uri !== namespace || tag.local !== 'sldId') return
    if (result.length >= MAX_PPTX_SLIDES) bounded()
    const id = attr(tag, 'id')
    const relation = qualifiedAttribute(tag, [...OFFICE_REL][0]!, 'id') ??
      qualifiedAttribute(tag, 'http://purl.oclc.org/ooxml/officeDocument/relationships', 'id')
    if (!id || !/^[1-9]\d*$/.test(id) || ids.has(id) || !relation || relations.has(relation)) invalid()
    ids.add(id); relations.add(relation)
    result.push({ relation })
  }, close(tag, depth) {
    if (depth === listDepth && tag.uri === namespace && tag.local === 'sldIdLst') listDepth = 0
  } })
  if (lists !== 1) invalid()
  return result
}

export interface PresentationRelationship { type: string; target: string; external: boolean }
export function presentationRelationships(xml: string, main: string): Map<string, PresentationRelationship> {
  const result = new Map<string, PresentationRelationship>()
  parseXml(xml, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== PACKAGE_REL || tag.local !== 'Relationships')) invalid()
    if (depth !== 2 || tag.uri !== PACKAGE_REL || tag.local !== 'Relationship') return
    const id = attr(tag, 'Id')
    const type = attr(tag, 'Type')
    const target = attr(tag, 'Target')
    const mode = attr(tag, 'TargetMode') ?? 'Internal'
    if (!id || !type || !target || result.has(id) || !['Internal', 'External'].includes(mode)) invalid()
    if (mode === 'External') unsupported()
    result.set(id, { type, target: resolvePackagePartName(main, target), external: false })
  } })
  return result
}

export function isSlideRelationship(type: string): boolean { return SLIDE_RELATIONS.has(type) }

export function slideIsHidden(xml: string): boolean {
  let hidden = false
  parseXml(xml, { open(tag, depth) {
    if (depth !== 1) return
    if (!PRESENTATION.has(tag.uri) || tag.local !== 'sld') invalid()
    const show = attr(tag, 'show')
    hidden = show === undefined ? false : !booleanAttribute(show)
  } })
  return hidden
}

type NodeKind = 'ignored' | 'slide' | 'common' | 'tree' | 'group' | 'shape' | 'frame' | 'properties'
  | 'graphic' | 'data' | 'table' | 'row' | 'cell' | 'body' | 'paragraph' | 'run' | 'text'
type SlideNode = {
  kind: NodeKind
  hidden?: boolean
  paragraphs?: string[]
  paragraph?: { value: string }
  cells?: string[]
  value?: string
}
const isShapeOwner = (node: SlideNode) => ['tree', 'group', 'shape', 'frame'].includes(node.kind)
const TABLE_URIS = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/table',
  'http://purl.oclc.org/ooxml/drawingml/table',
])

/** Only known direct-child paths have text meaning. Unknown/extension and
 * AlternateContent subtrees stay inert, even when they contain familiar tags.
 * Blocks retain their shape/group owners until parse completion, so an explicit
 * hidden flag cannot leak an earlier body even in out-of-order source XML. */
export function slideBodyText(xml: string): string {
  return slideBodyContent(xml).text
}

export function slideBodyParagraphs(xml: string): string[] {
  return slideBodyContent(xml).paragraphs
}

export function slideBodyContent(xml: string): { text: string; paragraphs: string[] } {
  const stack: SlideNode[] = []
  const blocks: Array<{ value: string; paragraphs: string[]; owners: SlideNode[] }> = []
  let presentation = ''
  let drawing = ''
  const emit = (value: string, paragraphs = [value]) => {
    if (value) blocks.push({ value, paragraphs, owners: stack.filter(isShapeOwner) })
  }
  parseXml(xml, {
    open(tag, depth) {
      const parent = stack.at(-1)
      const node: SlideNode = { kind: 'ignored' }
      if (depth === 1) {
        if (!PRESENTATION.has(tag.uri) || tag.local !== 'sld') invalid()
        presentation = tag.uri
        drawing = presentation === 'http://schemas.openxmlformats.org/presentationml/2006/main'
          ? 'http://schemas.openxmlformats.org/drawingml/2006/main'
          : 'http://purl.oclc.org/ooxml/drawingml/main'
        node.kind = 'slide'
      } else if (tag.uri === presentation) {
        if (parent?.kind === 'slide' && tag.local === 'cSld') node.kind = 'common'
        else if (parent?.kind === 'common' && tag.local === 'spTree') node.kind = 'tree'
        else if (parent?.kind === 'tree' || parent?.kind === 'group') {
          if (tag.local === 'sp') node.kind = 'shape'
          else if (tag.local === 'grpSp') node.kind = 'group'
          else if (tag.local === 'graphicFrame') node.kind = 'frame'
          else if (tag.local === 'nvGrpSpPr') node.kind = 'properties'
        } else if ((parent?.kind === 'shape' && tag.local === 'nvSpPr') ||
          (parent?.kind === 'frame' && tag.local === 'nvGraphicFramePr')) node.kind = 'properties'
        else if (parent?.kind === 'properties' && tag.local === 'cNvPr') {
          const hidden = booleanAttribute(attr(tag, 'hidden'))
          if (hidden) stack[stack.length - 2]!.hidden = true
        } else if (parent?.kind === 'shape' && tag.local === 'txBody') node.kind = 'body'
      } else if (tag.uri === drawing) {
        if (parent?.kind === 'frame' && tag.local === 'graphic') node.kind = 'graphic'
        else if (parent?.kind === 'graphic' && tag.local === 'graphicData' && TABLE_URIS.has(attr(tag, 'uri') ?? '')) node.kind = 'data'
        else if (parent?.kind === 'data' && tag.local === 'tbl') node.kind = 'table'
        else if (parent?.kind === 'table' && tag.local === 'tr') node.kind = 'row'
        else if (parent?.kind === 'row' && tag.local === 'tc') node.kind = 'cell'
        else if (parent?.kind === 'cell' && tag.local === 'txBody') node.kind = 'body'
        else if (parent?.kind === 'body' && tag.local === 'p') node.kind = 'paragraph'
        else if (parent?.kind === 'paragraph') {
          if (tag.local === 'r' || tag.local === 'fld') {
            node.kind = 'run'
            node.paragraph = parent.paragraph
          } else if (tag.local === 'br') parent.paragraph!.value += '\n'
        } else if (parent?.kind === 'run' && tag.local === 't') {
          node.kind = 'text'
          node.paragraph = parent.paragraph
        }
      }
      if (node.kind === 'body') node.paragraphs = []
      if (node.kind === 'paragraph') node.paragraph = { value: '' }
      if (node.kind === 'row') node.cells = []
      if (node.kind === 'cell') node.value = ''
      stack.push(node)
    },
    text(value) {
      const node = stack.at(-1)
      if (node?.kind === 'text') node.paragraph!.value += value
    },
    close() {
      const node = stack.pop()!
      const parent = stack.at(-1)
      if (node.kind === 'paragraph') parent!.paragraphs!.push(node.paragraph!.value)
      else if (node.kind === 'body') {
        const value = node.paragraphs!.join('\n')
        if (parent?.kind === 'cell') parent.value = value
        else emit(value, node.paragraphs)
      } else if (node.kind === 'cell') parent!.cells!.push(node.value!)
      else if (node.kind === 'row') emit(node.cells!.join('\t'), [node.cells!.join('\t')])
    },
  })
  const visible = blocks.filter((block) => block.owners.every((owner) => !owner.hidden))
  return { text: visible.map((block) => block.value).join('\n'), paragraphs: visible.flatMap((block) => block.paragraphs) }
}
