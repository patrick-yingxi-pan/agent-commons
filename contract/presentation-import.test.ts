import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PRESENTATION_PARAGRAPHS, parsePresentationImportResult, parsePresentationSnapshot } from './presentationImport.ts'

const snapshot = { totalSlides: 3, hiddenSlides: 1, slides: [{ sourceSlide: 1, paragraphs: ['Title', 'Body'] }, { sourceSlide: 3, paragraphs: [] }] }

test('presentation snapshots are detached, ordered and retain visible empty slides', () => {
  const input = { ...snapshot, slides: snapshot.slides.map((slide) => ({ ...slide, paragraphs: [...slide.paragraphs] })) }
  const parsed = parsePresentationSnapshot(input)
  assert.deepEqual(parsed, snapshot)
  assert.notEqual(parsed!.slides, input.slides)
  assert.notEqual(parsed!.slides[0]!.paragraphs, input.slides[0]!.paragraphs)
  input.slides[0]!.paragraphs[0] = 'mutated source'
  assert.equal(parsed!.slides[0]!.paragraphs[0], 'Title')
  assert.equal(parsePresentationSnapshot({ ...snapshot, slides: [{ sourceSlide: 3, paragraphs: [] }, { sourceSlide: 1, paragraphs: ['x'] }] }), undefined)
  assert.equal(parsePresentationSnapshot({ ...snapshot, hiddenSlides: 0 }), undefined)
})

test('untrusted structural envelopes reject unknown fields, exotic records and inconsistent source indices', () => {
  for (const malformed of [null, [], { ...snapshot, path: '/private/source.pptx' }, Object.assign(new Date(), snapshot),
    { ...snapshot, totalSlides: 1.5 }, { ...snapshot, hiddenSlides: -1 },
    { ...snapshot, slides: [{ sourceSlide: 1, paragraphs: [] }, { sourceSlide: 1, paragraphs: [] }] },
    { ...snapshot, slides: [{ sourceSlide: 0, paragraphs: [] }, { sourceSlide: 3, paragraphs: [] }] },
    { ...snapshot, slides: [{ sourceSlide: 1, paragraphs: [] }, { sourceSlide: 4, paragraphs: [] }] },
    { totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: [null] }] },
    { totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: [], media: [] }] },
  ]) assert.equal(parsePresentationSnapshot(malformed), undefined)
  assert.equal(parsePresentationImportResult({ documentImport: { format: 'pptx', status: 'ready' }, presentation: snapshot, text: 'forged' }).documentImport.status, 'invalid')
})

test('failed outcomes cannot carry partial presentations and ready requires a complete snapshot', () => {
  assert.deepEqual(parsePresentationImportResult({ documentImport: { format: 'pptx', status: 'text-limit' }, presentation: snapshot }), { documentImport: { format: 'pptx', status: 'invalid' } })
  assert.deepEqual(parsePresentationImportResult({ documentImport: { format: 'pptx', status: 'ready' } }), { documentImport: { format: 'pptx', status: 'invalid' } })
  assert.deepEqual(parsePresentationImportResult({ documentImport: { format: 'pptx', status: 'no-text' } }), { documentImport: { format: 'pptx', status: 'no-text' } })
})

test('snapshot string and aggregate limits are strict', () => {
  assert.equal(parsePresentationSnapshot({ totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: ['x'.repeat(64 * 1024 + 1)] }] }), undefined)
  assert.equal(parsePresentationSnapshot({ totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: ['x'.repeat(64 * 1024), 'y'] }] }), undefined)
  const single = (paragraphs: string[]) => ({ totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs }] })
  assert.ok(parsePresentationSnapshot(single(['x'.repeat(64 * 1024)])))
  assert.equal(parsePresentationSnapshot(single(['é'.repeat(32 * 1024 + 1)])), undefined, 'UTF-8 bytes, not character count')
  assert.ok(parsePresentationSnapshot(single(Array(MAX_PRESENTATION_PARAGRAPHS).fill(''))))
  assert.equal(parsePresentationSnapshot(single(Array(MAX_PRESENTATION_PARAGRAPHS + 1).fill(''))), undefined)
  assert.equal(parsePresentationSnapshot({ totalSlides: 2, hiddenSlides: 0, slides: [
    { sourceSlide: 1, paragraphs: Array(MAX_PRESENTATION_PARAGRAPHS).fill('') }, { sourceSlide: 2, paragraphs: [''] },
  ] }), undefined, 'the paragraph bound is aggregate, not merely per slide')
})
