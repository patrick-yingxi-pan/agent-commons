/** Browser proof for the canonical authored-document Word export door. */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import type { ArtifactExport, ArtifactItem, Grant } from '../contract/index.ts'
import { extractDocx } from '../src/lib/docxExtraction.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const REVIEW_DIR = '.data/artifact-docx-export-review'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

mkdirSync(REVIEW_DIR, { recursive: true })

async function createDocument(page: Page, name: string, body: string) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body } } },
    headers: { 'Idempotency-Key': `artifact-docx-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function grantDocument(page: Page, id: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Grant
}

async function descriptor(page: Page, id: string): Promise<ArtifactExport> {
  const response = await page.request.get(`${API}/artifacts/${id}/export?format=docx`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as ArtifactExport
}

async function downloadWord(page: Page, expected: ArtifactExport) {
  const action = page.getByRole('button', { name: 'Download Word', exact: true })
  await expect(action).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await action.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(expected.filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = await readFile(path!)
  expect(bytes.equals(Buffer.from(expected.content, 'base64'))).toBe(true)
  const extracted = await extractDocx(new Uint8Array(bytes))
  expect(extracted.documentImport).toEqual({ format: 'docx', status: 'ready' })
  return extracted.text
}

async function expectExportActionsContained(page: Page, detail: ReturnType<Page['locator']>) {
  const markdown = detail.getByRole('button', { name: 'Download Markdown', exact: true })
  const word = detail.getByRole('button', { name: 'Download Word', exact: true })
  // The existing section cluster reveals on focus/hover at desktop widths.
  // Focus a real action so screenshots and contrast checks see the choices.
  await markdown.focus()
  await expect(markdown).toBeVisible()
  await expect(word).toBeVisible()
  await expect(markdown).toHaveText('Markdown')
  await expect(word).toHaveText('Word')
  for (const control of [markdown, word]) {
    const caption = control.locator('span')
    await expect(caption).toBeVisible()
    await expect.poll(() => caption.evaluate((element) => {
      let opacity = 1
      for (let current: Element | null = element; current; current = current.parentElement) opacity *= Number(getComputedStyle(current).opacity)
      return opacity
    })).toBe(1)
    await expect.poll(async () => {
      const [buttonBox, captionBox] = await Promise.all([control.boundingBox(), caption.boundingBox()])
      return Boolean(buttonBox && captionBox && captionBox.width > 0 && captionBox.x >= buttonBox.x && captionBox.x + captionBox.width <= buttonBox.x + buttonBox.width)
    }).toBe(true)
  }
  await expect.poll(async () => {
    const [detailBox, markdownBox, wordBox] = await Promise.all([detail.boundingBox(), markdown.boundingBox(), word.boundingBox()])
    if (!detailBox || !markdownBox || !wordBox) return false
    const inside = (box: NonNullable<typeof markdownBox>) => box.x >= detailBox.x && box.y >= detailBox.y && box.x + box.width <= detailBox.x + detailBox.width && box.y + box.height <= detailBox.y + detailBox.height
    return inside(markdownBox) && inside(wordBox)
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function capture(page: Page, detail: ReturnType<Page['locator']>, role: string, state: string, testName: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expectExportActionsContained(page, detail)
    await assertWcag22Aa(page, `DOCX export ${role} ${state} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `${REVIEW_DIR}/${testName}-${role}-${state}-${viewport.width}x${viewport.height}.png`, fullPage: false })
  }
}

