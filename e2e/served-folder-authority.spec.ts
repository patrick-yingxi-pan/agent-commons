/** A saved folder is portable session content: readers see the copy, never the source door. */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import type { SessionContextState } from '../contract/api.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const FOLDER_ID = 'cloud::insights-dashboard'
const FOLDER_TEXT = 'Owner saved folder text is the only copy shared with Grace.'
const SNAPSHOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }

async function createSession(page: Page) {
  const response = await page.request.post('/api/v1/sessions', { data: {} })
  expect(response.ok(), 'an owner session is created through the API').toBe(true)
  return (await response.json() as { id: string }).id
}

async function attachSavedFolder(page: Page, sessionId: string) {
  const snapshot = {
    version: 1,
    snapshotId: SNAPSHOT_ID,
    capturedAt: '2026-10-04T12:00:00.000Z',
    sourceId: 'cloud',
    path: 'insights-dashboard',
    files: [{ name: 'readme.md', sizeBytes: Buffer.byteLength(FOLDER_TEXT), snapshot: { text: FOLDER_TEXT } }],
  }
  const response = await page.request.patch(`/api/v1/sessions/${sessionId}/context-state`, { data: {
    operations: [{ action: 'attach', context: {
      id: FOLDER_ID, type: 'folder', label: 'insights-dashboard', scope: 'insights-dashboard', source: SOURCE,
    } }],
    workspace: {
      workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [], folders: [{ id: FOLDER_ID, label: 'insights-dashboard/', snapshot }] }],
      repos: [], connectors: [], attachments: [],
    },
  } })
  expect(response.ok(), 'the owner attaches the explicit saved copy through context-state').toBe(true)
}

async function capture(page: Page, info: TestInfo, viewport: typeof VIEWPORTS[number]) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await assertWcag22Aa(page, `Shared saved folder ${viewport.width}x${viewport.height}`)
  await mkdir('.data/screenshots', { recursive: true })
  await page.screenshot({
    path: `.data/screenshots/served-folder-shared-${viewport.width}x${viewport.height}-${info.workerIndex}.png`,
    fullPage: true,
  })
}

test('a view-granted conversation shares only its saved folder copy at every viewport', async ({ browser }, info) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser) // seeded Ada / tenant-acme
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': `user-folder-foreign-${randomUUID()}`, 'x-tenant-id': `tenant-folder-foreign-${randomUUID()}` })
  try {
    const sessionId = await createSession(owner.page)
    await attachSavedFolder(owner.page, sessionId)
    const grant = await owner.page.request.post('/api/v1/grants', { data: {
      subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
    } })
    expect(grant.ok(), 'the owner creates a real tenant-beta view grant').toBe(true)

    const forbiddenSourceRequests: string[] = []
    grace.page.on('request', (request) => {
      const url = new URL(request.url())
      if (/\/fs\/(?:folder-snapshot|snapshot|text)(?:\/|\?|$)/.test(url.pathname + url.search)) forbiddenSourceRequests.push(url.pathname + url.search)
    })
    await grace.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const folder = grace.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
    await expect(folder).toBeVisible({ timeout: ms(20_000) })
    await expect(folder.locator('[data-served-folder-state="saved"]')).toBeVisible()
    await expect(grace.page.locator('[data-folder-snapshot-preview]').filter({ visible: true })).toContainText(FOLDER_TEXT)
    await expect(folder.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true })).toHaveCount(0)
    await expect(folder.getByRole('button', { name: 'Remove insights-dashboard/ from the workspace', exact: true })).toHaveCount(0)

    for (const viewport of VIEWPORTS) {
      await grace.page.setViewportSize(viewport)
      await settledAttachmentPreview(grace.page, `[data-workspace-folder="${FOLDER_ID}"]`)
      await expect(folder).toBeVisible()
      await expect(grace.page.locator('[data-folder-snapshot-preview]').filter({ visible: true })).toContainText(FOLDER_TEXT)
      await expect(folder.getByRole('button', { name: /^Refresh / })).toHaveCount(0)
      await expect(folder.getByRole('button', { name: /^Remove insights-dashboard/ })).toHaveCount(0)
      await capture(grace.page, info, viewport)
    }
    expect(forbiddenSourceRequests, 'a shared saved copy never calls any live filesystem read door').toEqual([])

    const denied = foreign.page.waitForResponse((response) =>
      response.url().includes(`/api/v1/sessions/${sessionId}`) && response.request().method() === 'GET',
      { timeout: ms(10_000) },
    )
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await denied).status(), 'a foreign tenant cannot retrieve the owner session').toBe(404)
    await expect(foreign.page.getByText(FOLDER_TEXT, { exact: false })).toHaveCount(0)
  } finally {
    await owner.context.close()
    await grace.context.close()
    await foreign.context.close()
  }
})

test('a legacy cloud folder remains unavailable until its owner explicitly saves a snapshot', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(VIEWPORTS[4])
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' })
  const sessionId = await createSession(page)
  const legacyArtifact = {
    id: 'insights-dashboard/readme.md', name: 'readme.md', kind: 'doc', meta: 'legacy served folder item',
    source: { id: FOLDER_ID, label: 'insights-dashboard/' },
  }
  const attached = await page.request.patch(`/api/v1/sessions/${sessionId}/context-state`, { data: {
    operations: [{ action: 'attach', context: {
      id: FOLDER_ID, type: 'folder', label: 'insights-dashboard', scope: 'insights-dashboard', source: SOURCE,
    } }],
    workspace: {
      workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [legacyArtifact] }],
      repos: [], connectors: [], attachments: [],
    },
  } })
  expect(attached.ok(), 'the compatibility fixture stores metadata without a snapshot').toBe(true)

  let liveReads = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/\/fs\/(?:folder-snapshot|snapshot|text)(?:\/|\?|$)/.test(url.pathname + url.search)) liveReads++
  })
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  await expect(group.locator('[data-served-folder-state="missing"]')).toBeVisible({ timeout: ms(20_000) })
  const row = group.getByText('readme.md', { exact: true }).first()
  await row.click()
  await settledAttachmentPreview(page, `[data-workspace-folder="${FOLDER_ID}"]`)
  const preview = page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
  await expect(preview).toContainText('No saved copy.')
  expect(liveReads, 'previewing legacy folder metadata does not read from its source').toBe(0)

  const refreshUrl = `/api/v1/sessions/${sessionId}/folders/${encodeURIComponent(FOLDER_ID)}/refresh`
  const refreshAck = page.waitForResponse((response) => response.url().includes(refreshUrl) && response.request().method() === 'POST', { timeout: ms(15_000) })
  await group.getByRole('button', { name: 'Save snapshot of insights-dashboard/', exact: true }).click()
  const response = await refreshAck
  expect(response.ok(), 'Save snapshot uses the owner refresh route').toBe(true)
  const refreshed = await response.json() as SessionContextState
  const savedText = refreshed.workspace.workspaces[0]?.folders?.[0]?.snapshot?.files.find((file) => file.name === 'readme.md')?.snapshot.text
  expect(savedText, 'the served folder route returned readable saved text').toBeTruthy()
  await expect(group.locator('[data-served-folder-state="saved"]')).toBeVisible()
  await expect(preview).toContainText(savedText!)
  await expect(page.locator('[data-attachment-input-disclosure]')).toContainText('The selected model receives 2 text files')
  expect(liveReads, 'the session refresh route owns capture; preview never calls intake directly').toBe(0)
})
