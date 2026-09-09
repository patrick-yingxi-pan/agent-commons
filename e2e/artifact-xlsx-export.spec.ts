/** Browser proof for the canonical authored-sheet XLSX export door. */
import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import type { ArtifactExport, ArtifactItem, Grant } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createSheet(page: Page, name: string) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: {
      op: {
        kind: 'save-artifact',
        artifact: {
          name, kind: 'sheet', meta: 'Sheet',
          body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Revenue', '00042'], ['Formula text', '=1+1']] },
        },
      },
    },
    headers: { 'Idempotency-Key': `artifact-xlsx-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function grantSheet(page: Page, id: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Grant
}

async function downloadXlsx(page: Page, filename: string, expected: Uint8Array) {
  const action = page.getByRole('button', { name: 'Download XLSX', exact: true })
  await expect(action).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await action.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = await readFile(path!)
  expect(bytes.equals(Buffer.from(expected))).toBe(true)
}

async function workbookXml(bytes: Uint8Array) {
  const zip = new ZipReader(new Uint8ArrayReader(bytes), { checkSignature: true })
  try {
    const entries = await zip.getEntries()
    const shared = entries.find((entry) => entry.filename === 'xl/sharedStrings.xml')
    const sheet = entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(entry.filename))
    expect(shared?.getData).toBeTruthy()
    expect(sheet?.getData).toBeTruthy()
    return {
      shared: await shared!.getData!(new TextWriter()),
      sheet: await sheet!.getData!(new TextWriter()),
    }
  } finally {
    await zip.close()
  }
}

test('owner and granted reader download the current sheet workbook at every viewport', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  const name = `sheet-export-${Date.now().toString(36)}.xlsx`
  try {
    const artifact = await createSheet(owner.page, name)
    const grant = await grantSheet(owner.page, artifact.id)
    // Block the initial stream, not just future reconnects: the retained-page
    // check below intentionally exercises a download after authority changed.
    await reader.page.route(`**${API}/events*`, (route) => route.abort())
    const exportResponse = await owner.page.request.get(`${API}/artifacts/${artifact.id}/export?format=xlsx`)
    expect(exportResponse.ok()).toBeTruthy()
    const exportDescriptor = await exportResponse.json() as ArtifactExport
    expect('encoding' in exportDescriptor).toBe(true)
    const expectedBytes = Buffer.from(exportDescriptor.content, 'base64')
    const workbook = await workbookXml(expectedBytes)
    expect(workbook.shared).toContain('00042')
    expect(workbook.shared).toContain('=1+1')
    expect(workbook.sheet).toContain('t="s"')
    expect(workbook.sheet).not.toContain('<f>')
    for (const [role, page] of [['owner', owner.page], ['reader', reader.page]] as const) {
      await page.goto(`/artifacts/${artifact.id}`)
      const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
      await expect(detail).toBeVisible()
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await settleArtifactPageRail(page)
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true)
        await downloadXlsx(page, name, expectedBytes)
        await page.screenshot({ path: testInfo.outputPath(`xlsx-${role}-${viewport.width}.png`) })
      }
    }
    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.getByRole('button', { name: 'Download XLSX', exact: true })).toHaveCount(0)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()

    let fail = true
    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=xlsx`, async (route) => {
      if (fail) {
        fail = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Temporary export outage' } }) })
        return
      }
      await route.continue()
    })
    await owner.page.goto(`/artifacts/${artifact.id}`)
    const action = owner.page.getByRole('button', { name: 'Download XLSX', exact: true })
    await action.click()
    await expect(owner.page.getByText('Could not download this sheet. Check your connection and try again.')).toBeVisible()
    await action.click()
    await expect(owner.page.getByText('XLSX download requested. Saved values are exported as text.')).toBeVisible()
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=xlsx`)

    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=xlsx`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ artifactId: artifact.id, filename: name, mediaType: 'text/plain', encoding: 'base64', content: 'Tk9UWklQ', revision: 0 }),
      })
    })
    const malformedDownload = owner.page.waitForEvent('download', { timeout: 1_000 }).catch(() => null)
    await action.click()
    expect(await malformedDownload).toBeNull()
    await expect(owner.page.getByText('Could not download this sheet. Check your connection and try again.')).toBeVisible()
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=xlsx`)

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=xlsx`, async (route) => {
      requests += 1
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    })
    const coalescedDownload = owner.page.waitForEvent('download')
    await action.evaluate((button) => { button.click(); button.click() })
    await expect(action).toBeDisabled()
    await expect.poll(() => requests).toBe(1)
    release()
    await coalescedDownload
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=xlsx`)

    expect((await owner.page.request.delete(`${API}/grants/${grant.id}`)).ok()).toBeTruthy()
    const staleAction = reader.page.getByRole('button', { name: 'Download XLSX', exact: true })
    await expect(staleAction).toBeVisible()
    await staleAction.click()
    await expect(reader.page.getByText('This sheet is no longer available to this account.')).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('documents retain Markdown only and slides do not advertise XLSX', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name: `not-xlsx-${stamp}.md`, kind: 'doc', meta: 'Document', body: 'text' } } },
    headers: { 'Idempotency-Key': `artifact-xlsx-negative-${stamp}` },
  })
  expect(response.ok()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const doc = graph.extraArtifacts.find((row) => row.name === `not-xlsx-${stamp}.md`)
  expect(doc).toBeTruthy()
  await page.goto(`/artifacts/${doc!.id}`)
  await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download XLSX', exact: true })).toHaveCount(0)

  const slideResponse = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name: `not-xlsx-${stamp}.slides`, kind: 'slide', meta: 'Slides', body: { type: 'slides', slides: [{ title: 'Summary', bullets: ['Saved values'] }] } } } },
    headers: { 'Idempotency-Key': `artifact-xlsx-slide-negative-${stamp}` },
  })
  expect(slideResponse.ok()).toBeTruthy()
  const slideGraph = await slideResponse.json() as { extraArtifacts: ArtifactItem[] }
  const slide = slideGraph.extraArtifacts.find((row) => row.name === `not-xlsx-${stamp}.slides`)
  expect(slide).toBeTruthy()
  await page.goto(`/artifacts/${slide!.id}`)
  await expect(page.getByRole('button', { name: 'Download XLSX', exact: true })).toHaveCount(0)
})
