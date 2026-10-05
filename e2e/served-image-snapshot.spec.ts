/** Rendered coverage for durable snapshots of served image files and Photos.
 * Explicit capture and Refresh read source bytes; saved previews, sharing,
 * reload, and model input use the normalized durable image asset. */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route } from '@playwright/test'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { bitmapFixture } from '../tests/helpers/bitmapFixture.mjs'
import { svgFixture } from '../tests/helpers/svgFixture.mjs'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { startMessagesFixture } from './attachment-endpoint.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import { tierFor } from '../src/lib/viewport.ts'

mkdirSync('.data/served-image-review', { recursive: true })

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const SOURCES = [
  { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
  { id: 'runner:runner-local', kind: 'runner', runnerId: 'runner-local', label: 'Mapped images' },
]

type ServedImage = {
  sourceId: string
  path: string
  name: string
  mimeType: string
  bytes: Buffer
  width: number
  height: number
  kind: 'photo' | 'file'
}

function sourceFor(id: string) {
  const source = SOURCES.find((item) => item.id === id)
  if (!source) throw new Error(`Unknown served test source ${id}`)
  return source
}

function catalogEntry(image: ServedImage) {
  return {
    id: image.path, name: image.name, ext: image.name.split('.').at(-1)!.toLowerCase(),
    size: image.bytes.byteLength, mtime: 1, kind: 'image' as const,
  }
}

/** Catalog and served content are the browser boundary; upload, normalization,
 * attachment persistence, and Refresh remain real application behavior. */
async function serveImages(page: Page, images: readonly ServedImage[], read?: (image: ServedImage, route: Route) => Promise<void>) {
  const reads: string[] = []
  await page.route('**/api/v1/fs/sources', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SOURCES),
  }))
  await page.route('**/api/v1/fs/catalog?*', route => {
    const url = new URL(route.request().url())
    const source = sourceFor(url.searchParams.get('source') ?? '')
    const files = images.filter(image => image.sourceId === source.id && image.kind === 'file').map(catalogEntry)
    const photos = images.filter(image => image.sourceId === source.id && image.kind === 'photo').map(image => ({
      id: image.path, name: image.name, mtime: 1,
    }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source, files, photos, folders: [] }) })
  })
  await page.route('**/api/v1/fs/content?*', async route => {
    const url = new URL(route.request().url())
    const sourceId = url.searchParams.get('source') ?? ''
    const path = url.searchParams.get('path') ?? ''
    const image = images.find(item => item.sourceId === sourceId && item.path === path)
    if (!image) return route.fulfill({ status: 404, body: 'missing test source' })
    reads.push(`${sourceId}::${path}`)
    if (read) return read(image, route)
    return route.fulfill({ status: 200, contentType: image.mimeType, body: image.bytes })
  })
  return reads
}

async function createSession(page: Page, providerId?: string, tenant = `tenant-served-image-${randomUUID()}`) {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const response = await page.request.post('/api/v1/sessions', { data: providerId ? { providerId } : {} })
  expect(response.ok(), 'the test owns its conversation tenant').toBe(true)
  return (await response.json() as { id: string }).id
}

async function seedLegacyImage(page: Page, sessionId: string, image: ServedImage) {
  const source = sourceFor(image.sourceId)
  const response = await page.request.patch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/context-state`, {
    data: {
      operations: [],
      workspace: {
        workspaces: [], repos: [], connectors: [],
        attachments: [{ id: `${image.sourceId}::${image.path}`, label: image.name, kind: 'photo', source }],
      },
    },
  })
  expect(response.ok(), 'a pre-snapshot legacy attachment is seeded through the context-state boundary').toBe(true)
}

async function createModelSession(page: Page) {
  const tenant = `tenant-served-image-model-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  await registerMappedRunner(page)
  const endpoint = await startMessagesFixture()
  const provider = await page.request.post('/api/v1/providers', { data: {
    label: `Served image fixture ${randomUUID()}`, modelFamily: 'claude', effortLevels: ['Default'],
    config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
  } })
  expect(provider.ok(), 'the image-model fixture is configured before session creation').toBe(true)
  return { endpoint, sessionId: await createSession(page, (await provider.json()).id, tenant) }
}

