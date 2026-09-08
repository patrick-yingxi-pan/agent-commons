/** Browser proof for the canonical authored-document Markdown export door. */
import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import type { ArtifactDocumentExport, ArtifactItem } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

async function createDocument(page: import('@playwright/test').Page, name: string, body?: string) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', ...(body === undefined ? {} : { body }) } } },
    headers: { 'Idempotency-Key': `artifact-export-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function downloadMarkdown(page: import('@playwright/test').Page, expected: ArtifactDocumentExport) {
  const button = page.getByRole('button', { name: 'Download Markdown', exact: true })
  await expect(button).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await button.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(expected.filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(await readFile(path!, 'utf8')).toBe(expected.content)
}

test('owner and granted reader download the current saved Markdown revision', async ({ browser }, testInfo) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const stamp = Date.now().toString(36)
  const name = `download-${stamp}.md`
  const original = 'Export first paragraph.\n\nExport second paragraph.'
  try {
    const artifact = await createDocument(owner.page, name, original)
    const grant = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
    })
    expect(grant.ok()).toBeTruthy()
    // Keep the reader's already-open page stale. The export click must perform
    // a fresh authorized read rather than trusting its retained body/cache.
    await reader.page.route(`**${API}/events*`, (route) => route.abort())

    for (const page of [owner.page, reader.page]) {
      await page.goto(`/artifacts/${artifact.id}`)
      await expect(page.locator(`[data-artifact-page="${artifact.id}"]`)).toBeVisible()
    }
    const initial = await owner.page.request.get(`${API}/artifacts/${artifact.id}/export`)
    expect(initial.ok()).toBeTruthy()
    const initialExport = await initial.json() as ArtifactDocumentExport
    expect(initialExport.content).toBe(`# download\\-${stamp}\n\nExport first paragraph\\.\n\nExport second paragraph\\.\n`)
    expect(initialExport.revision).toBe(0)
    await downloadMarkdown(owner.page, initialExport)
    await downloadMarkdown(reader.page, initialExport)

    for (const [actor, page] of [['owner', owner.page], ['reader', reader.page]] as const) {
      for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
        await page.setViewportSize({ width, height })
        await settleArtifactPageRail(page)
        const action = page.getByRole('button', { name: 'Download Markdown', exact: true })
        await action.focus()
        await expect(action).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`export-${actor}-${width}.png`) })
      }
    }

    const ownerPage = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await ownerPage.getByRole('button', { name: 'Edit block 2', exact: true }).click()
    const editor = ownerPage.getByRole('textbox', { name: 'Rewrite block 2', exact: true })
    await editor.fill('Edited export paragraph.')
    const exportButton = ownerPage.getByRole('button', { name: 'Download Markdown', exact: true })
    await expect(exportButton).toBeDisabled()
    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    await owner.page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
      if (route.request().method() === 'PATCH') await saveGate
      await route.continue()
    })
    await ownerPage.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(exportButton).toBeDisabled()
    releaseSave()
    await expect(editor).toHaveCount(0)
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/content`)
    await expect(ownerPage.getByText('Edited export paragraph.', { exact: true })).toBeVisible()

    const current = await reader.page.request.get(`${API}/artifacts/${artifact.id}/export`)
    expect(current.ok()).toBeTruthy()
    const currentExport = await current.json() as ArtifactDocumentExport
    expect(currentExport).toMatchObject({ artifactId: artifact.id, filename: name, revision: 1 })
    expect(currentExport.content).toBe(`# download\\-${stamp}\n\nExport first paragraph\\.\n\nEdited export paragraph\\.\n`)
    await downloadMarkdown(owner.page, currentExport)
    await downloadMarkdown(reader.page, currentExport)

    const revoked = await owner.page.request.delete(`${API}/grants/${(await grant.json()).id}`)
    expect(revoked.ok()).toBeTruthy()
    await expect(reader.page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeVisible()
    const staleReaderButton = reader.page.getByRole('button', { name: 'Download Markdown', exact: true })
    await staleReaderButton.click()
    await expect(reader.page.getByRole('alert')).toHaveText('This document is no longer available to this account.')
    expect((await reader.page.request.get(`${API}/artifacts/${artifact.id}/export`)).status()).toBe(404)
    expect((await owner.page.request.get(`${API}/artifacts/${artifact.id}/export`)).status()).toBe(200)
    expect((await owner.page.request.get(`${API}/artifacts/${artifact.id}/export`, { headers: { 'x-tenant-id': FOREIGN } })).status()).toBe(404)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close()])
  }
})

test('metadata-only authored document with a seeded name cannot borrow fixture bytes for download', async ({ page }) => {
  test.setTimeout(ms(30_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-export-metadata-${Date.now().toString(36)}` })
  const artifact = await createDocument(page, 'insights-onepager.md')
  await page.goto(`/artifacts/${artifact.id}`)
  const pageRoot = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await expect(pageRoot).toBeVisible()
  await expect(pageRoot.getByText('No saved document content yet.', { exact: true })).toBeVisible()
  await expect(pageRoot.getByRole('button', { name: 'Edit block 1', exact: true })).toHaveCount(0)
  await expect(pageRoot.getByText('Insights — launch one-pager', { exact: true })).toHaveCount(0)
  const exportResponse = await page.request.get(`${API}/artifacts/${artifact.id}/export`)
  expect(exportResponse.status()).toBe(409)
  expect((await exportResponse.json()).error.code).toBe('capability_unavailable')
  const button = page.getByRole('button', { name: 'Download Markdown', exact: true })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.getByRole('alert')).toHaveText('This artifact has no saved document content to download as Markdown.')
})

test('export coalesces duplicate activation and retries a transient read failure', async ({ page }) => {
  test.setTimeout(ms(30_000))
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(page, `download-retry-${stamp}.md`, 'Retryable export body.')
  await page.goto(`/artifacts/${artifact.id}`)
  const exportResponse = await page.request.get(`${API}/artifacts/${artifact.id}/export`)
  expect(exportResponse.ok()).toBeTruthy()
  const expected = await exportResponse.json() as ArtifactDocumentExport
  const button = page.getByRole('button', { name: 'Download Markdown', exact: true })

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let reads = 0
  await page.route(`**${API}/artifacts/${artifact.id}/export`, async (route) => {
    reads += 1
    await gate
    await route.continue()
  })
  const firstDownload = page.waitForEvent('download')
  await button.click()
  await expect.poll(() => reads).toBe(1)
  await expect(button).toBeDisabled()
  await button.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(reads).toBe(1)
  release()
  await firstDownload
  await page.unroute(`**${API}/artifacts/${artifact.id}/export`)

  let attempts = 0
  await page.route(`**${API}/artifacts/${artifact.id}/export`, async (route) => {
    attempts += 1
    if (attempts === 1) return route.abort('failed')
    return route.continue()
  })
  await button.click()
  await expect(page.getByRole('alert')).toHaveText('Could not download this document. Check your connection and try again.')
  const retryDownload = page.waitForEvent('download')
  await button.click()
  await retryDownload
  expect(attempts).toBe(2)
  await page.unroute(`**${API}/artifacts/${artifact.id}/export`)
  expect(expected.content).toContain('Retryable export body\\.')
})
