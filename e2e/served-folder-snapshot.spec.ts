import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { tierFor } from '../src/lib/viewport.ts'
import { startMessagesFixture } from './attachment-endpoint.ts'

const SIZES = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]
const ID = 'cloud::insights-dashboard'
const SNAPSHOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INTAKE = '**/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard'
const saved = (files = [{ name: 'readme.md', sizeBytes: 21, snapshot: { text: 'Saved folder original' } }]) => ({
  version: 1, snapshotId: SNAPSHOT_ID, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'insights-dashboard', files,
})

async function session(page: Page, tenant = `tenant-folder-${randomUUID()}`, providerId?: string) {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const response = await page.request.post('/api/v1/sessions', { data: providerId ? { providerId } : {} })
  expect(response.ok()).toBe(true)
  return (await response.json()).id as string
}

async function addFolder(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Folder/ }).click()
  await picker.getByRole('button', { name: 'Cloud storage', exact: true }).click()
  const row = page.getByRole('button', { name: /^insights-dashboard\s/ }).first()
  const more = picker.getByRole('button', { name: /^More folders/ })
  const direct = await Promise.race([
    row.waitFor({ state: 'visible' }).then(() => true),
    more.waitFor({ state: 'visible' }).then(() => false),
  ])
  if (!direct) await more.click()
  await row.click()
  await expect(picker.getByText('1 added', { exact: false })).toBeVisible()
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await settledAttachmentPreview(page, `[data-workspace-folder="${ID}"]`)
  return page.locator(`[data-workspace-folder="${ID}"]`).filter({ visible: true })
}

const preview = (page: Page) => page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
function notice(page: Page, role: 'status' | 'alert') {
  const host = tierFor(page.viewportSize()!.width) === 'wide' ? page.locator('[data-context-pane]') : page.locator('[data-overlay-dock]')
  return host.filter({ visible: true }).getByRole(role).filter({ hasText: role === 'status' ? 'Updating context…' : 'Couldn’t confirm the context update.' }).filter({ visible: true })
}
async function capture(page: Page, info: TestInfo, state: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await assertWcag22Aa(page, `served folder ${state}`)
  await mkdir('.data/screenshots', { recursive: true })
  const size = page.viewportSize()!
  await page.screenshot({ path: `.data/screenshots/served-folder-${state}-${size.width}x${size.height}-${info.workerIndex}.png`, fullPage: true })
}

async function refreshWalk(page: Page, info: TestInfo, size: typeof SIZES[number]) {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(size)
  const id = await session(page)
  let reads = 0
  await page.route(INTAKE, async (route) => { reads++; await route.fulfill({ json: saved() }) })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const bodies: unknown[] = []
  await page.route(`**/api/v1/sessions/${id}/folders/${encodeURIComponent(ID)}/refresh`, async (route) => {
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 1) {
      await gate
      await route.fulfill({ status: 503, json: { error: { code: 'internal', message: 'Folder source unavailable.' } } })
    } else await route.continue()
  })
  try {
    await page.goto(`/s/${id}`)
    const group = await addFolder(page)
    await expect(group.locator('[data-served-folder-state="saved"]')).toBeVisible()
    await expect(preview(page)).toContainText('Saved folder original')
    await expect(preview(page)).toContainText('currently attached text')
    await capture(page, info, 'saved')
    const refresh = group.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true })
    await refresh.click()
    await expect(notice(page, 'status')).toBeVisible()
    await expect(refresh).toBeDisabled()
    await expect(preview(page)).toContainText('Saved folder original')
    if (tierFor(size.width) !== 'narrow') await expect(page.getByRole('textbox', { name: 'Message', exact: true }).filter({ visible: true })).toBeDisabled()
    await capture(page, info, 'pending')
    release()
    const error = notice(page, 'alert')
    await expect(error).toBeVisible()
    await expect(error).toContainText('Folder source unavailable.')
    await expect(error.getByRole('button', { name: 'Use saved state', exact: true })).toBeVisible()
    await capture(page, info, 'error')
    await error.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(error).toHaveCount(0)
    await expect(group.locator('[data-served-folder-state="saved"]')).toBeVisible()
    await expect(preview(page)).not.toContainText('Saved folder original')
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    const state = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
    const folder = state.workspace.workspaces[0].folders[0]
    expect(folder.snapshot.snapshotId).toBe((bodies[0] as { requestId: string }).requestId)
    expect(state.workspace.workspaces[0].artifacts).toEqual([])
    expect(reads).toBe(1)
    await capture(page, info, 'refreshed')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
}