async function registerMappedRunner(page: Page) {
  const response = await page.request.post('/api/v1/runners', { data: {
    id: 'runner-local', label: 'Mapped images', host: 'e2e',
    capabilities: [
      { type: 'fs.read', scopes: ['~/projects'] },
      { type: 'fs.list', scopes: ['~/projects'] },
    ],
  } })
  expect(response.ok(), 'runner-backed Refresh has registered filesystem authority').toBe(true)
}

async function openPicker(page: Page, kind: 'Files' | 'Photos') {
  const dock = page.locator('[data-overlay-dock]').filter({ visible: true })
  if (await dock.count()) await dock.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: new RegExp(`^${kind}`) }).click()
  return picker
}

async function chooseSource(picker: ReturnType<Page['getByRole']>, sourceId: string) {
  const source = sourceFor(sourceId)
  await picker.getByRole('button', { name: source.label, exact: true }).click()
}

async function chooseEntry(picker: ReturnType<Page['getByRole']>, image: ServedImage) {
  if (image.kind === 'photo') {
    const thumb = picker.getByTitle(image.name, { exact: true })
    await expect(thumb, `${image.name} appears in the served Photos catalog`).toBeVisible({ timeout: ms(15_000) })
    await thumb.click()
    return
  }
  const row = picker.getByRole('button', { name: new RegExp(`^${image.name.replaceAll('.', '\\.')}\\b`) }).first()
  const more = picker.getByRole('button', { name: /^More files\b/ })
  if (await more.isVisible().catch(() => false)) await more.click()
  await expect(row, `${image.name} appears in the served Files catalog`).toBeVisible({ timeout: ms(15_000) })
  await row.click()
}

type SavedAttachment = {
  id: string
  label: string
  kind: string
  source?: { id?: string }
  imageSnapshot?: {
    version: number
    snapshotId: string
    capturedAt: string
    sourceId: string
    path: string
    image: { id: string; mimeType: string; width: number; height: number; byteLength: number }
  }
}

async function savedAttachment(page: Page, sessionId: string, image: ServedImage, timeout = 20_000): Promise<SavedAttachment> {
  let found: SavedAttachment | undefined
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)
    if (!response.ok()) return false
    const detail = await response.json() as { workspace?: { attachments?: SavedAttachment[] } }
    found = detail.workspace?.attachments?.find(item => item.label === image.name && item.source?.id === image.sourceId)
    const snapshot = found?.imageSnapshot
    return Boolean(snapshot && snapshot.version === 1 && snapshot.sourceId === image.sourceId && snapshot.path === image.path &&
      snapshot.snapshotId && snapshot.capturedAt && snapshot.image.mimeType === 'image/png' &&
      snapshot.image.width === image.width && snapshot.image.height === image.height)
  }, { message: `${image.name} is attached as a complete normalized image snapshot`, timeout: ms(timeout) }).toBe(true)
  return found!
}

async function attachServedImage(page: Page, image: ServedImage) {
  const picker = await openPicker(page, image.kind === 'photo' ? 'Photos' : 'Files')
  await chooseSource(picker, image.sourceId)
  await chooseEntry(picker, image)
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '')
  const attachment = await savedAttachment(page, sessionId, image)
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  const preview = page.locator(`[data-attachment-preview="${attachment.id}"]`).filter({ visible: true })
  await expect(preview, 'the saved image is selected in its read-only preview').toBeVisible()
  await expect(preview.locator('[data-served-snapshot="saved"]')).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeVisible()
  await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement, expected) =>
    element.complete && element.naturalWidth === expected.width && element.naturalHeight === expected.height,
    { width: image.width, height: image.height },
  )).toBe(true)
  return { attachment, preview }
}

