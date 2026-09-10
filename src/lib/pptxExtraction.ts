import {
  MAX_PPTX_FILE_BYTES, MAX_PPTX_ENTRIES, MAX_PPTX_PART_BYTES, MAX_PPTX_EXPANDED_BYTES,
  MAX_PPTX_TEXT_BYTES, pptxImportFailure, type PptxImportResult,
} from '../../contract/pptxImport.mjs'
import { MAX_PRESENTATION_PARAGRAPHS, parsePresentationImportResult, type PresentationImportResult, type PresentationSnapshot } from '../../contract/presentationImport.ts'
import { readOfficePackage, OfficeExtractionError, officeMainPart, assertOfficeContentType } from './officePackage.ts'
import { presentationSlides, presentationRelationships, isSlideRelationship, slideContentType, slideBodyContent, slideIsHidden } from './pptxText.ts'

type ParsedPresentationSlide = { sourceSlide: number; hidden: boolean; text: string; paragraphs: string[] }

async function readPptxSlides(bytes: Uint8Array): Promise<{ totalSlides: number; hiddenSlides: number; slides: ParsedPresentationSlide[] }> {
  const officePackage = await readOfficePackage(bytes, { maxEntries: MAX_PPTX_ENTRIES, maxPartBytes: MAX_PPTX_PART_BYTES, maxExpandedBytes: MAX_PPTX_EXPANDED_BYTES })
  try {
    const main = officeMainPart(await officePackage.readPart('_rels/.rels'))
    assertOfficeContentType(await officePackage.readPart('[Content_Types].xml'), main, 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')
    const relationshipsPath = `${main.slice(0, main.lastIndexOf('/') + 1)}_rels/${main.slice(main.lastIndexOf('/') + 1)}.rels`
    const relationships = presentationRelationships(await officePackage.readPart(relationshipsPath), main)
    const slideIds = presentationSlides(await officePackage.readPart(main))
    const contentTypes = await officePackage.readPart('[Content_Types].xml')
    const targets = new Set<string>()
    const slides: ParsedPresentationSlide[] = []
    let hiddenSlides = 0
    for (let index = 0; index < slideIds.length; index += 1) {
      const item = slideIds[index]!
      const relation = relationships.get(item.relation)
      if (!relation) throw new OfficeExtractionError('invalid')
      if (!isSlideRelationship(relation.type)) throw new OfficeExtractionError('unsupported')
      if (targets.has(relation.target)) throw new OfficeExtractionError('invalid')
      targets.add(relation.target)
      assertOfficeContentType(contentTypes, relation.target, slideContentType)
      const slideXml = await officePackage.readPart(relation.target)
      const hidden = slideIsHidden(slideXml)
      if (hidden) hiddenSlides += 1
      const content = hidden ? { text: '', paragraphs: [] } : slideBodyContent(slideXml)
      slides.push({ sourceSlide: index + 1, hidden, ...content })
    }
    return { totalSlides: slideIds.length, hiddenSlides, slides }
  } finally {
    await officePackage.close()
  }
}

/** Worker-only bounded projection of visible slide text. No media, references,
 * notes, comments, layout/master text or external target is executed/read. */
export async function extractPptx(bytes: Uint8Array): Promise<PptxImportResult> {
  if (bytes.byteLength > MAX_PPTX_FILE_BYTES) return pptxImportFailure('file-too-large')
  try {
    const parsed = await readPptxSlides(bytes)
    const output: string[] = []
    let used = 0
    const encoder = new TextEncoder()
    for (const slide of parsed.slides) {
      if (slide.hidden || !slide.text.trim()) continue
      const block = `${output.length ? '\n' : ''}Slide ${slide.sourceSlide}: ${slide.text}`
      used += encoder.encode(block).byteLength
      if (used > MAX_PPTX_TEXT_BYTES) throw new OfficeExtractionError('text-limit')
      output.push(block)
    }
    return output.length ? { text: output.join(''), documentImport: { format: 'pptx', status: 'ready' } } : { documentImport: { format: 'pptx', status: 'no-text' } }
  } catch (error) {
    return pptxImportFailure(error instanceof OfficeExtractionError ? error.status : 'invalid')
  }
}

export async function extractPresentation(bytes: Uint8Array): Promise<PresentationImportResult> {
  if (bytes.byteLength > MAX_PPTX_FILE_BYTES) return { documentImport: { format: 'pptx', status: 'file-too-large' } }
  try {
    const parsed = await readPptxSlides(bytes)
    const visible = parsed.slides.filter((slide) => !slide.hidden)
    const encoder = new TextEncoder()
    const used = visible.reduce((total, slide) => total + slide.paragraphs.reduce((sum, paragraph) => sum + encoder.encode(paragraph).byteLength, 0), 0)
    if (used > MAX_PPTX_TEXT_BYTES) throw new OfficeExtractionError('text-limit')
    if (visible.reduce((total, slide) => total + slide.paragraphs.length, 0) > MAX_PRESENTATION_PARAGRAPHS) throw new OfficeExtractionError('structure-limit')
    const presentation: PresentationSnapshot = {
      totalSlides: parsed.totalSlides,
      hiddenSlides: parsed.hiddenSlides,
      slides: visible.map(({ sourceSlide, paragraphs }) => ({ sourceSlide, paragraphs })),
    }
    if (!visible.some((slide) => slide.text.trim())) return { documentImport: { format: 'pptx', status: 'no-text' } }
    return parsePresentationImportResult({ documentImport: { format: 'pptx', status: 'ready' }, presentation })
  } catch (error) {
    return { documentImport: { format: 'pptx', status: error instanceof OfficeExtractionError ? error.status : 'invalid' } }
  }
}
