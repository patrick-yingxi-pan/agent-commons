/** Browser proof for the canonical authored-slide PowerPoint export door. */
import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
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

async function createSlides(page: Page, name: string) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'slide', meta: 'Slides', body: { type: 'slides', slides: [{ title: 'Quarterly review', bullets: ['A long content item can continue on another slide.'] }] } } } },
    headers: { 'Idempotency-Key': `artifact-pptx-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function grantSlides(page: Page, id: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Grant
}

async function downloadPptx(page: Page, filename: string, expected: Uint8Array) {
  const action = page.getByRole('button', { name: 'Download PowerPoint', exact: true })
  await expect(action).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await action.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  expect((await readFile(path!)).equals(Buffer.from(expected))).toBe(true)
}

test('owner and granted reader download current slides as PowerPoint at every viewport', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  const name = `Revenue.Q1-${Date.now().toString(36)}.slides`
  try {
    const artifact = await createSlides(owner.page, name)
    const grant = await grantSlides(owner.page, artifact.id)
    // Retain the reader's visible page after revocation: block the initial
    // stream, not merely a future reconnect, before opening that page.
    await reader.page.route(`**${API}/events*`, (route) => route.abort())
    const fresh = await owner.page.request.get(`${API}/artifacts/${artifact.id}/export?format=pptx`)
    expect(fresh.ok()).toBeTruthy()
    const descriptor = await fresh.json() as ArtifactExport
    expect('encoding' in descriptor).toBe(true)
    const expectedBytes = Buffer.from(descriptor.content, 'base64')
    expect(expectedBytes.subarray(0, 4).toString()).toBe('PK\u0003\u0004')
    const filename = descriptor.filename
    for (const [role, page] of [['owner', owner.page], ['reader', reader.page]] as const) {
      await page.goto(`/artifacts/${artifact.id}`)
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await settleArtifactPageRail(page)
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true)
        await downloadPptx(page, filename, expectedBytes)
        await page.screenshot({ path: testInfo.outputPath(`pptx-${role}-${viewport.width}.png`) })
      }
    }
    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.getByRole('button', { name: 'Download PowerPoint', exact: true })).toHaveCount(0)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()

    let fail = true
    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=pptx`, async (route) => {
      if (fail) {
        fail = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Temporary export outage' } }) })
        return
      }
      await route.continue()
    })
    await owner.page.goto(`/artifacts/${artifact.id}`)
    const action = owner.page.getByRole('button', { name: 'Download PowerPoint', exact: true })
    await action.click()
    await expect(owner.page.getByText('Could not download this slide deck. Check your connection and try again.')).toBeVisible()
    await action.click()
    await expect(owner.page.getByText('PowerPoint download requested. Long content can use continuation slides.')).toBeVisible()
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=pptx`)

    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=pptx`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ artifactId: artifact.id, filename, mediaType: 'text/plain', encoding: 'base64', content: 'Tk9UWklQ', revision: 0 }),
      })
    })
    let unexpectedDownloads = 0
    const recordUnexpectedDownload = () => { unexpectedDownloads += 1 }
    owner.page.on('download', recordUnexpectedDownload)
    await action.click()
    await expect(owner.page.getByText('Could not download this slide deck. Check your connection and try again.')).toBeVisible()
    expect(await owner.page.waitForEvent('download', { timeout: 1_000 }).catch(() => null)).toBeNull()
    expect(unexpectedDownloads).toBe(0)
    owner.page.off('download', recordUnexpectedDownload)
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=pptx`)

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=pptx`, async (route) => {
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
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=pptx`)

    const cancelGate = new Promise<void>((resolve) => { release = resolve })
    requests = 0
    let cancelResponseReady = false
    let cancelResponseSettled = false
    await owner.page.route(`**${API}/artifacts/${artifact.id}/export?format=pptx`, async (route) => {
      requests += 1
      const response = await route.fetch()
      cancelResponseReady = true
      await cancelGate
      try {
        await route.fulfill({ response })
      } catch {
        // Navigation intentionally aborts this request; there must be no late download.
      } finally {
        cancelResponseSettled = true
      }
    })
    await owner.page.goto(`/artifacts/${artifact.id}`)
    const cancelAction = owner.page.getByRole('button', { name: 'Download PowerPoint', exact: true })
    owner.page.on('download', recordUnexpectedDownload)
    await cancelAction.click()
    await expect.poll(() => requests).toBe(1)
    await expect.poll(() => cancelResponseReady).toBe(true)
    await owner.page.goto('/')
    const canceledDownload = owner.page.waitForEvent('download', { timeout: 1_000 }).catch(() => null)
    release()
    await expect.poll(() => cancelResponseSettled).toBe(true)
    expect(await canceledDownload).toBeNull()
    expect(unexpectedDownloads).toBe(0)
    owner.page.off('download', recordUnexpectedDownload)
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/export?format=pptx`)

    expect((await owner.page.request.delete(`${API}/grants/${grant.id}`)).ok()).toBeTruthy()
    const staleAction = reader.page.getByRole('button', { name: 'Download PowerPoint', exact: true })
    await expect(staleAction).toBeVisible()
    reader.page.on('download', recordUnexpectedDownload)
    await staleAction.click()
    await expect(reader.page.getByText('This slide deck is no longer available to this account.')).toBeVisible()
    expect(await reader.page.waitForEvent('download', { timeout: 1_000 }).catch(() => null)).toBeNull()
    expect(unexpectedDownloads).toBe(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('artifact pages expose exactly the format native to each authored kind', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const save = async (kind: 'doc' | 'sheet' | 'slide', name: string, body: unknown) => {
    const response = await page.request.post(`${API}/relations/ops`, {
      data: { op: { kind: 'save-artifact', artifact: { name, kind, meta: kind, body } } },
      headers: { 'Idempotency-Key': `artifact-pptx-format-${kind}-${stamp}` },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
    const artifact = graph.extraArtifacts.find((row) => row.name === name)
    expect(artifact).toBeTruthy()
    return artifact!
  }

  const doc = await save('doc', `format-${stamp}.md`, 'saved text')
  await page.goto(`/artifacts/${doc.id}`)
  await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download XLSX', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download PowerPoint', exact: true })).toHaveCount(0)

  const sheet = await save('sheet', `format-${stamp}.xlsx`, { type: 'sheet', columns: ['A'], rows: [['saved']] })
  await page.goto(`/artifacts/${sheet.id}`)
  await expect(page.getByRole('button', { name: 'Download XLSX', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download PowerPoint', exact: true })).toHaveCount(0)

  const slide = await save('slide', `format-${stamp}.slides`, { type: 'slides', slides: [{ title: 'Saved', bullets: ['saved'] }] })
  await page.goto(`/artifacts/${slide.id}`)
  await expect(page.getByRole('button', { name: 'Download PowerPoint', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download XLSX', exact: true })).toHaveCount(0)
})