async function openSavedPreview(page: Page, image: ServedImage, attachment: SavedAttachment, expectedState: 'saved' | 'missing' = 'saved') {
  let preview = page.locator(`[data-attachment-preview="${attachment.id}"]`).filter({ visible: true })
  const chip = page.getByTitle('Open in sidebar').filter({ hasText: image.name }).filter({ visible: true })
  const groupName = image.kind === 'photo' ? 'Photos' : 'Files'
  const group = page.getByTitle(image.kind === 'photo' ? /^Photos \(\d+\)$/ : /^Files \(\d+\)$/).filter({ visible: true })
  await expect.poll(async () => (await preview.count()) + (await chip.count()) + (await group.count()), {
    message: 'the addressed attachment projection has loaded before choosing its door',
  }).toBeGreaterThan(0)
  if (!(await preview.count())) {
    if (await chip.count()) await chip.click()
    else {
      await group.click()
      await page.getByRole('menu', { name: groupName, exact: true }).getByRole('button', { name: image.name, exact: true }).click()
    }
    preview = page.locator(`[data-attachment-preview="${attachment.id}"]`).filter({ visible: true })
  }
  await settledAttachmentPreview(page)
  await expect(preview).toBeVisible()
  await expect(preview.locator(`[data-served-snapshot="${expectedState}"]`)).toBeVisible()
  if (expectedState === 'saved') {
    await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  }
  return preview
}

async function assertContained(locator: ReturnType<Page['locator']>, page: Page, description: string) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box, `${description} has a rendered box`).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x, `${description} stays inside the left edge`).toBeGreaterThanOrEqual(0)
  expect(box!.y, `${description} stays inside the top edge`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `${description} stays inside the right edge`).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height, `${description} stays inside the bottom edge`).toBeLessThanOrEqual(viewport!.height)
}

function visibleMutationNotice(page: Page, role: 'status' | 'alert', message: string) {
  const host = tierFor(page.viewportSize()!.width) === 'wide'
    ? page.locator('[data-context-pane]').filter({ visible: true })
    : page.locator('[data-overlay-dock]').filter({ visible: true })
  return host.getByRole(role).filter({ hasText: message }).filter({ visible: true })
}

