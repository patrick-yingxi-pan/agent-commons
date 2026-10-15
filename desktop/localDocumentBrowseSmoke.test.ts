import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { localDocumentBrowseFixtures } from './localDocumentBrowseSmoke.mjs'
import { collectPdfText } from '../contract/pdfTextCollection.mjs'
import { extractDocx } from '../src/lib/docxExtraction.ts'
import { extractXlsx } from '../src/lib/xlsxExtraction.ts'
import { extractPptx } from '../src/lib/pptxExtraction.ts'

test('packaged selected-document fixtures have exact real PDF and Office extraction oracles', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  for (const source of ['folder', 'git']) {
    const fixtures = localDocumentBrowseFixtures(source)
    assert.deepEqual(fixtures.map(item => item.format), ['pdf', 'docx', 'xlsx', 'pptx'])
    for (const item of fixtures) {
      let actual
      if (item.format === 'pdf') {
        const loading = pdfjs.getDocument({ data: new Uint8Array(item.bytes), verbosity: pdfjs.VerbosityLevel.ERRORS })
        try { actual = await collectPdfText(await loading.promise) }
        finally { await loading.destroy() }
      } else {
        const extract = { docx: extractDocx, xlsx: extractXlsx, pptx: extractPptx }[item.format]
        actual = await extract(item.bytes)
      }
      assert.deepEqual(actual, { text: item.text, documentImport: item.outcome }, `${source} ${item.format} fixture oracle matches actual extraction`)
      assert.ok(item.text.includes(item.marker))
      assert.equal(item.text.includes('selected-hidden-'), false)
    }
  }
})

test('packaged local-document fixture can append a captured image-only PDF with OCR projection metadata', () => {
  for (const source of ['folder', 'git']) {
    const fixtures = localDocumentBrowseFixtures(source, Buffer.from('%PDF-1.7\nfixture'))
    assert.equal(fixtures.length, 5)
    assert.deepEqual(fixtures.at(-1), {
      format: 'pdf', path: 'browse-documents/scanned-source.pdf', marker: 'Scan Alpha 427',
      bytes: Buffer.from('%PDF-1.7\nfixture'),
      text: '[Page 1]\nScan Alpha 427\n\n[Page 2]\nScan Bravo 813',
      outcome: { format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' },
      extraction: { format: 'pdf', pages: 2, text_pages: 2, method: 'ocr' }, ocr: true,
    })
  }
})

test('packaged local OCR overwrites the source before using the real native recognition bridge', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const branch = source.indexOf('if (item.ocr) {')
  const replace = source.indexOf("await writeFile(join(root, item.path), 'selected-source-replaced-after-preview')", branch)
  const recognize = source.indexOf("getByRole('button', { name: 'Recognize scanned text', exact: true }).click()", branch)
  const reviewed = source.indexOf('await expect(preview).toHaveText(item.text, { timeout: TIMEOUT_MS })', recognize)
  assert.ok(branch >= 0 && replace > branch && recognize > replace && reviewed > recognize,
    'source replacement precedes explicit OCR and its exact reviewed result')
  assert.ok(source.includes("import { pdfOcrFixture } from './pdfOcrFixture.mjs'"),
    'the smoke uses the generated image-only native PDF fixture')
  assert.doesNotMatch(source, /agentCommonsDesktop|pdfOcr\s*\.\s*recognize\s*=|addInitScript|exposeBinding/,
    'the packaged workflow does not replace or mock the native OCR bridge')
})

