import assert from 'node:assert/strict'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { documentImportCopy } from '../contract/documentImport.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'

const TIMEOUT_MS = 30_000
const VIEWPORTS = [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]
const DIRECTORY = 'browse-documents'
const SOURCE = { id: 'ui-host', kind: 'ui-host', label: 'This computer' }

export function localDocumentBrowseFixtures(source) {
  const marker = `native-${source}-selected`
  const pdf = `${marker}-pdf-body`
  const word = `${marker}-word-body · café 世界 😀`
  const workbook = `${marker}-workbook-body`
  const slide = `${marker}-slide-body`
  return [
    {
      format: 'pdf', path: `${DIRECTORY}/source.pdf`, marker: pdf,
      bytes: pdfFixture({ pages: [pdf, null, 'Final selected PDF page'], compress: true }),
      text: `[Page 1]\n${pdf}\n\n[Page 3]\nFinal selected PDF page`,
      outcome: { format: 'pdf', status: 'ready', pages: 3, textPages: 2 },
      extraction: { format: 'pdf', pages: 3, text_pages: 2 },
    },
    {
      format: 'docx', path: `${DIRECTORY}/source.docx`, marker: word,
      bytes: docxFixture({ paragraphs: [word, 'Second selected Word paragraph.'] }),
      text: `${word}\nSecond selected Word paragraph.`,
      outcome: { format: 'docx', status: 'ready' }, extraction: { format: 'docx' },
    },
    {
      format: 'xlsx', path: `${DIRECTORY}/source.xlsx`, marker: workbook,
      bytes: xlsxFixture({ sheets: [
        { name: 'Visible Data', rows: [[workbook, { formula: '40+2', cached: 42 }, 'selected-hidden-column'], ['selected-hidden-row']], hiddenRows: [2], hiddenColumns: ['C'] },
        { name: 'Hidden Sheet', hidden: true, rows: [['selected-hidden-sheet']] },
      ] }),
      text: `Sheet: "Visible Data"\nA1: "${workbook}"\nB1: 42 [cached formula value]\n`,
      outcome: { format: 'xlsx', status: 'ready' }, extraction: { format: 'xlsx' },
    },
    {
      format: 'pptx', path: `${DIRECTORY}/source.pptx`, marker: slide,
      bytes: pptxFixture({ slides: [{ shapes: [slide], table: [['A', 'B']], notes: ['selected-hidden-speaker-note'] }] }),
      text: `Slide 1: ${slide}\nA\tB`,
      outcome: { format: 'pptx', status: 'ready' }, extraction: { format: 'pptx' },
    },
  ]
}