test('served folder saved-copy and Refresh recovery at 320x700', async ({ page }, info) => refreshWalk(page, info, SIZES[0]))
test('served folder saved-copy and Refresh recovery at 375x812', async ({ page }, info) => refreshWalk(page, info, SIZES[1]))
test('served folder saved-copy and Refresh recovery at 768x1024', async ({ page }, info) => refreshWalk(page, info, SIZES[2]))
test('served folder saved-copy and Refresh recovery at 844x390', async ({ page }, info) => refreshWalk(page, info, SIZES[3]))
test('served folder saved-copy and Refresh recovery at 1280x800', async ({ page }, info) => refreshWalk(page, info, SIZES[4]))

test('a lost folder Refresh acknowledgement replays its committed request without another source read', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(SIZES[4])
  const id = await session(page)
  let intakeReads = 0
  await page.route(INTAKE, async (route) => { intakeReads++; await route.fulfill({ json: saved() }) })
  const bodies: Array<{ expectedSnapshotId: string | null; requestId: string }> = []
  const refreshPath = `/api/v1/sessions/${id}/folders/${encodeURIComponent(ID)}/refresh`
  let committed: { workspace: { workspaces: Array<{ folders: Array<{ id: string; snapshot?: { snapshotId: string; capturedAt: string; files: Array<{ name: string; snapshot: { text?: string; omitted?: string } }> } }> }> } } | undefined
  await page.route(`**${refreshPath}`, async (route) => {
    bodies.push(route.request().postDataJSON() as { expectedSnapshotId: string | null; requestId: string })
    if (bodies.length === 1) {
      const response = await route.fetch()
      expect(response.ok(), 'the first request commits before its acknowledgement is lost').toBe(true)
      committed = await response.json() as typeof committed
      await route.abort('failed')
    } else {
      await route.continue()
    }
  })

  await page.goto(`/s/${id}`)
  const group = await addFolder(page)
  await expect(preview(page)).toContainText('Saved folder original')
  await group.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true }).click()
  const failure = notice(page, 'alert')
  await expect(failure).toBeVisible()
  expect(committed).toBeDefined()
  const committedFolder = committed!.workspace.workspaces.flatMap((workspace) => workspace.folders).find((folder) => folder.id === ID)!
  expect(committedFolder.snapshot?.snapshotId).toBe(bodies[0]?.requestId)
  expect(committedFolder.snapshot?.capturedAt).toBeTruthy()
  const committedText = committedFolder.snapshot?.files.find((file) => file.name === 'readme.md')?.snapshot.text
  expect(committedText).toBeTruthy()
  const committedState = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
  const persistedFolder = committedState.workspace.workspaces.flatMap((workspace: { folders?: Array<{ id: string; snapshot?: unknown }> }) => workspace.folders ?? []).find((folder: { id: string }) => folder.id === ID)
  expect(persistedFolder.snapshot).toEqual(committedFolder.snapshot)
  await expect(preview(page)).not.toContainText('Saved folder original')

  const replay = page.waitForResponse((response) => response.url().endsWith(refreshPath) && response.request().method() === 'POST', { timeout: ms(10_000) })
  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  const acknowledged = await replay
  expect(acknowledged.ok(), 'Retry replays the server-owned successful request').toBe(true)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  const replayed = await acknowledged.json()
  const replayedFolder = replayed.workspace.workspaces.flatMap((workspace: { folders?: Array<{ id: string; snapshot?: unknown }> }) => workspace.folders ?? []).find((folder: { id: string }) => folder.id === ID)
  expect(replayedFolder.snapshot).toEqual(committedFolder.snapshot)
  expect(intakeReads, 'retry reuses the exact durable receipt without returning to source intake').toBe(1)
  await expect(failure).toHaveCount(0)
  await expect(preview(page)).toContainText(committedText!)
})

