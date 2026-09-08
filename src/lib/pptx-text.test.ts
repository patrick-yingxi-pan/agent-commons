import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slideBodyText, slideIsHidden } from './pptxText.ts'

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const body = (text: string) => `<p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody>`
const shape = (text: string) => `<p:sp>${body(text)}</p:sp>`
const slide = (content: string) => `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`

test('only exact slide and text paths can contribute; familiar tags under extensions stay inert', () => {
  assert.equal(slideBodyText(slide(`${shape('visible')}<p:extLst>${shape('extension secret')}</p:extLst>`)), 'visible')
  assert.equal(slideBodyText(slide(`<p:sp><p:txBody><a:p><a:r><a:t>visible</a:t><a:extLst><a:t>run secret</a:t></a:extLst></a:r></a:p><a:extLst><a:txBody><a:p><a:r><a:t>body secret</a:t></a:r></a:p></a:txBody></a:extLst></p:txBody></p:sp>`)), 'visible')
  assert.equal(slideBodyText(`<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:extLst><p:cSld><p:spTree>${shape('fake tree')}</p:spTree></p:cSld></p:extLst></p:sld>`), '')
})

test('a table-shaped extension cannot acquire ordinary table semantics from its child names', () => {
  const cell = '<a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>table secret</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>'
  assert.equal(slideBodyText(slide(`<p:graphicFrame><a:graphic><a:graphicData uri="urn:unrecognized">${cell}</a:graphicData></a:graphic></p:graphicFrame>${shape('visible')}`)), 'visible')
})

test('explicit hidden flags mask entire owner subtrees even when the flags follow text', () => {
  const lateHidden = '<p:nvGrpSpPr><p:cNvPr hidden=" true "/></p:nvGrpSpPr>'
  assert.equal(slideBodyText(slide(`<p:grpSp>${shape('group secret')}${lateHidden}</p:grpSp>${shape('visible')}`)), 'visible')
  assert.equal(slideBodyText(slide(`<p:sp>${body('shape secret')}<p:nvSpPr><p:cNvPr hidden="1"/></p:nvSpPr></p:sp>${shape('visible')}`)), 'visible')
})

test('only explicit slide show=false hides; standard Boolean whitespace is normalized', () => {
  for (const value of ['0', 'false', ' false ']) assert.equal(slideIsHidden(`<p:sld xmlns:p="${P}" show="${value}"/>`), true)
  for (const value of ['1', 'true', ' true ']) assert.equal(slideIsHidden(`<p:sld xmlns:p="${P}" show="${value}"/>`), false)
  assert.equal(slideIsHidden(`<p:sld xmlns:p="${P}"/>`), false)
  assert.throws(() => slideIsHidden(`<p:sld xmlns:p="${P}" show="maybe"/>`))
})

test('stored fields, paragraphs and explicit breaks are text; run properties are not', () => {
  assert.equal(slideBodyText(slide('<p:sp><p:txBody><a:p><a:r><a:t>first</a:t></a:r><a:br/><a:fld><a:t>stored field</a:t></a:fld></a:p><a:p><a:r><a:rPr><a:t>property secret</a:t></a:rPr><a:t>last</a:t></a:r></a:p></p:txBody></p:sp>')), 'first\nstored field\nlast')
})
