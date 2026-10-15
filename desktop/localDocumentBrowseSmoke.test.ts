import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { localDocumentBrowseFixtures } from './localDocumentBrowseSmoke.mjs'
import { collectPdfText } from '../contract/pdfTextCollection.mjs'
import { extractDocx } from '../src/lib/docxExtraction.ts'
import { extractXlsx, extractXlsxPreview } from '../src/lib/xlsxExtraction.ts'
import { extractPptx, extractPptxPreview } from '../src/lib/pptxExtraction.ts'

test('packaged selected-document fixtures have exact real PDF and Office extraction oracles', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  for (const source of ['folder', 'git', 'git-untracked']) {
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
      if (item.format === 'xlsx') {
        const preview = await extractXlsxPreview(item.bytes)
        assert.deepEqual(preview.workbookImport, {
          documentImport: { format: 'xlsx', status: 'ready' },
          workbook: { totalSheets: 2, hiddenSheets: 1, unsupportedSheets: 0, worksheets: [{
            sourceSheet: 1, name: 'Visible Data', cells: [
              { row: 1, column: 1, value: item.marker },
              { row: 1, column: 2, value: '42', formula: 'cached' },
            ],
          }] },
        }, `${source} workbook fixture retains sparse/value/formula structure independently of flattened text`)
      }
      if (item.format === 'pptx') {
        const preview = await extractPptxPreview(item.bytes)
        assert.deepEqual(preview.presentationImport, {
          documentImport: { format: 'pptx', status: 'ready' },
          presentation: { totalSlides: 1, hiddenSlides: 0, slides: [{ sourceSlide: 1, paragraphs: [item.marker, 'A\tB'] }] },
        }, `${source} deck fixture retains title/table paragraph boundaries independently of flattened text`)
      }
      assert.ok(item.text.includes(item.marker))
      assert.equal(item.text.includes('selected-hidden-'), false)
    }
  }
})