test('folder saved text reaches the endpoint after reload without source reads; read-only recovery keeps it', async ({ page }, info) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(SIZES[4])
  const endpoint = await startMessagesFixture()
  const tenant = `tenant-folder-model-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  try {
    const provider = await page.request.post('/api/v1/providers', { data: { label: 'Folder fixture', modelFamily: 'claude', effortLevels: ['Default'], config: { baseURL: endpoint.url, model: 'e2e-attachment-model' } } })
    expect(provider.ok()).toBe(true)
    const id = await session(page, tenant, (await provider.json()).id)
    let sourceReads = 0
    await page.route(INTAKE, async (route) => { sourceReads++; await route.fulfill({ json: saved() }) })
    await page.goto(`/s/${id}`)
    await addFolder(page)
    await page.reload()
    await expect(preview(page)).toContainText('Saved folder original')
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Summarize my saved folder.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment: Saved folder original' })).toBeVisible()
    expect(endpoint.documents.at(-1)?.attached_files).toContainEqual({ name: 'insights-dashboard/readme.md', status: 'ready', text: 'Saved folder original' })
    expect(sourceReads).toBe(1)
    let refreshes = 0
    await page.route(`**/api/v1/sessions/${id}/folders/*/refresh`, async (route) => { refreshes++; await route.fulfill({ status: 503, json: { error: { code: 'internal', message: 'Source offline.' } } }) })
    await page.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true }).click()
    const error = notice(page, 'alert')
    await expect(error).toBeVisible()
    await error.getByRole('button', { name: 'Use saved state', exact: true }).click()
    await expect(error).toHaveCount(0)
    await expect(composer).toBeEnabled()
    await expect(preview(page)).toContainText('Saved folder original')
    expect(refreshes).toBe(1)
    expect(sourceReads).toBe(1)
    await capture(page, info, 'reconciled')
  } finally { await new Promise<void>((resolve) => endpoint.server.close(() => resolve())) }
})

test('empty folder retains independent identity, survives reload, and remains removable at every viewport', async ({ page }, info) => {
  test.setTimeout(ms(120_000))
  for (const size of SIZES) {
    await page.setViewportSize(size)
    const id = await session(page)
    await page.route(INTAKE, (route) => route.fulfill({ json: saved([]) }))
    await page.goto(`/s/${id}`)
    const group = await addFolder(page)
    await expect(group).toContainText('No visible top-level files')
    await page.reload()
    await expect(group).toContainText('No visible top-level files')
    await capture(page, info, 'empty')
    await group.getByRole('button', { name: 'Remove insights-dashboard/ from the workspace', exact: true }).click()
    await capture(page, info, 'remove-confirm')
    await group.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(group).toHaveCount(0)
    const state = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
    expect(state.workspace.workspaces).toEqual([])
    expect(state.contexts.some((row: { id: string }) => row.id === ID)).toBe(false)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('draft folder Refresh survives first-send materialization and reopen without a source reread', async ({ page }) => {
  await page.setViewportSize(SIZES[4])
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' })
  let reads = 0
  let refreshPosts = 0
  await page.route(INTAKE, async (route) => {
    reads++
    const text = reads === 1 ? 'Original draft copy' : 'Refreshed draft copy'
    await route.fulfill({ json: saved([{ name: 'readme.md', sizeBytes: Buffer.byteLength(text), snapshot: { text } }]) })
  })
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/folders\/.*\/refresh$/.test(request.url())) refreshPosts++
  })
  await page.goto('/')
  const group = await addFolder(page)
  await expect(preview(page)).toContainText('Original draft copy')
  await group.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true }).click()
  await expect(preview(page)).toContainText('Refreshed draft copy')
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Review the saved draft folder.')
  await composer.press('Enter')
  await page.waitForURL(/\/s\/[^/?]+$/)
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  await expect.poll(async () => {
    const state = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
    return state.workspace?.workspaces?.[0]?.folders?.[0]?.snapshot?.files?.[0]?.snapshot?.text
  }).toBe('Refreshed draft copy')
  await page.reload()
  await expect(preview(page)).toContainText('Refreshed draft copy')
  expect(reads, 'only Add and explicit draft Refresh read the source').toBe(2)
  expect(refreshPosts, 'draft Refresh has no durable session to mutate').toBe(0)
})
