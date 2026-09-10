import assert from 'node:assert/strict'
import test from 'node:test'
import type { UiHostFile } from './uiHostFs.ts'
import { reviewArtifactPresentationImport } from './artifactPresentationImport.ts'
import {
  MAX_AUTHORED_CELL_CHARS, MAX_AUTHORED_LABEL_CHARS, MAX_AUTHORED_SLIDE_BULLETS,
  MAX_AUTHORED_SLIDES, MAX_AUTHORED_STRUCTURE_CHARS,
} from '../../contract/artifactAuthoring.ts'

type Candidate = Pick<UiHostFile, 'name' | 'kind' | 'documentImport' | 'presentation'>
type Ready = Extract<ReturnType<typeof reviewArtifactPresentationImport>, { status: 'ready' }>
type ErrorResult = Extract<ReturnType<typeof reviewArtifactPresentationImport>, { status: 'error' }>

const snapshot = (slides: Array<{ sourceSlide: number; paragraphs: string[] }>, totalSlides = slides.length, hiddenSlides = 0) => ({
  totalSlides, hiddenSlides, slides,
})

function file(overrides: Partial<Candidate> = {}): Candidate {
  return {
    name: 'source-deck.pptx',
    kind: 'file',
    documentImport: { format: 'pptx', status: 'ready' },
    presentation: snapshot([{ sourceSlide: 1, paragraphs: ['Title', 'Bullet'] }]),
    ...overrides,
  }
}

function ready(result: ReturnType<typeof reviewArtifactPresentationImport>): Ready {
  assert.equal(result.status, 'ready')
  return result
}

function errorResult(result: ReturnType<typeof reviewArtifactPresentationImport>): ErrorResult {
  assert.equal(result.status, 'error')
  return result
}

test('cancels, rejects wrong kind/extension/multiple selections, and fails closed on status or malformed snapshots', () => {
  assert.deepEqual(reviewArtifactPresentationImport([]), { status: 'cancelled' })
  assert.match(errorResult(reviewArtifactPresentationImport([file({ kind: 'photo' })])).message, /PowerPoint/)
  assert.match(errorResult(reviewArtifactPresentationImport([file({ name: 'source.pdf' })])).message, /PowerPoint/)
  assert.match(errorResult(reviewArtifactPresentationImport([file(), file()])).message, /one PowerPoint/)
  assert.match(errorResult(reviewArtifactPresentationImport([file({ documentImport: { format: 'pptx', status: 'no-text' } })])).message, /No readable text/)
  assert.match(errorResult(reviewArtifactPresentationImport([file({ documentImport: { format: 'pptx', status: 'ready' }, presentation: undefined })])).message, /complete slide snapshot/)
  assert.match(errorResult(reviewArtifactPresentationImport([file({ presentation: { totalSlides: 2, hiddenSlides: 0, slides: [] } })])).message, /complete slide snapshot/)
})

test('maps exact paragraph order without interpreting marker-looking text and preserves empty source numbering', () => {
  const result = ready(reviewArtifactPresentationImport([file({
    name: '/tmp/Quarterly Deck.pptx',
    presentation: snapshot([
      { sourceSlide: 1, paragraphs: ['Slide 99: authored title', 'Slide 2: authored bullet'] },
      { sourceSlide: 2, paragraphs: ['   '] },
      { sourceSlide: 4, paragraphs: ['Final title', '', 'Final bullet'] },
    ], 4, 1),
  })]))
  assert.equal(result.name, 'Quarterly Deck.slides')
  assert.deepEqual(result.body, {
    type: 'slides',
    slides: [
      { title: 'Slide 99: authored title', bullets: ['Slide 2: authored bullet'] },
      { title: 'Slide 2', bullets: [] },
      { title: 'Final title', bullets: ['Final bullet'] },
    ],
  })
  assert.match(result.disclosure, /^3 of 4 source slides\. 1 hidden slide is omitted\./)
  assert.match(result.disclosure, /1 visible slide has no readable text and keeps a numbered placeholder title\./)
})

