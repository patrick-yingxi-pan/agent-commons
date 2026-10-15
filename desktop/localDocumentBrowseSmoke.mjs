import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { settledOpaquePaint } from '../e2e/accessibility-helpers.ts'
import { documentImportCopy } from '../contract/documentImport.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { pdfOcrFixture } from './pdfOcrFixture.mjs'
import { docBlockId } from '../server/documentIdentity.ts'

const TIMEOUT_MS = 30_000
const VIEWPORTS = [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]
const SOURCE = { id: 'ui-host', kind: 'ui-host', label: 'This computer' }

function sourceDirectoryName(source) {
  assert.ok(['folder', 'git', 'git-untracked'].includes(source), 'document browsing needs an explicit source mode')
  return source === 'git-untracked' ? 'browse-untracked-documents' : 'browse-documents'
}

export function localDocumentBrowseFixtures(source, scannedPdfBytes) {
  const directory = sourceDirectoryName(source)
  const marker = `native-${source}-selected`
  const pdf = `${marker}-pdf-body`
  const word = `${marker}-word-body · café 世界 😀`
  const workbook = `${marker}-workbook-body`
  const slide = `${marker}-slide-body`
  const fixtures = [
    {
      format: 'pdf', path: `${directory}/source.pdf`, marker: pdf,
      bytes: pdfFixture({ pages: [pdf, null, 'Final selected PDF page'], compress: true }),
      text: `[Page 1]\n${pdf}\n\n[Page 3]\nFinal selected PDF page`,
      outcome: { format: 'pdf', status: 'ready', pages: 3, textPages: 2 },
      extraction: { format: 'pdf', pages: 3, text_pages: 2 },
    },
    {
      format: 'docx', path: `${directory}/source.docx`, marker: word,
      bytes: docxFixture({ paragraphs: [word, 'Second selected Word paragraph.'] }),
      text: `${word}\nSecond selected Word paragraph.`,
      outcome: { format: 'docx', status: 'ready' }, extraction: { format: 'docx' },
    },
    {
      format: 'xlsx', path: `${directory}/source.xlsx`, marker: workbook,
      bytes: xlsxFixture({ sheets: [
        { name: 'Visible Data', rows: [[workbook, { formula: '40+2', cached: 42 }, 'selected-hidden-column'], ['selected-hidden-row']], hiddenRows: [2], hiddenColumns: ['C'] },
        { name: 'Hidden Sheet', hidden: true, rows: [['selected-hidden-sheet']] },
      ] }),
      text: `Sheet: "Visible Data"\nA1: "${workbook}"\nB1: 42 [cached formula value]\n`,
      outcome: { format: 'xlsx', status: 'ready' }, extraction: { format: 'xlsx' },
    },
    {
      format: 'pptx', path: `${directory}/source.pptx`, marker: slide,
      bytes: pptxFixture({ slides: [{ shapes: [slide], table: [['A', 'B']], notes: ['selected-hidden-speaker-note'] }] }),
      text: `Slide 1: ${slide}\nA\tB`,
      outcome: { format: 'pptx', status: 'ready' }, extraction: { format: 'pptx' },
    },
  ]
  if (scannedPdfBytes) fixtures.push({
    format: 'pdf', path: `${directory}/scanned-source.pdf`, marker: 'Scan Alpha 427',
    bytes: scannedPdfBytes,
    text: '[Page 1]\nScan Alpha 427\n\n[Page 2]\nScan Bravo 813',
    outcome: { format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' },
    extraction: { format: 'pdf', pages: 2, text_pages: 2, method: 'ocr' },
    ocr: true,
  })
  return fixtures
}

async function workspace(page, sessionId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error('Could not read the selected-document acceptance workspace.')
    return (await response.json()).workspace
  }, sessionId)
}

async function authoredDocuments(page) {
  return page.evaluate(async () => {
    const artifactsResponse = await fetch('/api/v1/artifacts')
    const contentsResponse = await fetch('/api/v1/artifact-content')
    if (!artifactsResponse.ok || !contentsResponse.ok) throw new Error('Could not read authored-document acceptance state.')
    return { artifacts: await artifactsResponse.json(), bodies: await contentsResponse.json() }
  })
}