test('packaged connected-source OCR adoption stays review-only until exact Document creation', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const lifecycle = source.slice(source.indexOf('export async function smokeLocalDocumentBrowse('), source.indexOf('export async function verifyLocalDocumentBrowseRelaunch('))
  const lastSavedAttachment = lifecycle.lastIndexOf("name: 'Attach saved copy', exact: true")
  const adoptionBlock = lifecycle.indexOf('let createdDocument = null')
  const guard = lifecycle.indexOf('if (ocrFixture?.ocr) {')
  const open = lifecycle.indexOf("name: 'Use text in new document'")
  const cancel = lifecycle.indexOf("name: 'Cancel', exact: true", open)
  const pickerAlive = lifecycle.indexOf('await expect(picker).toBeVisible()', cancel)
  const reAdopt = lifecycle.indexOf('const adopted = await openDraft()', pickerAlive)
  const edit = lifecycle.indexOf("getByLabel('Content', { exact: true }).fill(editedText)", reAdopt)
  const create = lifecycle.indexOf("name: 'Create document', exact: true", edit)
  const savedBody = lifecycle.indexOf('assert.deepEqual(savedDocuments.bodies[artifact.id], expectedBody', create)
  const sourceAbsentPath = lifecycle.indexOf('await page.goto(`${origin}/s/${encodeURIComponent(session.id)}`)', savedBody)
  const existingSend = lifecycle.indexOf('await sendSaved(page, endpoint, expectedFiles', sourceAbsentPath)
  const pickerClose = lifecycle.indexOf("name: 'Done', exact: true", adoptionBlock)
  assert.ok(lastSavedAttachment >= 0 && adoptionBlock > lastSavedAttachment && pickerClose > savedBody,
    'the OCR workflow runs after every saved copy and while the source picker is still open')
  assert.ok(guard > adoptionBlock && open > guard && cancel > open && pickerAlive > cancel && reAdopt > pickerAlive,
    'only the actual macOS OCR result is adopted; Cancel leaves its picker and preview available for re-adoption')
  assert.ok(edit > reAdopt && create > edit && savedBody > create,
    'the second adoption is edited and explicitly created before the exact canonical Document is checked')
  assert.ok(source.includes("await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('scanned-source.md')") &&
    source.includes('await expect(dialog.getByLabel(\'Content\', { exact: true })).toHaveValue(ocrFixture.text)'),
    'the form is seeded with the exact reviewed name and OCR text')
  assert.ok(source.includes('documentImportCopy(ocrFixture.outcome)'), 'the form retains the exact OCR disclosure')
  assert.ok(source.includes('endpoint.requests.length, modelRequestCount'), 'the create path proves no model call')
  assert.ok(source.includes('docBlockId(artifact.id, 0, index)'), 'saved canonical paragraphs have exact artifact block identities')
  assert.ok(source.includes("'[Page 1] Scan Alpha 427'") && source.includes("'[Page 2] Scan Bravo 813'") &&
    source.includes("'Created from reviewed connected preview.'"),
  'the canonical oracle spells out ordinary authored paragraph line-wrap normalization without calling the production parser')
  assert.ok(source.includes('await expect(panel).toBeInViewport({ ratio: 1 })') &&
    source.includes('await expect(footer).toBeInViewport({ ratio: 1 })') &&
    source.includes('await expectUncovered(panel)') && source.includes('await expectUncovered(footer)'),
  'every viewport checks full panel and footer containment plus painted hit ownership')
  assert.ok(source.includes('creating a private Document'), 'creation copy does not imply the artifact is shared')
  assert.ok(source.includes('`pdf-ocr-new-document-${width}x${height}.png`'), 'the adopted form has five-viewport captures')
  assert.ok(sourceAbsentPath > savedBody && existingSend > sourceAbsentPath,
    'the smoke returns to the original conversation before its existing saved-copy Send continuation')
})

test('packaged connected-source Document is rechecked after the full source-absent relaunch', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const relaunch = source.slice(source.indexOf('export async function verifyLocalDocumentBrowseRelaunch('))
  const sourceGone = relaunch.indexOf("await assert.rejects(stat(receipt.sourceDirectory), { code: 'ENOENT' }")
  const identity = relaunch.indexOf('receipt.createdDocument.id', sourceGone)
  const body = relaunch.indexOf('authored.bodies[receipt.createdDocument.id]', identity)
  assert.ok(sourceGone >= 0 && identity > sourceGone && body > identity,
    'after the generated source directory is absent, relaunch checks the exact authored Document identity and body')
  assert.ok(relaunch.includes('assert.deepEqual(authored.bodies[receipt.createdDocument.id], receipt.createdDocument.body'),
    'relaunch compares the full canonical Document body, including paragraph IDs and edited text')
})

