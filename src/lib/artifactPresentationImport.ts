import { parsePresentationSnapshot } from '../../contract/presentationImport.ts'
import { isPptxFileName, isPptxImportOutcome, pptxImportCopy } from '../../contract/pptxImport.mjs'
import {
  MAX_AUTHORED_SLIDES, MAX_AUTHORED_SLIDE_BULLETS, MAX_AUTHORED_LABEL_CHARS,
  MAX_AUTHORED_CELL_CHARS, MAX_AUTHORED_STRUCTURE_CHARS, parseStructuredArtifactBody,
  type StructuredArtifactBody,
} from '../../contract/artifactAuthoring.ts'
import { normalizeArtifactName } from '../../contract/artifactMetadata.ts'
import type { UiHostFile } from './uiHostFs.ts'

export type ArtifactPresentationImportResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string; body: Extract<StructuredArtifactBody, { type: 'slides' }>; disclosure: string }

/** Map source structure, never the attachment's display text. A title/bullet
 * outline is explicitly reviewed and must fit the whole authoring contract. */
export function reviewArtifactPresentationImport(
  files: readonly Pick<UiHostFile, 'name' | 'kind' | 'documentImport' | 'presentation'>[],
): ArtifactPresentationImportResult {
  if (files.length === 0) return { status: 'cancelled' }
  if (files.length !== 1) return { status: 'error', message: 'Choose one PowerPoint presentation to import.' }
  const file = files[0]
  if (file.kind !== 'file' || !isPptxFileName(file.name)) return { status: 'error', message: 'Choose a PowerPoint (.pptx) file.' }
  if (!isPptxImportOutcome(file.documentImport)) return { status: 'error', message: 'The presentation did not produce a complete slide snapshot.' }
  if (file.documentImport.status !== 'ready') return { status: 'error', message: pptxImportCopy(file.documentImport).replace(/\breattach\b/gi, 'choose again for import').replace(/\battach\b/gi, 'choose') }
  const source = parsePresentationSnapshot(file.presentation)
  if (!source) return { status: 'error', message: 'The presentation did not produce a complete slide snapshot.' }
  if (!source.slides.some((slide) => slide.paragraphs.some((paragraph) => paragraph.trim()))) return { status: 'error', message: 'No readable slide text was found. No slides were imported.' }
  const slides = source.slides.map((slide) => {
    const paragraphs = slide.paragraphs.filter((paragraph) => paragraph.trim().length > 0)
    return { title: paragraphs[0] ?? `Slide ${slide.sourceSlide}`, bullets: paragraphs.slice(1) }
  })
  if (slides.length > MAX_AUTHORED_SLIDES) return { status: 'error', message: `This presentation has ${slides.length} visible slides. The authoring limit is ${MAX_AUTHORED_SLIDES}; split the source presentation before importing. No slides were imported.` }
  const invalid = slides.findIndex((slide) => slide.title.length > MAX_AUTHORED_LABEL_CHARS || slide.bullets.length > MAX_AUTHORED_SLIDE_BULLETS || slide.bullets.some((bullet) => bullet.length > MAX_AUTHORED_CELL_CHARS))
  if (invalid !== -1) return { status: 'error', message: `Source slide ${source.slides[invalid].sourceSlide} exceeds the authoring limits: ${MAX_AUTHORED_LABEL_CHARS} characters per title, ${MAX_AUTHORED_SLIDE_BULLETS} bullets, and ${MAX_AUTHORED_CELL_CHARS.toLocaleString()} characters per bullet. Shorten or split it before importing. No slides were imported.` }
  const body = parseStructuredArtifactBody({ type: 'slides', slides })
  if (!body || body.type !== 'slides') return { status: 'error', message: `The complete slide content exceeds the ${MAX_AUTHORED_STRUCTURE_CHARS.toLocaleString()} character authoring limit. No slides were imported.` }
  const leaf = file.name.trim().split(/[\\/]/).at(-1) ?? ''
  const name = normalizeArtifactName(`${leaf.slice(0, -5)}.slides`) ?? 'imported-presentation.slides'
  const hidden = source.hiddenSlides ? ` ${source.hiddenSlides} hidden ${source.hiddenSlides === 1 ? 'slide is' : 'slides are'} omitted.` : ''
  const empty = source.slides.filter((slide) => slide.paragraphs.every((paragraph) => !paragraph.trim())).length
  return {
    status: 'ready', name, body,
    disclosure: `${slides.length} of ${source.totalSlides} source slides.${hidden} The first visible text paragraph on each slide becomes its title; remaining paragraphs and table rows become bullets in file order. Empty paragraphs are omitted.${empty ? ` ${empty} visible ${empty === 1 ? 'slide has' : 'slides have'} no readable text and ${empty === 1 ? 'keeps' : 'keep'} a numbered placeholder title.` : ''} Layout, formatting, images, charts, animations, notes, and hidden shapes are not imported. Review the complete outline before using it.`,
  }
}