async function reviewRecovery(page: Page, preview: ReturnType<Page['locator']>, state: 'pending' | 'failed', viewport: typeof VIEWPORTS[number], workerIndex: number) {
  await page.setViewportSize(viewport)
  await settledAttachmentPreview(page)
  const size = `${viewport.width}x${viewport.height}`
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state} image preview has no horizontal overflow at ${size}`).toBe(true)
  await assertWcag22Aa(page, `Served image ${state} ${size}`)
  await assertContained(preview, page, `saved image preview ${size}`)
  if (state === 'pending') {
    const status = visibleMutationNotice(page, 'status', 'Updating context…')
    await expect(status).toHaveCount(1)
    await assertContained(status, page, `image refresh status ${size}`)
    await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 160 && element.naturalHeight === 80)).toBe(true)
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeDisabled()
  } else {
    const alert = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.').last()
    await expect(alert).toBeVisible()
    await expect(preview).toContainText('Saved copy.')
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeDisabled()
    await assertContained(alert, page, `image refresh recovery ${size}`)
  }
  if (viewport.width === 844) {
    const imageBox = await preview.locator('img').last().evaluate(element => {
      const box = element.parentElement!.getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    expect(imageBox.height, 'the full image keeps its aspect box instead of shrinking into a strip').toBeGreaterThanOrEqual(imageBox.width * 9 / 16 - 1)
    const box = await preview.boundingBox()
    expect(box).not.toBeNull()
    expect(await preview.evaluate((element) => element.scrollHeight > element.clientHeight), 'short landscape really needs the preview panel to scroll').toBe(true)
  }
  await page.screenshot({ path: `.data/served-image-review/refresh-${state}-${size}-${workerIndex}.png`, fullPage: true })
}

test('served Photo and Files images normalize into durable snapshots reused by reload, sharing, and model input', async ({ page, browser }) => {
  test.setTimeout(ms(120_000))
  const { endpoint, sessionId } = await createModelSession(page)
  const images: ServedImage[] = [
    { sourceId: 'cloud', path: 'photos/cover.png', name: 'cover.png', mimeType: 'image/png', bytes: imageFixture(), width: 160, height: 80, kind: 'photo' },
    { sourceId: 'runner:runner-local', path: 'projects/cover.bmp', name: 'cover.bmp', mimeType: 'image/bmp', bytes: bitmapFixture(160, 80), width: 160, height: 80, kind: 'file' },
    { sourceId: 'cloud', path: 'projects/diagram.svg', name: 'diagram.svg', mimeType: 'image/svg+xml', bytes: svgFixture(160, 80, { viewBoxOnly: true }), width: 160, height: 80, kind: 'file' },
  ]
  const reads = await serveImages(page, images)
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const saved: SavedAttachment[] = []
    for (const image of images) {
      const result = await attachServedImage(page, image)
      saved.push(result.attachment)
      expect(result.attachment.kind, 'intake preserves the selected Files or Photos kind').toBe(image.kind)
      expect(result.attachment.imageSnapshot?.image.byteLength).toBeGreaterThan(0)
      expect(JSON.stringify(result.attachment)).not.toMatch(/data:image|blob:/)
      if (image.kind === 'photo') {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport)
          await settledAttachmentPreview(page)
          await assertWcag22Aa(page, `Saved photo ${viewport.width}x${viewport.height}`)
          await assertContained(result.preview, page, 'saved photo preview')
          await page.screenshot({ path: `.data/served-image-review/photo-saved-${viewport.width}x${viewport.height}.png` })
        }
      }
    }
    const readsAfterCapture = reads.length
    expect(readsAfterCapture).toBeGreaterThanOrEqual(images.length)

    await page.reload()
    await openSavedPreview(page, images[0]!, saved[0]!)
    const grant = await page.request.post('/api/v1/grants', {
      data: { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), 'the owner grants a read-only shared view').toBe(true)
    const viewer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
    try {
      await viewer.page.setViewportSize(VIEWPORTS[4])
      await viewer.page.goto(`/s/${encodeURIComponent(sessionId)}`)
      const shared = await openSavedPreview(viewer.page, images[1]!, saved[1]!)
      await expect(shared.getByRole('button', { name: 'Refresh saved copy', exact: true })).toHaveCount(0)
      await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    } finally {
      await viewer.context.close()
    }
    const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
    try {
      const denied = foreign.page.waitForResponse(response =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}`,
      { timeout: ms(15_000) })
      await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
      expect((await denied).status(), 'an unrelated tenant cannot open the saved image conversation').toBe(404)
      const asset = await foreign.page.request.get(`/api/v1/image-assets/${encodeURIComponent(saved[0]!.imageSnapshot!.image.id)}/content`)
      expect(asset.status(), 'the durable image asset remains tenant-owned').toBe(404)
      await expect(foreign.page.locator('[data-attachment-preview]')).toHaveCount(0)
    } finally {
      await foreign.context.close()
    }

    const composer = page.getByPlaceholder('Reply to Claude…')
    await composer.fill('Describe the saved images.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').last().filter({ hasText: 'Received 3 supplied image(s).' })).toBeVisible({ timeout: ms(25_000) })
    await expect.poll(() => endpoint.images.filter(images => images.length > 0).length).toBe(1)
    const sent = endpoint.images.find(images => images.length > 0)!
    expect(sent).toHaveLength(3)
    for (let index = 0; index < saved.length; index += 1) {
      const content = await page.request.get(`/api/v1/image-assets/${encodeURIComponent(saved[index]!.imageSnapshot!.image.id)}/content`)
      expect(content.ok()).toBe(true)
      const storedBytes = await content.body()
      expect(sent.some(block => block.source.media_type === 'image/png' && Buffer.from(block.source.data, 'base64').equals(storedBytes)),
        `${saved[index]!.label} reaches the model as its exact durable PNG bytes`).toBe(true)
    }
    expect(reads, 'reload, shared preview, and model preparation use durable snapshots').toHaveLength(readsAfterCapture)
    const savedWorkspace = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
    expect(JSON.stringify(savedWorkspace.workspace)).not.toMatch(/data:image|blob:/)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await new Promise<void>(resolve => endpoint.server.close(() => resolve()))
  }
})