async function workspace(page, sessionId) {
  return page.evaluate(async id => {
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error('Could not read the selected-document acceptance workspace.')
    return (await response.json()).workspace
  }, sessionId)
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
  await composer.fill('Read only the four saved document copies.')
  await expect(composer).toHaveValue('Read only the four saved document copies.')
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
  assert.ok(source === 'folder' || source === 'git')
  const fixtures = localDocumentBrowseFixtures(source)
  const sourceDirectory = join(root, DIRECTORY)
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
  await page.goto(`${origin}/s/${encodeURIComponent(session.id)}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: source === 'folder' ? /^Folder/ : /^Repository/ }).click()
  if (source === 'folder') await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  await picker.getByRole('button', { name: `Browse files in ${name}`, exact: true }).click()
  const browser = picker.locator(`[data-local-${source}-browser]`)
  await expect(browser.locator(`[data-local-${source}-browser-listing]`)).toHaveCount(0)
  await expect(browser.locator(`[data-local-${source}-file-preview]`)).toHaveCount(0)
  let before = await workspace(page, session.id)
  assert.equal(before.attachments.length, 0, 'selected-document conversation starts with no attachments')
  const requestCount = endpoint.requests.length
  await browser.getByRole('button', { name: source === 'folder' ? 'List folder paths' : 'List tracked paths', exact: true }).click()
  await expect(browser.getByRole('list', { name: source === 'folder' ? 'Folder paths' : 'Tracked repository paths', exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(browser.locator(`[data-local-${source}-file-preview]`)).toHaveCount(0)
  assert.deepEqual(await workspace(page, session.id), before, 'listing source metadata does not persist documents')
  await verifySourceMetadata?.()
  const evidenceRoot = await mkdtemp(join(tmpdir(), `agent-commons-${source}-document-browse-`))
  for (const [index, item] of fixtures.entries()) {
    await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(item.path)
    await browser.getByRole('button', { name: `${item.path} ${source === 'folder' ? 'File' : 'Tracked file'}`, exact: true }).click()
    const preview = browser.getByRole('region', { name: `Preview of ${item.path}`, exact: true })
    await expect(preview).toHaveText(item.text, { timeout: TIMEOUT_MS })
    assert.equal(await preview.textContent(), item.text, 'worker extraction is displayed whole and without whitespace normalization')
    const disclosure = browser.locator(`[data-local-document-preview="${item.format}"]`)
    await expect(disclosure).toHaveText(documentImportCopy(item.outcome))
    await expect(browser).toContainText(`${item.bytes.length.toLocaleString()} source bytes`)
    await expect(browser).toContainText('Original document bytes are not saved.')
    assert.deepEqual(await workspace(page, session.id), before, 'previewing through a renderer worker does not attach the document')
    assert.equal(endpoint.requests.length, requestCount, 'listing and preview never dispatch a model call')
    await verifySourceMetadata?.()
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height })
      // Nearest-edge scrolling can leave a fractional line clipped by the
      // short scrollport. Center disclosures just like their text below.
      await disclosure.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await expect(disclosure).toBeInViewport({ ratio: 1 })
      await expect(picker.getByRole('button', { name: 'Done', exact: true })).toBeInViewport({ ratio: 1 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expectUncovered(disclosure)
      await page.screenshot({ path: join(evidenceRoot, `${item.format}-disclosure-${width}x${height}.png`) })
      // Chromium's nearest-edge scroll can leave a subpixel of the border
      // behind this short scrollport. Center the review target, then require
      // full containment; do not reduce the ratio or the visible-text claim.
      await preview.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await expectUncovered(preview)
      await page.screenshot({ path: join(evidenceRoot, `${item.format}-text-${width}x${height}.png`) })
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
    // Deliberately replace the generated original after preview. Attach must
    // save the reviewed worker output without another native/worker read.
    await writeFile(join(root, item.path), 'selected-source-replaced-after-preview')
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect(picker).toContainText(`${index + 1} added`, { timeout: TIMEOUT_MS })
    await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    before = await workspace(page, session.id)
    assertSaved(before, fixtures.slice(0, index + 1), root)
    assert.equal(endpoint.requests.length, requestCount, 'Attach itself never dispatches a model call')
    await verifySourceMetadata?.()
  }
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  if (originalViewport) await page.setViewportSize(originalViewport)
  const expectedFiles = fixtures.map(item => ({ name: item.path, status: 'ready', text: item.text, extraction: item.extraction }))
  await sendSaved(page, endpoint, expectedFiles, fixtures[0].marker, 0)
  console.log(`[desktop-local-document-browse-smoke] ${source}: four real native document reads + packaged workers + exact saved/model metadata + five-viewport evidence: ${evidenceRoot}`)
  return { sessionId: session.id, saved: await workspace(page, session.id), fixtures: fixtures.map(({ bytes, ...item }) => item), expectedFiles, sourceDirectory, root }
}

export async function verifyLocalDocumentBrowseRelaunch(run, receipt, endpoint) {
  assert.equal(receipt?.fixtures?.length, 4, 'all four document formats completed before relaunch')
  await assert.rejects(stat(receipt.sourceDirectory), { code: 'ENOENT' }, 'the original connected-source document directory is absent')
  assert.deepEqual(await workspace(run.page, receipt.sessionId), receipt.saved, 'exact document text, import outcomes and attachment identities survive a real packaged relaunch')
  assertSaved(receipt.saved, receipt.fixtures, receipt.root)
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
  console.log('[desktop-local-document-browse-smoke] all four exact saved previews, fidelity metadata and model input survive full relaunch without their source documents')
}
