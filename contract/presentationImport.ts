import { isPptxImportOutcome, MAX_PPTX_SLIDES, MAX_PPTX_TEXT_BYTES, type PptxImportOutcome } from './pptxImport.mjs'

export const MAX_PRESENTATION_PARAGRAPHS = 4_096
export const MAX_PRESENTATION_TEXT_BYTES = MAX_PPTX_TEXT_BYTES

export interface PresentationSnapshot {
  totalSlides: number
  hiddenSlides: number
  slides: Array<{ sourceSlide: number; paragraphs: string[] }>
}

export interface PresentationImportResult {
  documentImport: PptxImportOutcome
  presentation?: PresentationSnapshot
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

export function parsePresentationSnapshot(value: unknown): PresentationSnapshot | undefined {
  if (!record(value)) return undefined
  const totalSlides = typeof value.totalSlides === 'number' ? value.totalSlides : NaN
  const hiddenSlides = typeof value.hiddenSlides === 'number' ? value.hiddenSlides : NaN
  if (Object.keys(value).some((key) => !['totalSlides', 'hiddenSlides', 'slides'].includes(key)) ||
      !Number.isSafeInteger(totalSlides) || totalSlides < 1 || totalSlides > MAX_PPTX_SLIDES ||
      !Number.isSafeInteger(hiddenSlides) || hiddenSlides < 0 || hiddenSlides > totalSlides ||
      !Array.isArray(value.slides) || value.slides.length !== totalSlides - hiddenSlides) return undefined
  const slides: Array<{ sourceSlide: number; paragraphs: string[] }> = []
  const seen = new Set<number>()
  let bytes = 0
  let paragraphCount = 0
  const encoder = new TextEncoder()
  for (const raw of value.slides) {
    if (!record(raw)) return undefined
    const sourceSlide = typeof raw.sourceSlide === 'number' ? raw.sourceSlide : NaN
    if (Object.keys(raw).some((key) => !['sourceSlide', 'paragraphs'].includes(key)) ||
        !Number.isSafeInteger(sourceSlide) || sourceSlide < 1 || sourceSlide > totalSlides ||
        seen.has(sourceSlide) || !Array.isArray(raw.paragraphs) || raw.paragraphs.length > MAX_PRESENTATION_PARAGRAPHS) return undefined
    seen.add(sourceSlide)
    const paragraphs: string[] = []
    for (const paragraph of raw.paragraphs) {
      if (typeof paragraph !== 'string' || paragraph.length > MAX_PRESENTATION_TEXT_BYTES) return undefined
      bytes += encoder.encode(paragraph).byteLength
      if (++paragraphCount > MAX_PRESENTATION_PARAGRAPHS || bytes > MAX_PRESENTATION_TEXT_BYTES) return undefined
      paragraphs.push(paragraph)
    }
    slides.push({ sourceSlide, paragraphs })
  }
  for (let index = 1; index < slides.length; index += 1) if (slides[index - 1]!.sourceSlide >= slides[index]!.sourceSlide) return undefined
  return { totalSlides, hiddenSlides, slides }
}

export function parsePresentationImportResult(value: unknown): PresentationImportResult {
  if (!record(value) || Object.keys(value).some((key) => !['documentImport', 'presentation'].includes(key)) ||
      !isPptxImportOutcome(value.documentImport)) return { documentImport: { format: 'pptx', status: 'invalid' } }
  if (value.documentImport.status === 'ready') {
    const presentation = parsePresentationSnapshot(value.presentation)
    return presentation ? { documentImport: { format: 'pptx', status: 'ready' }, presentation } : { documentImport: { format: 'pptx', status: 'invalid' } }
  }
  if (value.presentation !== undefined) return { documentImport: { format: 'pptx', status: 'invalid' } }
  return { documentImport: { format: 'pptx', status: value.documentImport.status } }
}