async function exerciseServedImageRefresh(page: Page, kind: 'file' | 'photo') {
  test.setTimeout(ms(120_000))
  const tenant = `tenant-served-image-refresh-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  await registerMappedRunner(page)
  const sessionId = await createSession(page, undefined, tenant)
  const image: ServedImage = {
    sourceId: 'runner:runner-local', path: 'projects/refresh.bmp', name: 'refresh.bmp', mimeType: 'image/bmp',
    bytes: bitmapFixture(160, 80), width: 160, height: 80, kind,
  }
  let sourceRead = 0
  await serveImages(page, [image], async (_entry, route) => {
    if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: image.mimeType, body: image.bytes })
    sourceRead += 1
    const bytes = sourceRead === 1 ? image.bytes : bitmapFixture(96, 48)
    return route.fulfill({ status: 200, contentType: image.mimeType, body: bytes })
  })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let hold = true
  const bodies: unknown[] = []
  await page.route(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`, async route => {
    bodies.push(route.request().postDataJSON())
    if (hold) {
      hold = false
      await gate
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Refresh temporarily failed.' } }) })
    }
    return route.continue()
  })
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const { attachment, preview } = await attachServedImage(page, image)
    const priorSnapshotId = attachment.imageSnapshot!.snapshotId
    const refresh = preview.getByRole('button', { name: 'Refresh saved copy', exact: true })
    await refresh.click()
    await expect(visibleMutationNotice(page, 'status', 'Updating context…')).toHaveCount(1)
    for (const viewport of VIEWPORTS) await reviewRecovery(page, preview, 'pending', viewport, kind === 'file' ? 0 : 1)
    release()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.').last()
    await expect(failure).toBeVisible({ timeout: ms(15_000) })
    await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 160 && element.naturalHeight === 80)).toBe(true)
    for (const viewport of VIEWPORTS) {
      await reviewRecovery(page, preview, 'failed', viewport, kind === 'file' ? 0 : 1)
    }
    const originalPayload = bodies[0]
    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => bodies.length, { message: 'Retry replays one saved request' }).toBe(2)
    expect(bodies[1]).toEqual(originalPayload)
    const payload = bodies[0] as { expectedSnapshotId: string; requestId: string; imageSnapshot: { snapshotId: string; sourceId: string; path: string; image: { width: number; height: number; mimeType: string } } }
    expect(payload.expectedSnapshotId).toBe(priorSnapshotId)
    expect(payload.requestId).toBe(payload.imageSnapshot.snapshotId)
    expect(payload.imageSnapshot).toMatchObject({ sourceId: image.sourceId, path: image.path, image: { mimeType: 'image/png', width: 96, height: 48 } })
    expect(sourceRead, 'Retry uploads captured bytes without rereading the source').toBe(2)
    await expect.poll(async () => {
      const detail = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: SavedAttachment[] } }
      return detail.workspace.attachments.find(item => item.id === attachment.id)?.imageSnapshot?.snapshotId
    }).not.toBe(priorSnapshotId)
    const detail = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: SavedAttachment[] } }
    const updated = detail.workspace.attachments.find(item => item.id === attachment.id)!.imageSnapshot!
    expect(updated.image).toMatchObject({ mimeType: 'image/png', width: 96, height: 48 })
    await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 96 && element.naturalHeight === 48)).toBe(true)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
}