test('all blank visible slides are rejected and invalid names use the safe fallback', () => {
  const blank = errorResult(reviewArtifactPresentationImport([file({
    presentation: snapshot([{ sourceSlide: 1, paragraphs: ['  '] }, { sourceSlide: 2, paragraphs: [] }]),
  })]))
  assert.equal(blank.message, 'No readable slide text was found. No slides were imported.')
  const fallback = ready(reviewArtifactPresentationImport([file({
    name: `bad\u0000.pptx`,
  })]))
  assert.equal(fallback.name, 'imported-presentation.slides')
})

test('accepts exact per-slide limits and rejects one-over values without partial output', () => {
  const exactSlides = Array.from({ length: MAX_AUTHORED_SLIDES }, (_, index) => ({ sourceSlide: index + 1, paragraphs: [`Title ${index + 1}`] }))
  assert.equal(ready(reviewArtifactPresentationImport([file({ presentation: snapshot(exactSlides) })])).body.slides.length, MAX_AUTHORED_SLIDES)
  const tooManySlides = errorResult(reviewArtifactPresentationImport([file({ presentation: snapshot([...exactSlides, { sourceSlide: MAX_AUTHORED_SLIDES + 1, paragraphs: ['Overflow'] }], MAX_AUTHORED_SLIDES + 1) })]))
  assert.match(tooManySlides.message, /authoring limit/)

  const exactBullets = ['Title', ...Array.from({ length: MAX_AUTHORED_SLIDE_BULLETS }, (_, index) => `Bullet ${index + 1}`)]
  assert.equal(ready(reviewArtifactPresentationImport([file({ presentation: snapshot([{ sourceSlide: 1, paragraphs: exactBullets }]) })])).body.slides[0]?.bullets.length, MAX_AUTHORED_SLIDE_BULLETS)
  const tooManyBullets = errorResult(reviewArtifactPresentationImport([file({ presentation: snapshot([{ sourceSlide: 1, paragraphs: ['Title', ...Array.from({ length: MAX_AUTHORED_SLIDE_BULLETS + 1 }, (_, index) => `Bullet ${index + 1}`)] }]) })]))
  assert.match(tooManyBullets.message, /authoring limit/)

  const exactTitle = 'T'.repeat(MAX_AUTHORED_LABEL_CHARS)
  assert.equal(ready(reviewArtifactPresentationImport([file({ presentation: snapshot([{ sourceSlide: 1, paragraphs: [exactTitle] }]) })])).body.slides[0]?.title, exactTitle)
  const tooLongTitle = errorResult(reviewArtifactPresentationImport([file({ presentation: snapshot([{ sourceSlide: 1, paragraphs: [`${exactTitle}x`] }]) })]))
  assert.match(tooLongTitle.message, /authoring limits/)

  const exactBullet = 'B'.repeat(MAX_AUTHORED_CELL_CHARS)
  assert.equal(ready(reviewArtifactPresentationImport([file({ presentation: snapshot([{ sourceSlide: 1, paragraphs: ['Title', exactBullet] }]) })])).body.slides[0]?.bullets[0], exactBullet)
  const tooLongBullet = errorResult(reviewArtifactPresentationImport([file({ presentation: snapshot([{ sourceSlide: 1, paragraphs: ['Title', `${exactBullet}x`] }]) })]))
  assert.match(tooLongBullet.message, /authoring limits/)
})

test('accepts the exact aggregate authoring limit and rejects one additional character', () => {
  const exact = Array.from({ length: 10 }, (_, index) => ({ sourceSlide: index + 1, paragraphs: ['T', 'B'.repeat(MAX_AUTHORED_CELL_CHARS - 1)] }))
  const accepted = ready(reviewArtifactPresentationImport([file({ presentation: snapshot(exact) })]))
  assert.equal(accepted.body.slides.reduce((total, slide) => total + slide.title.length + slide.bullets.reduce((sum, bullet) => sum + bullet.length, 0), 0), MAX_AUTHORED_STRUCTURE_CHARS)

  const oneOver = exact.map((slide, index) => index === 0 ? { ...slide, paragraphs: ['TT', slide.paragraphs[1]!] } : slide)
  const rejected = errorResult(reviewArtifactPresentationImport([file({ presentation: snapshot(oneOver) })]))
  assert.match(rejected.message, new RegExp(`${MAX_AUTHORED_STRUCTURE_CHARS.toLocaleString()} character`))
  assert.equal(rejected.message.includes('No slides were imported'), true)
})