test('owner and granted reader download saved Word bytes, with locks and recovery', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  const stamp = Date.now().toString(36)
  const name = `Word.Export-${stamp}.docx`
  const body = `Current Word paragraph ${stamp}.\n\nA second saved paragraph.`
  let grant: Grant | undefined
  let releaseSave = () => {}
  let releaseRename = () => {}
  let releaseExport = () => {}
  try {
    const artifact = await createDocument(owner.page, name, body)
    grant = await grantDocument(owner.page, artifact.id)
    await reader.page.route(`**${API}/events*`, (route) => route.abort())
    const initial = await descriptor(owner.page, artifact.id)
    expect('encoding' in initial).toBe(true)
    const initialText = await extractDocx(Uint8Array.from(Buffer.from(initial.content, 'base64')))
    expect(initialText.text).toContain(`Current Word paragraph ${stamp}.`)

    for (const [role, page] of [['owner', owner.page], ['reader', reader.page]] as const) {
      await page.goto(`/artifacts/${artifact.id}`)
      const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
      await expect(detail).toBeVisible()
      await capture(page, detail, role, 'ready', testInfo.project.name)
      expect(await downloadWord(page, initial)).toContain(`Current Word paragraph ${stamp}.`)
    }

    const ownerDetail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await ownerDetail.getByRole('button', { name: 'Edit block 2', exact: true }).click()
    const editor = ownerDetail.getByRole('textbox', { name: 'Rewrite block 2', exact: true })
    await editor.fill('Edited current Word paragraph.')
    const ownerMarkdown = ownerDetail.getByRole('button', { name: 'Download Markdown', exact: true })
    const ownerWord = ownerDetail.getByRole('button', { name: 'Download Word', exact: true })
    await expect(ownerMarkdown).toBeDisabled()
    await expect(ownerWord).toBeDisabled()
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    const contentUrl = `**${API}/artifacts/${artifact.id}/content`
    await owner.page.route(contentUrl, async (route) => {
      if (route.request().method() === 'PATCH') await saveGate
      await route.continue()
    })
    await ownerDetail.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(ownerMarkdown).toBeDisabled()
    await expect(ownerWord).toBeDisabled()
    releaseSave()
    await expect(editor).toHaveCount(0)
    await owner.page.unroute(contentUrl)
    await expect(ownerDetail.getByText('Edited current Word paragraph.', { exact: true })).toBeVisible()
    const edited = await descriptor(owner.page, artifact.id)
    expect(edited.revision).toBe(1)
    const editedExtraction = await extractDocx(Uint8Array.from(Buffer.from(edited.content, 'base64')))
    expect(editedExtraction.text).toContain(`Current Word paragraph ${stamp}.`)
    expect(editedExtraction.text).toContain('Edited current Word paragraph.')
    expect(await downloadWord(reader.page, edited)).toContain('Edited current Word paragraph.')

    const rename = ownerDetail.getByRole('button', { name: 'Rename artifact', exact: true })
    await rename.click()
    const nameField = ownerDetail.getByRole('textbox', { name: 'Artifact name', exact: true })
    await nameField.fill(`Renamed Word ${stamp}.docx`)
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve })
    const metadataUrl = `**${API}/artifacts/${artifact.id}`
    await owner.page.route(metadataUrl, async (route) => {
      if (route.request().method() === 'PATCH') await renameGate
      await route.continue()
    })
    await ownerDetail.getByRole('button', { name: 'Save artifact name', exact: true }).click()
    await expect(ownerMarkdown).toBeDisabled()
    await expect(ownerWord).toBeDisabled()
    releaseRename()
    await expect(ownerDetail.getByRole('heading', { name: `Renamed Word ${stamp}.docx`, exact: true })).toBeVisible()
    await owner.page.unroute(metadataUrl)
    const renamed = await descriptor(owner.page, artifact.id)
    expect(renamed.filename).toBe(`Renamed Word ${stamp}.docx`)
    await downloadWord(owner.page, renamed)

    const exportGate = new Promise<void>((resolve) => { releaseExport = resolve })
    let docxReads = 0
    let markdownReads = 0
    const docxUrl = `**${API}/artifacts/${artifact.id}/export?format=docx`
    await owner.page.route(docxUrl, async (route) => { docxReads += 1; await exportGate; await route.continue() })
    const markdownUrl = `**${API}/artifacts/${artifact.id}/export`
    await owner.page.route(markdownUrl, async (route) => { markdownReads += 1; await route.continue() })
    await ownerWord.click()
    await expect.poll(() => docxReads).toBe(1)
    await expect(ownerWord).toBeDisabled()
    await expect(ownerMarkdown).toBeDisabled()
    expect(docxReads).toBe(1)
    expect(markdownReads).toBe(0)
    releaseExport()
    await expect(owner.page.getByText('Word download requested. It contains the latest saved text.', { exact: true })).toBeVisible()
    await owner.page.unroute(docxUrl)
    await owner.page.unroute(markdownUrl)

    let failed = true
    await owner.page.route(docxUrl, async (route) => {
      if (failed) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Temporary export outage' } }) })
        return
      }
      await route.continue()
    })
    await ownerWord.click()
    await expect(owner.page.getByText('Could not download this document. Check your connection and try again.', { exact: true })).toBeVisible()
    await capture(owner.page, ownerDetail, 'owner', 'failure', testInfo.project.name)
    failed = false
    await ownerWord.click()
    await expect(owner.page.getByText('Word download requested. It contains the latest saved text.', { exact: true })).toBeVisible()
    await owner.page.unroute(docxUrl)

    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.getByRole('button', { name: 'Download Word', exact: true })).toHaveCount(0)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()

    expect((await owner.page.request.delete(`${API}/grants/${grant.id}`)).ok()).toBeTruthy()
    const staleReaderWord = reader.page.getByRole('button', { name: 'Download Word', exact: true })
    await expect(staleReaderWord).toBeVisible()
    await staleReaderWord.click()
    await expect(reader.page.getByText('This document is no longer available to this account.', { exact: true })).toBeVisible()
  } finally {
    releaseSave()
    releaseRename()
    releaseExport()
    await owner.page.unrouteAll({ behavior: 'wait' })
    await reader.page.unrouteAll({ behavior: 'wait' })
    await foreign.page.unrouteAll({ behavior: 'wait' })
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