test('served-image file Refresh holds the saved preview and retries the identical normalized payload across five viewports', async ({ page }) => {
  await exerciseServedImageRefresh(page, 'file')
})

test('served-image photo Refresh holds the saved preview and retries the identical normalized payload across five viewports', async ({ page }) => {
  await exerciseServedImageRefresh(page, 'photo')
})

test('malformed and oversized served image captures fail without attaching partial snapshots', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  const images: ServedImage[] = [
    { sourceId: 'cloud', path: 'photos/invalid.png', name: 'invalid.png', mimeType: 'image/png', bytes: Buffer.from('not a PNG'), width: 0, height: 0, kind: 'photo' },
    { sourceId: 'cloud', path: 'photos/large.png', name: 'large.png', mimeType: 'image/png', bytes: Buffer.alloc(8 * 1024 * 1024 + 1), width: 0, height: 0, kind: 'photo' },
  ]
  const reads = await serveImages(page, images)
  try {
    await page.setViewportSize(VIEWPORTS[3])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const picker = await openPicker(page, 'Photos')
    await chooseSource(picker, 'cloud')
    await expect.poll(() => reads.length, { message: 'served Photos render from the source fixture' }).toBeGreaterThan(0)
    for (const image of images) {
      const readsBeforeCapture = reads.filter(path => path === `${image.sourceId}::${image.path}`).length
      await chooseEntry(picker, image)
      const error = picker.locator('[data-fs-file-read="error"]').filter({ visible: true })
      await expect(error, `${image.name} remains in a rendered failed-capture state`).toBeVisible({ timeout: ms(20_000) })
      await expect(error).toContainText(/could not|invalid|unsupported|too large|8 MB/i)
      await expect.poll(() => reads.filter(path => path === `${image.sourceId}::${image.path}`).length,
        { message: `${image.name} failed after an actual source read` }).toBeGreaterThan(readsBeforeCapture)
      const retry = error.getByRole('button', { name: 'Retry', exact: true })
      await expect(retry).toBeVisible()
      await assertContained(picker.getByRole('button', { name: 'Done', exact: true }), page, 'completion stays outside the scrolling intake body')
      await retry.scrollIntoViewIfNeeded()
      await assertContained(retry, page, `${image.name} Retry action`)
      await assertWcag22Aa(page, `${image.name} failed image capture`)
      await page.screenshot({ path: `.data/served-image-review/${image.name}-error-844x390.png` })
      const detail = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: SavedAttachment[] } }
      expect(detail.workspace.attachments, 'no invalid image or incomplete snapshot becomes an attachment').toHaveLength(0)
      await expect(page.locator('[data-attachment-preview]')).toHaveCount(0)
    }
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('a legacy served image stays preview-only until the owner explicitly saves a snapshot', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  const image: ServedImage = {
    sourceId: 'cloud', path: 'photos/legacy.png', name: 'legacy.png', mimeType: 'image/png',
    bytes: imageFixture(), width: 160, height: 80, kind: 'photo',
  }
  await seedLegacyImage(page, sessionId, image)
  const reads = await serveImages(page, [image])
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const legacy: SavedAttachment = { id: `${image.sourceId}::${image.path}`, label: image.name, kind: 'photo', source: { id: image.sourceId } }
    const preview = await openSavedPreview(page, image, legacy, 'missing')
    await expect(preview.locator('[data-served-snapshot="missing"]')).toBeVisible()
    await expect(preview.getByRole('button', { name: 'Save snapshot', exact: true })).toBeVisible()
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toHaveCount(0)
    expect(reads, 'opening the legacy preview does not read its source').toHaveLength(0)

    await preview.getByRole('button', { name: 'Save snapshot', exact: true }).click()
    const saved = await savedAttachment(page, sessionId, image)
    await expect(preview.locator('[data-served-snapshot="saved"]')).toBeVisible()
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeVisible()
    await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 160 && element.naturalHeight === 80)).toBe(true)
    expect(saved.imageSnapshot?.sourceId).toBe(image.sourceId)
    expect(reads.filter(path => path === `${image.sourceId}::${image.path}`), 'explicit Save snapshot reads the source once').toHaveLength(1)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('cancelling a served-image capture fences late bytes before they can attach', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  const image: ServedImage = {
    sourceId: 'cloud', path: 'photos/late.png', name: 'late.png', mimeType: 'image/png',
    bytes: imageFixture(), width: 160, height: 80, kind: 'photo',
  }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const reads = await serveImages(page, [image], async (entry, route) => {
    await gate
    return route.fulfill({ status: 200, contentType: entry.mimeType, body: entry.bytes })
  })
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const picker = await openPicker(page, 'Photos')
    await chooseSource(picker, image.sourceId)
    const readsBeforeCapture = reads.filter(path => path === `${image.sourceId}::${image.path}`).length
    const pendingRead = page.waitForRequest(request => request.resourceType() === 'fetch' && request.url().includes('/api/v1/fs/content?') && new URL(request.url()).searchParams.get('path') === image.path, { timeout: ms(15_000) })
    await chooseEntry(picker, image)
    await pendingRead
    await expect(picker.locator('[data-fs-file-read="loading"]')).toBeVisible()
    await expect(picker.getByRole('button', { name: image.name, exact: true }), 'the pending photo keeps native disabled-button semantics').toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    release()
    await expect.poll(() => reads.filter(path => path === `${image.sourceId}::${image.path}`).length).toBeGreaterThan(readsBeforeCapture)
    await expect.poll(async () => {
      const detail = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: SavedAttachment[] } }
      return detail.workspace.attachments.length
    }).toBe(0)
    expect(reads.some(path => path === `${image.sourceId}::${image.path}`), 'source access began for the cancelled capture').toBe(true)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('switching accounts fences an in-flight served-image capture from the previous owner', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.goto('/')
  const adaLogin = await page.request.post('/api/v1/auth/login', { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(adaLogin.ok()).toBe(true)
  const graceLogin = await page.request.post('/api/v1/auth/login', { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(graceLogin.ok()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const created = await page.request.post('/api/v1/sessions', { data: {} })
  expect(created.ok(), 'the session is created while Ada is active').toBe(true)
  const sessionId = (await created.json() as { id: string }).id
  const image: ServedImage = {
    sourceId: 'cloud', path: 'photos/account-fence.png', name: 'account-fence.png', mimeType: 'image/png',
    bytes: imageFixture(), width: 160, height: 80, kind: 'photo',
  }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const reads = await serveImages(page, [image], async (entry, route) => {
    await gate
    return route.fulfill({ status: 200, contentType: entry.mimeType, body: entry.bytes })
  })
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const picker = await openPicker(page, 'Photos')
    await chooseSource(picker, image.sourceId)
    const readsBeforeCapture = reads.filter(path => path === `${image.sourceId}::${image.path}`).length
    const pendingRead = page.waitForRequest(request => request.resourceType() === 'fetch' && request.url().includes('/api/v1/fs/content?') && new URL(request.url()).searchParams.get('path') === image.path, { timeout: ms(15_000) })
    await chooseEntry(picker, image)
    await pendingRead
    await expect(picker.locator('[data-fs-file-read="loading"]')).toBeVisible()

    // This is a real remembered-account switch. The account lifecycle must
    // abort the source capture, even though the late bytes will eventually land.
    await page.getByTestId('account-chip').click()
    await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).first().click()
    await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
    release()
    await expect.poll(() => reads.filter(path => path === `${image.sourceId}::${image.path}`).length).toBeGreaterThan(readsBeforeCapture)
    await page.getByTestId('account-chip').click()
    await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
    await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
    const detail = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)).json() as { workspace: { attachments: SavedAttachment[] } }
    expect(detail.workspace.attachments, 'late bytes from the previous account generation are discarded').toHaveLength(0)
    expect(reads.some(path => path === `${image.sourceId}::${image.path}`), 'the previous account began a served-image read').toBe(true)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