test('packaged document browsing is awaited for both native sources before source-absent relaunch', () => {
  const folder = readFileSync(new URL('./attachmentSmoke.mjs', import.meta.url), 'utf8')
  const git = readFileSync(new URL('./localGitSmoke.mjs', import.meta.url), 'utf8')
  const folderBrowse = folder.indexOf('await smokeLocalDocumentBrowse(')
  const folderClose = folder.indexOf('await run.app.close()', folderBrowse)
  const folderRemove = folder.indexOf('await rm(ephemeralFolder, { recursive: true })')
  const folderRestart = folder.indexOf('run = await launch(executable, userDataPath)', folderRemove)
  const folderRelaunch = folder.indexOf('await verifyLocalDocumentBrowseRelaunch(')
  assert.ok(folderBrowse > folder.indexOf('await smokeLocalFolderBrowse('), 'four-format folder walk follows existing text acceptance')
  assert.ok(folderClose > folderBrowse, 'the packaged process really exits after document acceptance')
  assert.ok(folderRemove > folderClose, 'generated document sources disappear while the app is closed')
  assert.ok(folderRestart > folderRemove, 'a new packaged process starts after source removal')
  assert.ok(folderRelaunch > folderRestart, 'saved document metadata and exact model input are rechecked after relaunch')
  const gitBrowse = git.indexOf('await smokeLocalDocumentBrowse(')
  const gitHold = git.indexOf('await rename(documentBrowseReceipt.sourceDirectory,')
  const gitClose = git.indexOf('await run.app.close()', gitHold)
  const gitRestart = git.indexOf('run = await relaunch(executable, userDataPath)', gitClose)
  const gitRelaunch = git.indexOf('await verifyLocalDocumentBrowseRelaunch(')
  const gitFileBrowse = git.indexOf('const trackedImageReceipt = await smokeLocalImageBrowse(')
  assert.ok(gitFileBrowse > 0 && gitBrowse > gitFileBrowse, 'four-format Git walk follows the selected text-and-image acceptance')
  assert.ok(gitHold > gitBrowse, 'Git document files are moved outside the connected source before relaunch')
  assert.ok(gitClose > gitHold, 'the packaged Git process exits after source removal')
  assert.ok(gitRestart > gitClose, 'the Git conversation is reopened by a new packaged process')
  assert.ok(gitRelaunch > gitRestart, 'saved Git document copies are exercised without their original paths')
  assert.match(git, /git\(gitExecutable, repository, 'add', '--', \.\.\.paths\)/, 'only generated fixtures are staged before product browsing')
  assert.match(git, /return \(\) => assertIndexUnchanged\(repository, documentIndex\)/, 'document browsing preserves split-index bytes and mtime')
})

test('packaged document acceptance helpers never ship', () => {
  assert.equal(ignoreFromPackage('/desktop/localDocumentBrowseSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/localDocumentBrowseSmoke.test.ts'), true)
  assert.equal(ignoreFromPackage('/desktop/pdfOcrFixture.mjs'), true)
})

test('packaged document preview capture centers disclosure and text without relaxing containment', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const resize = source.indexOf('await page.setViewportSize({ width, height })')
  const settleBody = source.indexOf("await settledOpaquePaint(picker.locator('[data-fs-picker-body]'))", resize)
  const firstScroll = source.indexOf('await disclosure.evaluate(node => node.scrollIntoView', resize)
  assert.ok(resize > 0 && settleBody > resize && firstScroll > settleBody,
    'the resized inner scrollport settles before choosing a centered scroll position')
  for (const target of ['disclosure', 'preview']) {
    assert.ok(source.includes(`await ${target}.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))`), `${target} capture scrolls inward from the clipped ancestor edge`)
    const scroll = source.indexOf(`await ${target}.evaluate(node => node.scrollIntoView`)
    const settle = source.indexOf(`await settledOpaquePaint(${target})`, scroll)
    const containment = source.indexOf(`expect(${target}).toBeInViewport({ ratio: 1 })`, scroll)
    assert.ok(settle > scroll && containment > settle, `${target} settles before strict visibility is judged`)
    assert.ok(source.includes(`expect(${target}).toBeInViewport({ ratio: 1 })`), `${target} must remain fully visible`)
  }
})

test('packaged document relaunch opens the grouped saved-file menu before each exact preview', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const relaunch = source.slice(source.indexOf('export async function verifyLocalDocumentBrowseRelaunch('))
  const group = relaunch.indexOf("getByTitle(`Files (${receipt.fixtures.length})`, { exact: true }).click()")
  const item = relaunch.indexOf("getByRole('menu', { name: 'Files', exact: true }).getByRole('button', { name: item.path, exact: true }).click()")
  assert.ok(group > relaunch.indexOf('for (const item of receipt.fixtures)'), 'every saved-file visit opens the multi-file group')
  assert.ok(item > group, 'the exact saved file is selected from that group')
})

test('packaged document captures wait until disclosure and text are uncovered after resizing', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes("const evidenceKey = item.ocr ? 'pdf-ocr' : item.format"),
    'scanned and embedded PDF evidence have distinct names')
  assert.ok(source.includes('element.ownerDocument.elementFromPoint(x, y)'), 'capture admission checks the actual painted hit target')
  assert.ok(source.includes('element.contains(hit)'), 'overlay coverage cannot count as readable text')
  for (const [target, suffix] of [['disclosure', 'disclosure'], ['preview', 'text']]) {
    const check = source.indexOf(`await expectUncovered(${target})`)
    const capture = source.indexOf('`${evidenceKey}-' + suffix + '-${width}x${height}.png`')
    assert.ok(check > 0 && capture > check, `${suffix} capture requires its own uncovered target`)
  }
})
