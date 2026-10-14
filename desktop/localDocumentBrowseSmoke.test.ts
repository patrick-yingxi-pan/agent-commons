import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { localDocumentBrowseFixtures } from './localDocumentBrowseSmoke.mjs'
import { collectPdfText } from '../contract/pdfImport.mjs'
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
  assert.ok(gitBrowse > git.indexOf("await send(run.page, 'Read only the selected saved file.'"), 'four-format Git walk follows existing text acceptance')
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
})

test('packaged document preview capture centers the selected text without relaxing containment', () => {
  const source = readFileSync(new URL('./localDocumentBrowseSmoke.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes("node.scrollIntoView({ block: 'center', inline: 'nearest' })"), 'short-landscape preview capture scrolls inward from the clipped ancestor edge')
  assert.ok(source.includes('expect(preview).toBeInViewport({ ratio: 1 })'), 'every complete preview must remain fully visible')
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
  assert.ok(source.includes('element.ownerDocument.elementFromPoint(x, y)'), 'capture admission checks the actual painted hit target')
  assert.ok(source.includes('element.contains(hit)'), 'overlay coverage cannot count as readable text')
  for (const [target, suffix] of [['disclosure', 'disclosure'], ['preview', 'text']]) {
    const check = source.indexOf(`await expectUncovered(${target})`)
    const capture = source.indexOf('`${item.format}-' + suffix + '-${width}x${height}.png`')
    assert.ok(check > 0 && capture > check, `${suffix} capture requires its own uncovered target`)
  }
})
