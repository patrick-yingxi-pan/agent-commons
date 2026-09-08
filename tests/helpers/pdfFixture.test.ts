import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { pdfFixture } from './pdfFixture.mjs'
import { collectPdfText } from '../../contract/pdfImport.mjs'

async function extractFirstPage(pdf, password) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({ data: new Uint8Array(pdf), password, verbosity: pdfjs.VerbosityLevel.ERRORS })
  try {
    const document = await loading.promise
    const page = await document.getPage(1)
    return (await page.getTextContent()).items.map((item) => item.str).join('')
  } finally { await loading.destroy() }
}

test('PDF fixture emits deterministic one-, multi-, and blank-page documents', () => {
  const plain = pdfFixture({ pages: ['sentinel one', null, 'sentinel three'] })
  const compressed = pdfFixture({ pages: ['sentinel one', null, 'sentinel three'], compress: true })
  assert.deepEqual(pdfFixture({ pages: ['sentinel one', null, 'sentinel three'] }), plain)
  assert.match(plain.toString('ascii'), /^%PDF-1\.7/)
  assert.equal((plain.toString('ascii').match(/\/Type \/Page /g) ?? []).length, 3)
  assert.match(compressed.toString('ascii'), /\/Filter \/FlateDecode/)
  const streamStart = compressed.indexOf(Buffer.from('stream\n')) + 7
  const streamEnd = compressed.indexOf(Buffer.from('\nendstream'), streamStart)
  assert.equal(inflateSync(compressed.subarray(streamStart, streamEnd)).toString('ascii'), 'BT\n/F1 16 Tf\n72 720 Td\n(sentinel one) Tj\nET\n')
})

test('PDF fixture emits deterministic Unicode text with a ToUnicode map', async () => {
  const options = { pages: ['héllo 世界 — café 😀'], unicode: true, compress: true }
  const first = pdfFixture(options)
  assert.deepEqual(pdfFixture(options), first)
  assert.match(first.toString('ascii'), /\/ToUnicode \d+ 0 R/)
  assert.equal(await extractFirstPage(first), options.pages[0])
})

test('PDF fixture emits a genuine password-protected document', async () => {
  const protectedPdf = pdfFixture({ pages: ['protected sentinel'], password: 'fixture-password' })
  await assert.rejects(() => extractFirstPage(protectedPdf), (error) => error?.name === 'PasswordException')
  await assert.rejects(() => extractFirstPage(protectedPdf, 'wrong-password'), (error) => error?.name === 'PasswordException')
  assert.equal(await extractFirstPage(protectedPdf, 'fixture-password'), 'protected sentinel')
})

test('PDF fixture multiline pages provide enough parser text to hit the text limit', async () => {
  const pages = Array.from({ length: 34 }, () => Array.from({ length: 40 }, () => 'x'.repeat(50)).join('\n'))
  const pdf = pdfFixture({ pages, compress: true })
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: pdfjs.VerbosityLevel.ERRORS })
  try {
    const document = await loading.promise
    const extracted = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      const page = await document.getPage(index + 1)
      const content = await page.getTextContent()
      return content.items.map((item) => item.str).join('')
    }))
    assert.ok(extracted.join('').length > 64 * 1024)
    assert.deepEqual(await collectPdfText(document), { documentImport: { format: 'pdf', status: 'text-limit' } })
  } finally { await loading.destroy() }
})
