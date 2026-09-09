import type { ArtifactContent } from '../contract/index.ts'

export type SlidesBody = Extract<ArtifactContent, { type: 'slides' }>
export type PresentationTextBox = { name: string; text: string; x: number; y: number; width: number; height: number; fontSize: number; bold: boolean; bullet: boolean }
export type PresentationPage = { sourceSlide: number; part: number; boxes: PresentationTextBox[] }
export const PRESENTATION_WIDTH = 960
export const PRESENTATION_HEIGHT = 540
const LEFT = 54
const TOP = 42
const BOTTOM = 486
const WIDTH = PRESENTATION_WIDTH - LEFT * 2

/** XML 1.0 cannot contain these code units. Refuse the complete export instead
 * of silently changing saved text or emitting a corrupt Office package. */
export function hasPowerPointText(body: SlidesBody): boolean {
  const invalid = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udfff]/u
  return body.slides.every((slide) => [slide.title, ...slide.bullets].every((text) => !invalid.test(text)))
}

function glyphWidth(char: string): number {
  if (/\p{Mark}|[\u200c\u200d\ufe0e\ufe0f]/u.test(char)) return 0
  if (char === '\t') return 2.8
  if (char === ' ') return 0.4
  if (/[ilI1.,'!:;]/u.test(char)) return 0.42
  if (/[MWmw@%]/u.test(char)) return 1.05
  return char.codePointAt(0)! > 0x2ff ? 1.15 : /[A-Z]/u.test(char) ? 0.82 : 0.68
}

/** Conservative wrapping estimates only: fragments retain the exact input,
 * including hard line endings and spaces. Native editable text does the final
 * wrapping, with extra line-height room for platform font substitution. */
export function presentationLines(text: string, fontSize: number, width: number): string[] {
  if (!text) return ['']
  const result: string[] = []
  let start = 0, end = 0, used = 0, breakAt = -1
  for (const char of text) {
    const next = end + char.length
    if (char === '\n' || char === '\r') {
      if (char === '\n' && end > 0 && text[end - 1] === '\r') {
        result[result.length - 1] += char
        start = next
      } else {
        result.push(text.slice(start, next))
        start = next
      }
      used = 0; breakAt = -1; end = next
      continue
    }
    const advance = glyphWidth(char) * fontSize
    if (used + advance > width && end > start) {
      const cut = breakAt > start ? breakAt : end
      result.push(text.slice(start, cut))
      start = cut
      used = Array.from(text.slice(start, end)).reduce((sum, value) => sum + glyphWidth(value) * fontSize, 0)
      breakAt = -1
    }
    used += advance
    end = next
    if (/\s/u.test(char)) breakAt = end
  }
  if (start < text.length) result.push(text.slice(start))
  return result
}

/** Stable 16:9 title/bullet flow, without summaries, dropped text or tiny fonts.
 * Long titles and bullets can span pages. Source/part markers distinguish these
 * continuations from additional authored slides. No cover is invented. */
export function presentationPages(body: SlidesBody): PresentationPage[] {
  const pages: PresentationPage[] = []
  body.slides.forEach((slide, sourceIndex) => {
    let part = 0, y = TOP
    const nextPage = () => {
      const page = { sourceSlide: sourceIndex + 1, part: ++part, boxes: [] as PresentationTextBox[] }
      pages.push(page)
      y = TOP
      return page
    }
    let page = nextPage()
    const place = (text: string, name: string, title: boolean) => {
      const fontSize = title ? 32 : 24
      const lineHeight = title ? 42 : 34
      const x = LEFT + (title ? 0 : 18)
      const width = WIDTH - (title ? 0 : 18)
      const lines = presentationLines(text, fontSize, width - 18)
      let offset = 0
      while (offset < lines.length) {
        const available = Math.floor((BOTTOM - y - 10) / lineHeight)
        if (available < 1) { page = nextPage(); continue }
        const length = Math.min(available, lines.length - offset)
        const height = length * lineHeight + 10
        page.boxes.push({ name, text: lines.slice(offset, offset + length).join(''), x, y, width, height, fontSize, bold: title, bullet: !title && offset === 0 })
        offset += length
        y += height + (title ? 20 : 12)
      }
    }
    place(slide.title, 'Slide title', true)
    slide.bullets.forEach((bullet, index) => place(bullet, `Bullet ${index + 1}`, false))
  })
  return pages
}