test('packaged local-document fixture can append a captured image-only PDF with OCR projection metadata', () => {
  for (const source of ['folder', 'git', 'git-untracked']) {
    const fixtures = localDocumentBrowseFixtures(source, Buffer.from('%PDF-1.7\nfixture'))
    assert.equal(fixtures.length, 5)
    assert.deepEqual(fixtures.at(-1), {
      format: 'pdf', path: `${source === 'git-untracked' ? 'browse-untracked-documents' : 'browse-documents'}/scanned-source.pdf`, marker: 'Scan Alpha 427',
      bytes: Buffer.from('%PDF-1.7\nfixture'),
      text: '[Page 1]\nScan Alpha 427\n\n[Page 2]\nScan Bravo 813',
      outcome: { format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' },
      extraction: { format: 'pdf', pages: 2, text_pages: 2, method: 'ocr' }, ocr: true,
    })
  }
})

test('untracked document fixtures use isolated paths and source-specific markers', () => {
  const tracked = localDocumentBrowseFixtures('git')
  const untracked = localDocumentBrowseFixtures('git-untracked')
  assert.deepEqual(untracked.map(item => item.path), [
    'browse-untracked-documents/source.pdf',
    'browse-untracked-documents/source.docx',
    'browse-untracked-documents/source.xlsx',
    'browse-untracked-documents/source.pptx',
  ])
  assert.ok(untracked.every(item => item.path.startsWith('browse-untracked-documents/')))
  assert.ok(untracked.every(item => item.marker.includes('native-git-untracked-selected')))
  assert.equal(new Set([...tracked, ...untracked].map(item => item.path)).size, tracked.length + untracked.length,
    'tracked and untracked source paths cannot alias in the generated repository')
  assert.equal(new Set([...tracked, ...untracked].map(item => item.marker)).size, tracked.length + untracked.length,
    'tracked and untracked fixtures have distinct body markers')
  assert.throws(() => localDocumentBrowseFixtures('git-untracked-ish'), /explicit source mode/,
    'unknown source modes fail closed instead of silently browsing tracked files')
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
  const adoptionBlock = lifecycle.indexOf('const ocrFixture = fixtures.at(-1)')
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

test('untracked document browsing requires a fresh consent boundary and explicit List action', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const reopen = source.slice(source.indexOf('const reopenSourceBrowser = async () => {'), source.indexOf('let { picker, browser } = await reopenSourceBrowser()'))
  const mode = reopen.indexOf("if (source === 'git-untracked') {")
  const checkbox = reopen.indexOf("getByRole('checkbox', { name: 'Browse untracked files', exact: true })", mode)
  const falseState = reopen.indexOf("toHaveAttribute('aria-checked', 'false')", checkbox)
  const hiddenBrowser = reopen.indexOf('await expect(nextBrowser).toHaveCount(0)', falseState)
  const optIn = reopen.indexOf('await consent.click()', hiddenBrowser)
  const trueState = reopen.indexOf("toHaveAttribute('aria-checked', 'true')", optIn)
  const noListing = reopen.indexOf('`[data-local-${source}-browser-listing]`', trueState)
  const list = reopen.indexOf('await nextBrowser.getByRole(\'button\', { name: listAction, exact: true }).click()', noListing)
  const visible = reopen.indexOf('getByRole(\'list\', { name: listLabel, exact: true })', list)
  assert.ok(mode >= 0 && checkbox > mode && falseState > checkbox && hiddenBrowser > falseState,
    'the untracked path starts from a visibly disabled consent state with no browser or listing')
  assert.ok(optIn > hiddenBrowser && trueState > optIn && noListing > trueState && list > noListing && visible > list,
    'consent, absent listing, explicit List and the resulting untracked list occur in that order')
  assert.ok(reopen.includes('await expect(nextBrowser.locator(`[data-local-${source}-file-preview]`)).toHaveCount(0)'),
    'listing metadata remains separate from a selected file preview')
  assert.ok(reopen.includes('assert.deepEqual(await workspace(page, session.id), before') &&
    reopen.includes('assert.equal(endpoint.requests.length, requestCount'),
  'consent and listing leave saved workspace and model request count unchanged')
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

test('packaged native Office preview adopts captured workbook and deck structure only after explicit Use and Create', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  const loop = source.slice(source.indexOf('for (const [index, item] of fixtures.entries())'), source.indexOf('const ocrFixture = fixtures.at(-1)'))
  const replace = loop.indexOf("await writeFile(join(root, item.path), 'selected-source-replaced-after-preview')")
  const attach = loop.indexOf("name: 'Attach saved copy', exact: true", replace)
  const adopt = loop.indexOf('await adoptStructuredPreview({ page, browser, item, source, root, endpoint, sessionId: session.id })', attach)
  assert.ok(replace >= 0 && attach > replace && adopt > attach,
    'the native Office source is replaced after preview and before structured adoption')
  const helper = source.slice(source.indexOf('async function adoptStructuredPreview('), source.indexOf('/** Only generated source files'))
  for (const action of ['Review as new', 'Use imported sheet', 'Use imported slides']) {
    assert.ok(helper.includes(action), `the packaged workflow exercises ${action}`)
  }
  assert.ok(helper.includes("Create ${kind === 'sheet' ? 'sheet' : 'slides'}"), 'the workflow commits only through the normal kind-specific Create button')
  assert.ok(helper.includes("readFile(join(root, item.path), 'utf8')") && helper.includes('selected-source-replaced-after-preview'),
    'the exact original path contains replacement content during adoption, so the selected result must come from its captured preview')
  assert.ok(helper.includes('artifactBaseline') && helper.includes('authoredDocuments(page), artifactBaseline'),
    'review, Use and edits do not autosave before Create')
  assert.ok(helper.includes('endpoint.requests.length, modelRequestCount'),
    'review, edit and Create do not dispatch a model call')
  assert.ok(helper.includes("columns: ['Column A', 'Column B'], rows: [['Edited from captured workbook', '42']]"),
    'the saved Sheet oracle verifies exact edited cells and generated labels')
  assert.ok(helper.includes("title: item.marker, bullets: ['Edited from captured deck']"),
    'the saved Slides oracle verifies exact source slide boundary and edited bullet')
  const relaunch = source.slice(source.indexOf('export async function verifyLocalDocumentBrowseRelaunch('))
  assert.ok(relaunch.includes('receipt.createdStructured?.length, 2') && relaunch.includes('exact canonical edited ${savedDraft.kind} body survives source-absent relaunch'),
    'both canonical Office artifacts are verified after generated source removal and process relaunch')
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

  const untrackedBrowse = git.indexOf('const untrackedDocumentReceipt = await smokeLocalDocumentBrowse(')
  const untrackedIndex = git.lastIndexOf('const untrackedDocumentIndex = await indexState(repository)', untrackedBrowse)
  const untrackedMove = git.indexOf("await rename(untrackedDocumentReceipt.sourceDirectory,", untrackedBrowse)
  const close = git.indexOf('await run.app.close()', untrackedMove)
  const restart = git.indexOf('run = await relaunch(executable, userDataPath)', close)
  const untrackedRelaunch = git.indexOf('await verifyLocalDocumentBrowseRelaunch(run, untrackedDocumentReceipt, endpoint)', restart)
  assert.ok(untrackedIndex >= 0 && untrackedIndex < untrackedBrowse,
    'the untracked Git index baseline is captured before the helper creates its fixtures')
  assert.ok(git.slice(untrackedBrowse, untrackedMove).includes("source: 'git-untracked'"),
    'the scanned PDF and Office drafts use the explicit untracked browser mode')
  const untrackedCall = git.slice(untrackedBrowse, untrackedMove)
  assert.doesNotMatch(untrackedCall, /git\(gitExecutable, repository, ['"]add['"]|prepareFiles\s*:\s*async\s*paths/,
    'the new untracked document phase never stages its generated source files')
  assert.ok(untrackedCall.includes('prepareFiles: async () =>') &&
    untrackedCall.includes('await assertIndexUnchanged(repository, untrackedDocumentIndex)') &&
    untrackedCall.includes('return () => assertIndexUnchanged(repository, untrackedDocumentIndex)'),
  'the generated untracked files are guarded by full index and shared-index byte/mtime comparisons')
  assert.ok(untrackedMove > untrackedBrowse && close > untrackedMove && restart > close && untrackedRelaunch > restart,
    'untracked generated sources are removed before the full process relaunch and receipt verification')
  const identity = git.indexOf('assert.equal(new Set(authoredIds).size, 6', untrackedBrowse)
  assert.ok(identity > untrackedBrowse && identity < untrackedMove,
    'tracked and untracked OCR/Sheet/Slides drafts retain six distinct authored artifact identities')
  assert.ok(git.indexOf('await assertIndexUnchanged(repository, untrackedDocumentIndex)', untrackedMove) > untrackedMove &&
    git.indexOf('await assertIndexUnchanged(repository, untrackedDocumentIndex)', untrackedRelaunch) > untrackedRelaunch,
  'index bytes and mtimes are rechecked after source removal and after relaunch')
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