async function adoptStructuredPreview({ page, browser, item, source, root, endpoint, sessionId }) {
  const kind = item.format === 'xlsx' ? 'sheet' : item.format === 'pptx' ? 'slide' : null
  if (!kind) return null
  const name = `${source}-captured-${kind === 'sheet' ? 'workbook.xlsx' : 'deck.slides'}`
  const artifactBaseline = await authoredDocuments(page)
  const workspaceBaseline = await workspace(page, sessionId)
  const modelRequestCount = endpoint.requests.length
  await expect(browser.getByRole('button', { name: `Review as new ${kind === 'sheet' ? 'sheet' : 'slides'}`, exact: true })).toBeVisible()
  await browser.getByRole('button', { name: `Review as new ${kind === 'sheet' ? 'sheet' : 'slides'}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog.locator('[data-local-structured-draft]')).toContainText(`Review the captured structure from ${item.path}.`)
  await expect(dialog.getByRole('combobox', { name: 'Format', exact: true })).toHaveValue(kind)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('')
  if (kind === 'sheet') {
    const importReview = dialog.getByRole('region', { name: 'Imported sheet', exact: true })
    await expect(dialog.getByLabel('Worksheet', { exact: true })).toHaveValue('1')
    await expect(importReview.getByRole('alert')).toContainText('at least one data row')
    await expect(dialog.getByRole('button', { name: 'Use imported sheet', exact: true })).toBeDisabled()
    const headers = dialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
    await expect(headers).toHaveAttribute('aria-checked', 'true')
    await headers.click()
    await expect(headers).toHaveAttribute('aria-checked', 'false')
    await expect(importReview).toContainText('Visible Data')
    await expect(dialog.getByRole('button', { name: 'Use imported sheet', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Use imported sheet', exact: true }).click()
    await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue(item.marker)
    await expect(dialog.getByLabel('Sheet row 1 value 2', { exact: true })).toHaveValue('42')
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Edited from captured workbook')
  } else {
    const importReview = dialog.getByRole('region', { name: 'Imported slides', exact: true })
    await expect(importReview).toContainText(item.marker)
    await expect(importReview).toContainText('A\tB')
    await dialog.getByRole('button', { name: 'Use imported slides', exact: true }).click()
    await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(item.marker)
    await expect(dialog.getByLabel('Slide 1 bullet 1', { exact: true })).toHaveValue('A\tB')
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByLabel('Slide 1 bullet 1', { exact: true }).fill('Edited from captured deck')
  }
  await expect(dialog.getByRole('button', { name: `Create ${kind === 'sheet' ? 'sheet' : 'slides'}`, exact: true })).toBeEnabled()
  assert.deepEqual(await authoredDocuments(page), artifactBaseline,
    'opening structured review, choosing Use and editing do not autosave an artifact')
  assert.equal(endpoint.requests.length, modelRequestCount, 'structured review and edits make no model call')
  assert.equal(await readFile(join(root, item.path), 'utf8'), 'selected-source-replaced-after-preview',
    'the source path contains only replacement bytes while the structured preview is adopted')
  await dialog.getByRole('button', { name: `Create ${kind === 'sheet' ? 'sheet' : 'slides'}`, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
  const saved = await authoredDocuments(page)
  const artifact = saved.artifacts.find(candidate => candidate.name === name)
  assert.ok(artifact, 'ordinary Create saves the reviewed structured draft')
  assert.equal(artifact.kind, kind)
  const body = kind === 'sheet'
    ? { type: 'sheet', columns: ['Column A', 'Column B'], rows: [['Edited from captured workbook', '42']], revision: 0 }
    : { type: 'slides', slides: [{ title: item.marker, bullets: ['Edited from captured deck'] }], revision: 0 }
  assert.deepEqual(saved.bodies[artifact.id], body, 'the saved body is the exact edited structured projection')
  assert.deepEqual(await workspace(page, sessionId), workspaceBaseline, 'artifact creation does not alter conversation state')
  assert.equal(endpoint.requests.length, modelRequestCount, 'ordinary Create is local and never dispatches a model call')
  return { id: artifact.id, name, kind, body }
}

function assertSaved(saved, fixtures, root) {
  assert.equal(saved.attachments.length, fixtures.length, 'only separately attached reviewed documents are saved')
  assert.equal(new Set(saved.attachments.map(item => item.id)).size, fixtures.length, 'each reviewed document has a distinct stable identity')
  assert.deepEqual(saved.attachments.map(({ id, ...item }) => {
    assert.equal(typeof id, 'string')
    assert.ok(id.length > 0)
    return item
  }), fixtures.map(item => ({
    label: item.path, kind: 'file', source: SOURCE, previewText: item.text, documentImport: item.outcome,
  })), 'saved copies contain exactly reviewed text and extraction metadata, never source archives or handles')
  assert.equal(JSON.stringify(saved).includes(root), false, 'native absolute paths never enter product state')
}

async function expectUncovered(target) {
  // Full intersection alone cannot detect an overlapping sidebar during its
  // responsive collapse. Wait for actual paint ownership, not a fixed delay.
  await expect.poll(() => target.evaluate(element => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
    if (width < 2 || height < 2) return false
    const midX = left + width / 2, midY = top + height / 2
    return [[midX, midY], [left + 1, midY], [right - 1, midY], [midX, top + 1], [midX, bottom - 1]]
      .every(([x, y]) => {
        const hit = element.ownerDocument.elementFromPoint(x, y)
        return hit !== null && element.contains(hit)
      })
  }), { message: 'Document review must be uncovered before capture' }).toBe(true)
}

async function sendSaved(page, endpoint, expectedFiles, marker, previousReplies) {
  const replies = page.locator('[data-turn]').filter({ hasText: marker })
  await expect(replies).toHaveCount(previousReplies, { timeout: TIMEOUT_MS })
  const requestCount = endpoint.requests.length
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  // Enter via a hit-tested action after picker/viewport transitions, not a
  // synthetic fill into the still-covered outgoing layout.
  await composer.click()
  const instruction = `Read only the ${expectedFiles.length} saved document copies.`
  await composer.fill(instruction)
  await expect(composer).toHaveValue(instruction)
  await composer.press('Enter')
  await expect(replies).toHaveCount(previousReplies + 1, { timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
  assert.equal(endpoint.requests.length, requestCount + 1, 'one explicit Send makes one model request')
  assert.deepEqual(endpoint.documents.at(-1)?.attached_files, expectedFiles, 'model input retains exact reviewed text and format-specific extraction metadata')
  assert.equal(JSON.stringify(endpoint.requests.at(-1)).includes('selected-hidden-'), false)
  assert.equal(JSON.stringify(endpoint.requests.at(-1)).includes('selected-source-replaced-after-preview'), false)
}

/** Only generated source files and the caller's existing chooser answer are
 * fixtures. Native selection admission, real IPC, emitted renderer workers,
 * saved-copy state, SQLite and model transport are unmodified packaged code. */
export async function smokeLocalDocumentBrowse({ run, root, source, name, providerId, endpoint, prepareFiles }) {
  const directory = sourceDirectoryName(source)
  const listAction = source === 'folder' ? 'List folder paths' : source === 'git' ? 'List tracked paths' : 'List untracked paths'
  const listLabel = source === 'folder' ? 'Folder paths' : source === 'git' ? 'Tracked repository paths' : 'Untracked repository paths'
  const listKind = source === 'folder' ? 'File' : source === 'git' ? 'Tracked file' : 'Untracked file'
  const scannedPdfBytes = process.platform === 'darwin' ? await pdfOcrFixture({ mode: 'scanned' }) : undefined
  const fixtures = localDocumentBrowseFixtures(source, scannedPdfBytes)
  const sourceDirectory = join(root, directory)
  await mkdir(sourceDirectory)
  for (const item of fixtures) await writeFile(join(root, item.path), item.bytes, { mode: 0o600 })
  const verifySourceMetadata = await prepareFiles?.(fixtures.map(item => item.path))
  const { page, origin } = run
  const originalViewport = page.viewportSize()
  const session = await page.evaluate(async id => {
    const response = await fetch('/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: id }),
    })
    if (!response.ok) throw new Error('Could not create the selected-document acceptance conversation.')
    return response.json()
  }, providerId)
  let before = await workspace(page, session.id)
  assert.equal(before.attachments.length, 0, 'selected-document conversation starts with no attachments')
  const requestCount = endpoint.requests.length
  const reopenSourceBrowser = async () => {
    await page.goto(`${origin}/s/${encodeURIComponent(session.id)}`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const nextPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await nextPicker.getByRole('button', { name: source === 'folder' ? /^Folder/ : /^Repository/ }).click()
    if (source === 'folder') await nextPicker.getByRole('button', { name: 'This computer', exact: true }).click()
    await nextPicker.getByRole('button', { name: `Browse files in ${name}`, exact: true }).click()
    const nextBrowser = nextPicker.locator(`[data-local-${source}-browser]`)
    if (source === 'git-untracked') {
      const intake = nextPicker.locator('[data-local-git-untracked-intake]')
      const consent = intake.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
      // Consent can outlive a picker opening. Establish and observe an explicit
      // off/on boundary instead of treating a new conversation as fresh consent.
      await expect(consent).toHaveAttribute('aria-checked', /^(true|false)$/)
      if (await consent.getAttribute('aria-checked') === 'true') await consent.click()
      await expect(consent).toHaveAttribute('aria-checked', 'false')
      await expect(nextBrowser).toHaveCount(0)
      await consent.click()
      await expect(consent).toHaveAttribute('aria-checked', 'true')
      await expect(intake).toContainText('secrets')
    }
    await expect(nextBrowser.locator(`[data-local-${source}-browser-listing]`)).toHaveCount(0)
    await expect(nextBrowser.locator(`[data-local-${source}-file-preview]`)).toHaveCount(0)
    await nextBrowser.getByRole('button', { name: listAction, exact: true }).click()
    await expect(nextBrowser.getByRole('list', { name: listLabel, exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(nextBrowser.locator(`[data-local-${source}-file-preview]`)).toHaveCount(0)
    for (const fixture of fixtures) await expect(nextBrowser).not.toContainText(fixture.marker)
    assert.deepEqual(await workspace(page, session.id), before, 'listing source metadata does not persist documents')
    assert.equal(endpoint.requests.length, requestCount, 'consent and path listing do not call a model')
    await verifySourceMetadata?.()
    return { picker: nextPicker, browser: nextBrowser }
  }
  let { picker, browser } = await reopenSourceBrowser()
  let createdDocument = null
  const createdStructured = []
  let pickerAdded = 0
  const evidenceRoot = await mkdtemp(join(tmpdir(), `agent-commons-${source}-document-browse-`))
  for (const [index, item] of fixtures.entries()) {
    const evidenceKey = item.ocr ? 'pdf-ocr' : item.format
    await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(item.path)
    await browser.getByRole('button', { name: `${item.path} ${listKind}`, exact: true }).click()
    const preview = browser.getByRole('region', { name: `Preview of ${item.path}`, exact: true })
    const disclosure = browser.locator(`[data-local-document-preview="${item.format}"]`)
    if (item.ocr) {
      await expect(disclosure).toHaveText('No embedded PDF text was found. Recognize scanned text on this Mac, then review it below.')
      await expect(preview).toHaveCount(0, 'ordinary PDF extraction produces no preview text before explicit OCR')
      await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0,
        'a PDF with no embedded text cannot be attached before recognition')
      assert.deepEqual(await workspace(page, session.id), before,
        'ordinary PDF text extraction leaves the prior saved copies untouched')
      assert.equal(before.attachments.length, index, 'the current PDF has no saved copy before explicit OCR')
      assert.equal(before.attachments.some(item => item.documentImport?.method === 'ocr'), false,
        'OCR metadata exists only after explicit recognition and Attach')
      assert.equal(endpoint.requests.length, requestCount, 'ordinary scanned-PDF preview never calls the model')
      // Replacing the selected source before recognition proves OCR receives
      // the captured PDF bytes rather than reopening the path.
      await writeFile(join(root, item.path), 'selected-source-replaced-after-preview')
      await browser.getByRole('button', { name: 'Recognize scanned text', exact: true }).click()
      await expect(preview).toHaveText(item.text, { timeout: TIMEOUT_MS })
    } else {
      await expect(preview).toHaveText(item.text, { timeout: TIMEOUT_MS })
    }
    assert.equal(await preview.textContent(), item.text, 'worker/OCR result is displayed whole and without whitespace normalization')
    await expect(disclosure).toHaveText(documentImportCopy(item.outcome))
    await expect(browser).toContainText(`${item.bytes.length.toLocaleString()} source bytes`)
    await expect(browser).toContainText('Original document bytes are not saved.')
    assert.deepEqual(await workspace(page, session.id), before, 'previewing through a renderer worker does not attach the document')
    assert.equal(endpoint.requests.length, requestCount, 'listing and preview never dispatch a model call')
    await verifySourceMetadata?.()
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height })
      // The anchored shell updates this inner scrollport after a resize.
      // Center against its settled bounds, not the previous viewport's height.
      await settledOpaquePaint(picker.locator('[data-fs-picker-body]'))
      // Nearest-edge scrolling can leave a fractional line clipped by the
      // short scrollport. Center disclosures just like their text below.
      await disclosure.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await settledOpaquePaint(disclosure)
      try { await expect(disclosure).toBeInViewport({ ratio: 1 }) }
      catch (error) {
        await page.screenshot({ path: join(evidenceRoot, `${evidenceKey}-disclosure-failed-${width}x${height}.png`) })
        console.error('[desktop-local-document-browse-smoke] disclosure containment', JSON.stringify({ source, format: item.format, width, height, evidenceRoot,
          geometry: await disclosure.evaluate(element => {
            const result = []
            for (let node = element; node; node = node.parentElement) {
              const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
              result.push({ tag: node.tagName, role: node.getAttribute('role'), rect: rect.toJSON(),
                overflowX: style.overflowX, overflowY: style.overflowY, clientHeight: node.clientHeight,
                scrollHeight: node.scrollHeight, scrollTop: node.scrollTop })
            }
            return result
          }),
        }))
        throw error
      }
      await expect(picker.getByRole('button', { name: 'Done', exact: true })).toBeInViewport({ ratio: 1 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expectUncovered(disclosure)
      await page.screenshot({ path: join(evidenceRoot, `${evidenceKey}-disclosure-${width}x${height}.png`) })
      // Chromium's nearest-edge scroll can leave a subpixel of the border
      // behind this short scrollport. Center the review target, then require
      // full containment; do not reduce the ratio or the visible-text claim.
      await preview.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await settledOpaquePaint(preview)
      await expectUncovered(preview)
      await page.screenshot({ path: join(evidenceRoot, `${evidenceKey}-text-${width}x${height}.png`) })
      try { await expect(preview).toBeInViewport({ ratio: 1 }) }
      catch (error) {
        console.error('[desktop-local-document-browse-smoke] preview containment', JSON.stringify({ source, format: item.format, width, height, evidenceRoot,
          geometry: await preview.evaluate(element => {
            const result = []
            for (let node = element; node; node = node.parentElement) {
              const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
              result.push({ tag: node.tagName, role: node.getAttribute('role'), rect: rect.toJSON(),
                overflowX: style.overflowX, overflowY: style.overflowY, clientHeight: node.clientHeight,
                scrollHeight: node.scrollHeight, scrollTop: node.scrollTop })
            }
            return result
          }),
        }))
        throw error
      }
      assert.equal(await preview.textContent(), item.text)
    }
    // Deliberately replace each generated original before Attach (and before
    // OCR above). Attach saves the reviewed text without another source read.
    if (!item.ocr) await writeFile(join(root, item.path), 'selected-source-replaced-after-preview')
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect(picker).toContainText(`${++pickerAdded} added`, { timeout: TIMEOUT_MS })
    await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    before = await workspace(page, session.id)
    assertSaved(before, fixtures.slice(0, index + 1), root)
    assert.equal(endpoint.requests.length, requestCount, 'Attach itself never dispatches a model call')
    await verifySourceMetadata?.()
    if (item.format === 'xlsx' || item.format === 'pptx') {
      const structured = await adoptStructuredPreview({ page, browser, item, source, root, endpoint, sessionId: session.id })
      if (structured) createdStructured.push(structured)
      const reopened = await reopenSourceBrowser()
      picker = reopened.picker
      browser = reopened.browser
      // The picker reports additions during this opening, not the conversation's
      // durable attachment total (assertSaved above still checks that exact set).
      pickerAdded = 0
    }
  }

  const ocrFixture = fixtures.at(-1)
  if (ocrFixture?.ocr) {
    const preview = browser.getByRole('region', { name: `Preview of ${ocrFixture.path}`, exact: true })
    const artifactBaseline = await authoredDocuments(page)
    const modelRequestCount = endpoint.requests.length
    const openDraft = async () => {
      await browser.getByRole('button', { name: 'Use text in new document', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('scanned-source.md')
      await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(ocrFixture.text)
      const disclosure = dialog.locator('[data-local-document-draft]')
      await expect(disclosure).toContainText(`Started from reviewed text in ${ocrFixture.path}.`)
      await expect(disclosure).toContainText(documentImportCopy(ocrFixture.outcome))
      return { dialog, disclosure }
    }

    const firstDraft = await openDraft()
    await firstDraft.dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(firstDraft.dialog).toHaveCount(0)
    await expect(picker).toBeVisible()
    await expect(preview).toHaveText(ocrFixture.text)
    assert.deepEqual(await authoredDocuments(page), artifactBaseline, 'Cancel leaves the connected-source picker and saved artifacts unchanged')
    assert.equal(endpoint.requests.length, modelRequestCount, 'opening and cancelling an adopted text draft does not call the model')

    const adopted = await openDraft()
    const name = `${source}-connected-scan.md`
    const editedText = `${ocrFixture.text}\n\nCreated from reviewed connected preview.`
    const expectedParagraphs = [
      '[Page 1] Scan Alpha 427',
      '[Page 2] Scan Bravo 813',
      'Created from reviewed connected preview.',
    ]
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height })
      await settledOpaquePaint(adopted.dialog)
      const panel = adopted.dialog.locator('[data-bounded-dialog="resource-form"]')
      const footer = panel.locator(':scope > div').nth(2)
      await expect(panel).toBeInViewport({ ratio: 1 })
      await expect(footer).toBeInViewport({ ratio: 1 })
      await expectUncovered(panel)
      await expectUncovered(footer)
      await expect(adopted.dialog.getByLabel('Name', { exact: true })).toHaveValue('scanned-source.md')
      await expect(adopted.dialog.getByLabel('Content', { exact: true })).toHaveValue(ocrFixture.text)
      await expect(adopted.disclosure).toContainText(documentImportCopy(ocrFixture.outcome))
      await page.screenshot({ path: join(evidenceRoot, `pdf-ocr-new-document-${width}x${height}.png`) })
    }
    await adopted.dialog.getByLabel('Name', { exact: true }).fill(name)
    await adopted.dialog.getByLabel('Content', { exact: true }).fill(editedText)
    await expect(adopted.dialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()
    assert.deepEqual(await authoredDocuments(page), artifactBaseline, 'adoption and editing remain an unsaved local draft')
    assert.equal(endpoint.requests.length, modelRequestCount, 'reviewing and editing a new-document draft never calls the model')
    await adopted.dialog.getByRole('button', { name: 'Create document', exact: true }).click()
    await expect(adopted.dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
    const savedDocuments = await authoredDocuments(page)
    const artifact = savedDocuments.artifacts.find(item => item.name === name)
    assert.ok(artifact, 'Create document writes the reviewed connected-source draft')
    assert.equal(artifact.kind, 'doc')
    const expectedBody = {
      type: 'doc', title: name.slice(0, -3),
      blocks: expectedParagraphs.map((p, index) => ({ id: docBlockId(artifact.id, 0, index), p })), revision: 0,
    }
    assert.deepEqual(savedDocuments.bodies[artifact.id], expectedBody,
      'the canonical Document contains exact edited page text and stable block identities')
    assert.equal(JSON.stringify(savedDocuments.bodies[artifact.id]).includes('%PDF-'), false,
      'the saved Document contains no original PDF bytes')
    assert.deepEqual(await workspace(page, session.id), before,
      'creating a private Document does not change the conversation attachment snapshot')
    assert.equal(endpoint.requests.length, modelRequestCount, 'creating the authored Document does not call the model')
    createdDocument = { id: artifact.id, name, body: expectedBody }
    await page.goto(`${origin}/s/${encodeURIComponent(session.id)}`)
    await expect(picker).toHaveCount(0)
  }

  if (!createdDocument) {
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
  const expectedFiles = fixtures.map(item => ({ name: item.path, status: 'ready', text: item.text, extraction: item.extraction }))
  await sendSaved(page, endpoint, expectedFiles, fixtures[0].marker, 0)
  await verifySourceMetadata?.()
  console.log(`[desktop-local-document-browse-smoke] ${source}: ${fixtures.length} real native document reads + packaged workers/OCR + exact saved/model metadata + five-viewport evidence: ${evidenceRoot}`)
  return { sessionId: session.id, saved: await workspace(page, session.id), fixtures: fixtures.map(({ bytes, ...item }) => item), expectedFiles, source, sourceDirectory, root, createdDocument, createdStructured }
}

export async function verifyLocalDocumentBrowseRelaunch(run, receipt, endpoint) {
  const expectedFixtureCount = process.platform === 'darwin' ? 5 : 4
  assert.equal(receipt?.fixtures?.length, expectedFixtureCount, 'all platform-supported document fixtures completed before relaunch')
  assert.equal(receipt?.expectedFiles?.length, expectedFixtureCount, 'the model projection includes every document fixture')
  if (process.platform === 'darwin') {
    assert.ok(receipt.createdDocument, 'the scanned-PDF review created an authored Document before relaunch')
    assert.equal(receipt.createdDocument.name, `${receipt.source}-connected-scan.md`)
  }
  if (process.platform === 'darwin') {
    const ocr = receipt.fixtures.at(-1)
    assert.equal(ocr?.path, `${sourceDirectoryName(receipt.source)}/scanned-source.pdf`)
    assert.equal(ocr?.marker, 'Scan Alpha 427')
    assert.deepEqual(ocr?.outcome, { format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' })
    assert.deepEqual(receipt.expectedFiles.at(-1)?.extraction, { format: 'pdf', pages: 2, text_pages: 2, method: 'ocr' })
  }
  await assert.rejects(stat(receipt.sourceDirectory), { code: 'ENOENT' }, 'the original connected-source document directory is absent')
  assert.deepEqual(await workspace(run.page, receipt.sessionId), receipt.saved, 'exact document text, import outcomes and attachment identities survive a real packaged relaunch')
  assertSaved(receipt.saved, receipt.fixtures, receipt.root)
  if (receipt.createdDocument) {
    const authored = await authoredDocuments(run.page)
    const artifact = authored.artifacts.find(item => item.id === receipt.createdDocument.id)
    assert.equal(artifact?.name, receipt.createdDocument.name, 'the exact created Document identity survives relaunch without the PDF source')
    assert.equal(artifact?.kind, 'doc')
    assert.deepEqual(authored.bodies[receipt.createdDocument.id], receipt.createdDocument.body,
      'the exact canonical edited Document body survives full relaunch')
  }
  assert.equal(receipt.createdStructured?.length, 2, 'both captured Office sources produced structured authored drafts before relaunch')
  for (const savedDraft of receipt.createdStructured) {
    const authored = await authoredDocuments(run.page)
    const artifact = authored.artifacts.find(item => item.id === savedDraft.id)
    assert.equal(artifact?.name, savedDraft.name, `the ${savedDraft.kind} identity survives relaunch without its source`)
    assert.equal(artifact?.kind, savedDraft.kind)
    assert.deepEqual(authored.bodies[savedDraft.id], savedDraft.body,
      `the exact canonical edited ${savedDraft.kind} body survives source-absent relaunch`)
  }
  const requestCount = endpoint.requests.length
  const route = `${run.origin}/s/${encodeURIComponent(receipt.sessionId)}`
  for (const item of receipt.fixtures) {
    await run.page.goto(route)
    await run.page.getByTitle(`Files (${receipt.fixtures.length})`, { exact: true }).click()
    await run.page.getByRole('menu', { name: 'Files', exact: true }).getByRole('button', { name: item.path, exact: true }).click()
    const preview = run.page.getByRole('region', { name: `Preview ${item.path}`, exact: true })
    await expect(preview.locator('pre')).toHaveText(item.text)
    assert.equal(await preview.locator('pre').textContent(), item.text)
    await expect(preview.locator('[data-document-import="ready"]')).toHaveText(documentImportCopy(item.outcome))
    assert.equal(endpoint.requests.length, requestCount, 'opening saved previews after relaunch does not call a model')
  }
  await run.page.goto(route)
  await sendSaved(run.page, endpoint, receipt.expectedFiles, receipt.fixtures[0].marker, 1)
  assert.deepEqual(await workspace(run.page, receipt.sessionId), receipt.saved, 'saved-only sending without original files cannot rewrite attachment state')
  console.log(`[desktop-local-document-browse-smoke] all ${expectedFixtureCount} exact saved previews, fidelity metadata and model input survive full relaunch without their source documents`)
}
