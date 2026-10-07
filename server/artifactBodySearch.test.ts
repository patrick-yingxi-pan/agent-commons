import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactBodySearchSnippet, findArtifactBodySearchMatch, findArtifactBodySearchText } from './artifactBodySearch.ts'

test('document search visits title and every literal block field in order', () => {
  const body = {
    type: 'doc' as const,
    title: 'Needle in title',
    blocks: [
      { h: 'Needle in heading' },
      { p: 'Needle in paragraph' },
      { ul: ['Needle in list'] },
      { code: ['Needle in code'] },
      { email: { to: 'Needle in recipient', subject: 'Needle in subject' } },
    ],
  }
  assert.equal(artifactBodySearchSnippet(body, 'needle'), 'Needle in title')
  assert.equal(artifactBodySearchSnippet({ ...body, title: 'No match' }, 'needle'), 'Needle in heading')
  assert.equal(artifactBodySearchSnippet({ ...body, title: 'No match', blocks: body.blocks.slice(1) }, 'needle'), 'Needle in paragraph')
  assert.equal(artifactBodySearchSnippet({ ...body, title: 'No match', blocks: body.blocks.slice(2) }, 'needle'), 'Needle in list')
  assert.equal(artifactBodySearchSnippet({ ...body, title: 'No match', blocks: body.blocks.slice(3) }, 'needle'), 'Needle in code')
  assert.equal(artifactBodySearchSnippet({ ...body, title: 'No match', blocks: body.blocks.slice(4) }, 'needle'), 'Needle in recipient')
  assert.equal(artifactBodySearchSnippet({ ...body, title: 'No match', blocks: [{ email: { to: 'no match', subject: 'Needle in subject' } }] }, 'needle'), 'Needle in subject')
})

test('sheet, workbook, and slide search reads only their string fields', () => {
  const sheet = { type: 'sheet' as const, columns: ['Needle in header'], rows: [['Needle in cell']], note: 'Needle in note' }
  assert.equal(artifactBodySearchSnippet(sheet, 'needle'), 'Needle in header')
  assert.equal(artifactBodySearchSnippet({ ...sheet, columns: ['Other'] }, 'needle'), 'Needle in cell')
  assert.equal(artifactBodySearchSnippet({ ...sheet, columns: ['Other'], rows: [['Other']] }, 'needle'), 'Needle in note')

  const workbook = {
    type: 'workbook' as const,
    sheets: [{ id: 'tab', name: 'Needle in tab name', columns: ['Needle in tab header'], rows: [['Needle in tab cell']], note: 'Needle in tab note' }],
  }
  assert.equal(artifactBodySearchSnippet(workbook, 'needle'), 'Needle in tab name')
  assert.equal(artifactBodySearchSnippet({ ...workbook, sheets: [{ ...workbook.sheets[0]!, name: 'Other' }] }, 'needle'), 'Needle in tab header')
  assert.equal(artifactBodySearchSnippet({ ...workbook, sheets: [{ ...workbook.sheets[0]!, name: 'Other', columns: ['Other'], rows: [['Other']] }] }, 'needle'), 'Needle in tab note')

  const slides = { type: 'slides' as const, slides: [{ title: 'Needle in slide title', bullets: ['Needle in slide bullet'] }] }
  assert.equal(artifactBodySearchSnippet(slides, 'needle'), 'Needle in slide title')
  assert.equal(artifactBodySearchSnippet({ ...slides, slides: [{ title: 'Other', bullets: ['Needle in slide bullet'] }] }, 'needle'), 'Needle in slide bullet')
})

test('fields are independent and non-string or visual metadata never becomes searchable text', () => {
  const splitFields = { type: 'doc' as const, title: 'nee', blocks: [{ p: 'dle' }] }
  assert.equal(artifactBodySearchSnippet(splitFields, 'needle'), undefined)

  const malformedNote = { type: 'sheet' as const, columns: [], rows: [], note: { hidden: 'needle' } as unknown as string }
  assert.equal(artifactBodySearchSnippet(malformedNote, 'needle'), undefined)

  const figure = {
    type: 'figure' as const, shape: 'bars' as const, caption: 'Needle in caption',
    headline: 'Needle in headline', labels: ['Needle in label'], series: [1],
  }
  assert.equal(artifactBodySearchSnippet(figure, 'needle'), undefined)
  assert.equal(artifactBodySearchSnippet(undefined, 'needle'), undefined)
  assert.equal(artifactBodySearchSnippet({ type: 'doc', title: 'Needle', blocks: [] }, ''), undefined)
})

test('snippets preserve bounded original Unicode text and full-string lowercase semantics', () => {
  assert.equal(artifactBodySearchSnippet({ type: 'doc', title: 'ΟΣ', blocks: [] }, 'ος'), 'ΟΣ')
  assert.equal(artifactBodySearchSnippet({ type: 'doc', title: 'İ and text', blocks: [] }, 'i\u0307'), 'İ and text')

  const late = `${'prefix '.repeat(100)}TaRget at the end`
  const snippet = artifactBodySearchSnippet({ type: 'doc', title: late, blocks: [] }, 'target')
  assert.ok(snippet?.includes('TaRget'))
  assert.ok(snippet?.startsWith('…'))
  assert.ok(snippet.length <= 320)
})

test('body matching returns the original field without flattening or coercing it', () => {
  const body = { type: 'doc' as const, title: `${'x'.repeat(500)}Needle`, blocks: [] }
  assert.equal(findArtifactBodySearchText(body, 'needle'), body.title)
  assert.deepEqual(findArtifactBodySearchMatch(body, 'needle'), { text: body.title, field: 'doc.title' })
  assert.deepEqual(findArtifactBodySearchMatch({ type: 'sheet', columns: ['Name'], rows: [['needle']] }, 'needle'), {
    text: 'needle', field: 'sheet.cell.0.0',
  })
  assert.equal(findArtifactBodySearchText({ type: 'doc', title: 'no match', blocks: [] }, 'needle'), undefined)
  assert.ok(artifactBodySearchSnippet(body, 'needle')?.includes('Needle'))
})

test('body match locators cover authored field paths for Sheets, workbooks, and Slides', () => {
  assert.deepEqual(findArtifactBodySearchMatch({ type: 'sheet', columns: ['A'], rows: [['x']], note: 'needle' }, 'needle'), {
    text: 'needle', field: 'sheet.note',
  })
  assert.deepEqual(findArtifactBodySearchMatch({ type: 'workbook', sheets: [
    { id: 'tab-secret', name: 'Tab', columns: ['A'], rows: [['needle']], note: 'later' },
  ] }, 'needle'), { text: 'needle', field: 'workbook.0.cell.0.0' })
  assert.deepEqual(findArtifactBodySearchMatch({ type: 'slides', slides: [
    { title: 'Slide', bullets: ['opening', 'needle'] },
  ] }, 'needle'), { text: 'needle', field: 'slides.0.bullet.1' })
})
