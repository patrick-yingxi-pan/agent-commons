import {
  MAX_PPTX_FILE_BYTES, MAX_PPTX_ENTRIES, MAX_PPTX_PART_BYTES, MAX_PPTX_EXPANDED_BYTES,
  MAX_PPTX_TEXT_BYTES, pptxImportFailure, type PptxImportResult,
} from '../../contract/pptxImport.mjs'
import { readOfficePackage, OfficeExtractionError, officeMainPart, assertOfficeContentType } from './officePackage.ts'
import { presentationSlides, presentationRelationships, isSlideRelationship, slideContentType, slideBodyText, slideIsHidden } from './pptxText.ts'

/** Worker-only bounded projection of visible slide text. No media, references,
 * notes, comments, layout/master text or external target is executed/read. */
export async function extractPptx(bytes: Uint8Array): Promise<PptxImportResult> {
  if (bytes.byteLength > MAX_PPTX_FILE_BYTES) return pptxImportFailure('file-too-large')
  let officePackage: Awaited<ReturnType<typeof readOfficePackage>> | undefined
  try {
    officePackage = await readOfficePackage(bytes, { maxEntries: MAX_PPTX_ENTRIES, maxPartBytes: MAX_PPTX_PART_BYTES, maxExpandedBytes: MAX_PPTX_EXPANDED_BYTES })
    const main = officeMainPart(await officePackage.readPart('_rels/.rels'))
    assertOfficeContentType(await officePackage.readPart('[Content_Types].xml'), main, 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')
    const relationshipsPath = `${main.slice(0, main.lastIndexOf('/') + 1)}_rels/${main.slice(main.lastIndexOf('/') + 1)}.rels`
    const relationships = presentationRelationships(await officePackage.readPart(relationshipsPath), main)
    const slideIds = presentationSlides(await officePackage.readPart(main))
    const contentTypes = await officePackage.readPart('[Content_Types].xml')
    const targets = new Set<string>()
    const output: string[] = []
    let used = 0
    const encoder = new TextEncoder()
    for (let index = 0; index < slideIds.length; index += 1) {
      const item = slideIds[index]!
      const relation = relationships.get(item.relation)
      if (!relation) throw new OfficeExtractionError('invalid')
      if (!isSlideRelationship(relation.type)) throw new OfficeExtractionError('unsupported')
      if (targets.has(relation.target)) throw new OfficeExtractionError('invalid')
      targets.add(relation.target)
      assertOfficeContentType(contentTypes, relation.target, slideContentType)
      const slideXml = await officePackage.readPart(relation.target)
      if (slideIsHidden(slideXml)) continue
      const text = slideBodyText(slideXml)
      if (!text.trim()) continue
      const block = `${output.length ? '\n' : ''}Slide ${index + 1}: ${text}`
      used += encoder.encode(block).byteLength
      if (used > MAX_PPTX_TEXT_BYTES) throw new OfficeExtractionError('text-limit')
      output.push(block)
    }
    return output.length ? { text: output.join(''), documentImport: { format: 'pptx', status: 'ready' } } : { documentImport: { format: 'pptx', status: 'no-text' } }
  } catch (error) {
    return pptxImportFailure(error instanceof OfficeExtractionError ? error.status : 'invalid')
  } finally {
    await officePackage?.close()
  }
}
