/** Browser coverage for owner-only download of retained source image bytes.
 * Workspace previews continue to use the normalized PNG asset. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { test, expect, type Page, type Request, type Route } from '@playwright/test'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { iconFixture } from '../tests/helpers/bitmapFixture.mjs'
import { svgFixture } from '../tests/helpers/svgFixture.mjs'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

mkdirSync('.data/image-original-review', { recursive: true })

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

type LocalImage = { name: string; mimeType: string; bytes: Buffer; width: number; height: number }
type AssetRef = { id: string; mimeType: string; width: number; height: number; byteLength: number; originalByteLength?: number }
type SavedAttachment = { id: string; label: string; kind?: string; image?: AssetRef; imageSnapshot?: { image: AssetRef } }

async function createOwnerSession(page: Page) {
  const tenant = `tenant-image-original-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const response = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Original image review' } })
  expect(response.ok(), 'the owner creates an isolated image conversation').toBe(true)
  return (await response.json() as { id: string }).id
}

async function selectLocalImage(page: Page, image: LocalImage, sessionId: string) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Photos/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await picker.getByRole('button', { name: /Add photos from this computer/ }).click()
  await (await choosing).setFiles([{ name: image.name, mimeType: image.mimeType, buffer: image.bytes }])
  // The composer count can already be nonzero from a previous import. Wait for
  // this exact filename to cross the durable attachment boundary instead.
  let attachment: SavedAttachment | undefined
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)
    if (!response.ok()) return false
    const detail = await response.json() as { workspace?: { attachments?: SavedAttachment[] } }
    attachment = detail.workspace?.attachments?.find((item) => item.label === image.name && item.image?.originalByteLength === image.bytes.byteLength)
    return Boolean(attachment)
  }, { message: `${image.name} from this selection is durably attached with original metadata`, timeout: ms(20_000) }).toBe(true)
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  // Done publishes the local selection and opens its preview as part of the
  // split-pane remount. Let that addressed preview finish mounting here; a
  // chip click during the transition would toggle the newly opened pane closed.
  const selectedPreview = page.locator(`[data-attachment-preview="${attachment!.id}"]`)
  await expect(selectedPreview).toBeVisible({ timeout: ms(20_000) })
  return attachment!
}

async function selectAttachmentPreview(
  page: Page,
  attachment: SavedAttachment,
  selectedPanel?: { kind: string; id: string } | null,
) {
  let preview = page.locator(`[data-attachment-preview="${attachment.id}"]`).filter({ visible: true })
  const chip = page.getByTitle('Open in sidebar').filter({ hasText: attachment.label }).filter({ visible: true })
  const groupName = attachment.kind === 'file' ? 'Files' : 'Photos'
  const group = page.getByTitle(attachment.kind === 'file' ? /^Files \(\d+\)$/ : /^Photos \(\d+\)$/).filter({ visible: true })
  const panelKind = attachment.kind === 'file' ? 'file' : 'photo'
  const alreadySelected = selectedPanel?.kind === panelKind && selectedPanel.id === attachment.id
  await expect.poll(async () => (await preview.count()) + (await chip.count()) + (await group.count()), {
    message: `${attachment.label} has a loaded attachment projection before selecting its preview`,
  }).toBeGreaterThan(0)
  // Import completion can select/open a preview itself. Treat that as success;
  // clicking its chip again would toggle it closed on the overlay surface.
  if (!(await preview.count()) && !alreadySelected) {
    if (await chip.count()) await chip.last().click()
    else {
      await group.click()
      await page.getByRole('menu', { name: groupName, exact: true }).getByRole('button', { name: attachment.label, exact: true }).click()
    }
    // The composer chip is the app's authoritative selected-panel signal. On
    // reload the session preference read can reconcile after the chips render;
    // wait until the requested context is actually focused before expecting its
    // lazy sidebar panel to mount.
    const selectedControl = await group.count() ? group : chip.last()
    await expect.poll(async () => {
      if (!(await selectedControl.count())) return false
      return selectedControl.evaluate((element) => element.className.includes('ring-accent'))
    }, { message: `${attachment.label} becomes the active selected-panel context` }).toBe(true)
    preview = page.locator(`[data-attachment-preview="${attachment.id}"]`).filter({ visible: true })
  }
  await expect(preview).toBeVisible({ timeout: ms(20_000) })
  await settledAttachmentPreview(page)
  return preview
}

async function openPreview(
  page: Page,
  attachment: SavedAttachment,
  state: 'ready' | 'failed' = 'ready',
  selectedPanel?: { kind: string; id: string } | null,
) {
  const preview = await selectAttachmentPreview(page, attachment, selectedPanel)
  await expect(preview.locator('[data-image-original]')).toHaveAttribute('data-image-original', state, { timeout: ms(20_000) })
  return preview
}

async function captureOriginalSurface(page: Page, preview: ReturnType<Page['locator']>, state: 'ready' | 'error', label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledAttachmentPreview(page)
    const size = `${viewport.width}x${viewport.height}`
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} has no horizontal overflow at ${size}`).toBe(true)
    if (state === 'ready') {
      const downloadButton = preview.getByRole('button', { name: 'Download original', exact: true })
      await expect(downloadButton).toBeVisible()
      await expect(preview.getByText('Shared views and conversation image input use the preview copy.')).toBeVisible()
      await assertControlContained(downloadButton, page, `${label} download button ${size}`)
    }
    else {
      await expect(preview.getByRole('alert')).toContainText('Could not check the original')
      const retryButton = preview.getByRole('button', { name: 'Retry original availability', exact: true })
      await expect(retryButton).toBeVisible()
      await assertControlContained(retryButton, page, `${label} retry button ${size}`)
    }
    await assertWcag22Aa(page, `${label} ${size}`)
    await page.screenshot({ path: `.data/image-original-review/${label}-${size}.png`, fullPage: true })
  }
}

async function assertControlContained(locator: ReturnType<Page['locator']>, page: Page, description: string) {
  // A control can be below the current scroll position within the preview even
  // though it remains reachable. Scroll its actual overflow ancestor first,
  // then assert the painted control—not merely its visibility flag—is inside
  // the viewport.
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box, `${description} has a rendered box`).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x, `${description} stays inside the left edge`).toBeGreaterThanOrEqual(0)
  expect(box!.y, `${description} stays inside the top edge`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `${description} stays inside the right edge`).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height, `${description} stays inside the bottom edge`).toBeLessThanOrEqual(viewport!.height)
}

async function downloadAndCompare(page: Page, preview: ReturnType<Page['locator']>, image: LocalImage) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    preview.getByRole('button', { name: 'Download original', exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toBe(image.name)
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(readFileSync(path!)).toEqual(image.bytes)
  await expect(preview.getByText('Original download requested.', { exact: true })).toBeVisible()
}

const localImages: LocalImage[] = [
  { name: 'very-long-original-image-fixture-for-responsive-download.svg', mimeType: 'image/svg+xml', bytes: Buffer.from(svgFixture(160, 80, { viewBoxOnly: true })), width: 160, height: 80 },
  { name: 'source.ico', mimeType: 'image/x-icon', bytes: Buffer.from(iconFixture(32, 16, { png: true })), width: 32, height: 16 },
  { name: 'source.png', mimeType: 'image/png', bytes: imageFixture(), width: 160, height: 80 },
]

test('owners download exact local SVG, ICO, and PNG bytes after reload while legacy imports disclose no original', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const sessionId = await createOwnerSession(page)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  for (const image of localImages) {
    const attachment = await selectLocalImage(page, image, sessionId)
    const preview = await openPreview(page, attachment)
    const normalized = await page.request.get(`/api/v1/image-assets/${encodeURIComponent(attachment.image!.id)}/content`)
    expect(normalized.ok()).toBe(true)
    expect(Buffer.from(await normalized.body())).not.toEqual(image.bytes)
    await downloadAndCompare(page, preview, image)
    await page.reload()
    // A pre-reload response listener can capture an old document's pending
    // session poll, whose body handle expires during navigation. Prove the new
    // page is writable, then read fresh metadata through the request context.
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    const reloadedSession = await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)
    expect(reloadedSession.ok(), 'fresh session metadata is readable after reload').toBe(true)
    const reloadedDetail = await reloadedSession.json() as {
      workspace?: { attachments?: SavedAttachment[] }
      viewerPreferences?: { panelFocus?: { kind: string; id: string } | null }
    }
    expect(reloadedDetail.workspace?.attachments?.some((item) => item.id === attachment.id), 'the session read after reload restores the same attachment identity').toBe(true)
    const reloaded = await openPreview(page, attachment, 'ready', reloadedDetail.viewerPreferences?.panelFocus)
    await downloadAndCompare(page, reloaded, image)
  }

  const legacyBytes = imageFixture()
  const legacySnapshot = { mimeType: 'image/png', data: legacyBytes.toString('base64'), width: 160, height: 80, byteLength: legacyBytes.byteLength }
  const uploaded = await page.request.post('/api/v1/image-assets', { data: legacySnapshot })
  expect(uploaded.ok(), 'a normalized-only legacy upload remains accepted').toBe(true)
  const legacyRef = await uploaded.json() as AssetRef
  expect(legacyRef.originalByteLength).toBeUndefined()
  expect((await page.request.get(`/api/v1/image-assets/${encodeURIComponent(legacyRef.id)}/original?metadata=1`)).status()).toBe(404)
  const detail = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)).json() as { workspace: Record<string, unknown> & { attachments: SavedAttachment[] } }
  const legacyAttachmentId = `legacy-${randomUUID()}`
  const patched = await page.request.patch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/context-state`, { data: {
    operations: [], workspace: { ...detail.workspace, attachments: [...detail.workspace.attachments, {
      id: legacyAttachmentId, label: 'legacy.png', kind: 'photo',
      source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' }, image: legacyRef,
    }] },
  } })
  expect(patched.ok(), 'the normalized-only image is attached as a legacy reference').toBe(true)
  await page.reload()
  const legacyAttachment: SavedAttachment = { id: legacyAttachmentId, label: 'legacy.png', kind: 'photo', image: legacyRef }
  const legacyPreview = await selectAttachmentPreview(page, legacyAttachment)
  await expect(legacyPreview).toContainText('No original was retained for this older import.')
  await expect(legacyPreview.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0)
})

test('original download is private to the owner across shared, foreign, and legacy views', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createOwnerSession(page)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const image = localImages[0]!
  const attachment = await selectLocalImage(page, image, sessionId)
  const preview = await openPreview(page, attachment)
  const imageId = attachment.image!.id
  const grant = await page.request.post('/api/v1/grants', { data: {
    subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
  } })
  expect(grant.ok(), 'the owner grants a read-only shared view').toBe(true)

  const shared = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    await shared.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const sharedPreview = await selectAttachmentPreview(shared.page, attachment)
    await expect(sharedPreview.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0)
    await expect(sharedPreview.locator('[data-image-original]')).toHaveCount(0)
    await expect(sharedPreview).toContainText('Saved image. Included when the conversation owner sends a turn using an image-capable model and connection.')
    expect((await shared.page.request.get(`/api/v1/image-assets/${encodeURIComponent(imageId)}/original?metadata=1`)).status()).toBe(404)
    for (const viewport of VIEWPORTS) {
      await shared.page.setViewportSize(viewport)
      await settledAttachmentPreview(shared.page)
      await expect.poll(() => shared.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertWcag22Aa(shared.page, `shared image original ${viewport.width}x${viewport.height}`)
      await shared.page.screenshot({ path: `.data/image-original-review/shared-${viewport.width}x${viewport.height}.png`, fullPage: true })
    }

    const denied = foreign.page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}`)
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await denied).status()).toBe(404)
    expect((await foreign.page.request.get(`/api/v1/image-assets/${encodeURIComponent(imageId)}/original?metadata=1`)).status()).toBe(404)
    expect((await foreign.page.request.get(`/api/v1/image-assets/${encodeURIComponent(imageId)}/original`)).status()).toBe(404)
    await expect(foreign.page.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0)
  } finally {
    await shared.context.close(); await foreign.context.close()
  }
  await expect(preview.getByRole('button', { name: 'Download original', exact: true })).toBeVisible()
})

test('owner original availability failure has accessible retry and recovers at every viewport', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createOwnerSession(page)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const image = localImages[2]!
  const matcher = (url: URL) => url.pathname.startsWith('/api/v1/image-assets/') && url.pathname.endsWith('/original') && url.searchParams.get('metadata') === '1'
  const routeMatcher = (url: URL) => matcher(url)
  const reject = async (route: Route) => route.abort()
  await page.route(routeMatcher, reject)
  const attachment = await selectLocalImage(page, image, sessionId)
  const preview = await openPreview(page, attachment, 'failed')
  await expect(preview.locator('[data-image-original]')).toHaveAttribute('data-image-original', 'failed')
  await captureOriginalSurface(page, preview, 'error', 'owner-error')
  await page.unroute(routeMatcher, reject)
  await preview.getByRole('button', { name: 'Retry original availability', exact: true }).click()
  await expect(preview.locator('[data-image-original]')).toHaveAttribute('data-image-original', 'ready', { timeout: ms(20_000) })
  await captureOriginalSurface(page, preview, 'ready', 'owner-ready')
})

test('a failed original body GET can be retried without changing the selected image', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createOwnerSession(page)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const image = localImages[1]!
  const attachment = await selectLocalImage(page, image, sessionId)
  const preview = await openPreview(page, attachment)
  const originalPath = `/api/v1/image-assets/${attachment.image!.id}/original`
  const routeMatcher = (url: URL) => url.pathname === originalPath && !url.search
  const reject = async (route: Route) => route.abort()
  await page.route(routeMatcher, reject)
  await preview.getByRole('button', { name: 'Download original', exact: true }).click()
  await expect(preview.getByRole('alert')).toContainText('Could not download the original. Try again.')
  await expect(preview.getByRole('button', { name: 'Download original', exact: true })).toBeEnabled()
  await page.unroute(routeMatcher, reject)
  await downloadAndCompare(page, preview, image)
})

test('a revoked original discovered by a body 404 becomes unavailable after metadata admission', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createOwnerSession(page)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const image = localImages[0]!
  const attachment = await selectLocalImage(page, image, sessionId)
  const preview = await openPreview(page, attachment)
  const originalPath = `/api/v1/image-assets/${attachment.image!.id}/original`
  const routeMatcher = (url: URL) => url.pathname === originalPath && !url.search
  const revoked = async (route: Route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'Original image is unavailable.' } }) })
  await page.route(routeMatcher, revoked)
  await preview.getByRole('button', { name: 'Download original', exact: true }).click()
  await expect(preview.locator('[data-image-original]')).toHaveAttribute('data-image-original', 'unavailable')
  await expect(preview.getByText('The original is not available to this account.', { exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0)
  await page.unroute(routeMatcher, revoked)
})

test('a delayed original response cannot download after selection or account changes', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const sessionId = await createOwnerSession(page)
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const first = localImages[2]!
  const firstAttachment = await selectLocalImage(page, first, sessionId)
  const second: LocalImage = { ...localImages[0]!, name: 'second.svg' }
  const secondAttachment = await selectLocalImage(page, second, sessionId)
  const preview = await openPreview(page, firstAttachment)
  const originalPath = `/api/v1/image-assets/${firstAttachment.image!.id}/original`
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const requested = new Promise<void>((resolve) => { entered = resolve })
  const hold = async (route: Route) => {
    entered()
    await gate
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: firstAttachment.image!.id,
        original: { name: first.name, data: first.bytes.toString('base64'), byteLength: first.bytes.byteLength },
      }) })
    } catch { /* the selection change can abort this request before release */ }
  }
  const routeMatcher = (url: URL) => url.pathname === originalPath && !url.search
  let originalRequestSettled = false
  let downloaded = false
  const settleOriginal = (request: Request) => { if (new URL(request.url()).pathname === originalPath) originalRequestSettled = true }
  const onDownload = () => { downloaded = true }
  page.on('requestfinished', settleOriginal)
  page.on('requestfailed', settleOriginal)
  page.on('download', onDownload)
  await page.route(routeMatcher, hold)
  await preview.getByRole('button', { name: 'Download original', exact: true }).click()
  await requested
  await preview.getByTitle(second.name, { exact: true }).click()
  const secondPreview = page.locator(`[data-attachment-preview="${secondAttachment.id}"]`).filter({ visible: true })
  await expect(secondPreview.locator('[data-image-original]')).toHaveAttribute('data-image-original', 'ready', { timeout: ms(20_000) })
  release()
  await expect.poll(() => originalRequestSettled, { message: 'the retired original request settles after the selection changes' }).toBe(true)
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 25)))
  expect(downloaded, 'changing the selected image retires its pending download').toBe(false)
  await page.unroute(routeMatcher, hold)
  page.off('requestfinished', settleOriginal); page.off('requestfailed', settleOriginal); page.off('download', onDownload)
})

test('a delayed original response is fenced by a real account switch', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const login = async (email: string, password: string) => {
    const response = await page.request.post('/api/v1/auth/login', { data: { email, password } })
    expect(response.ok()).toBe(true)
  }
  await login('ada@acme.example', 'ada-demo-password')
  await login('grace@acme.example', 'grace-demo-password')
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Account scoped image original' } })
  expect(created.ok()).toBe(true)
  const sessionId = (await created.json() as { id: string }).id
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  const image = localImages[0]!
  const attachment = await selectLocalImage(page, image, sessionId)
  const preview = await openPreview(page, attachment)
  const originalPath = `/api/v1/image-assets/${attachment.image!.id}/original`
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const requested = new Promise<void>((resolve) => { entered = resolve })
  const hold = async (route: Route) => {
    entered()
    await gate
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: attachment.image!.id,
        original: { name: image.name, data: image.bytes.toString('base64'), byteLength: image.bytes.byteLength },
      }) })
    } catch { /* the account switch can abort this request before release */ }
  }
  const routeMatcher = (url: URL) => url.pathname === originalPath && !url.search
  let originalRequestSettled = false
  let downloaded = false
  const settleOriginal = (request: Request) => { if (new URL(request.url()).pathname === originalPath) originalRequestSettled = true }
  const onDownload = () => { downloaded = true }
  page.on('requestfinished', settleOriginal)
  page.on('requestfailed', settleOriginal)
  page.on('download', onDownload)
  await page.route(routeMatcher, hold)
  await preview.getByRole('button', { name: 'Download original', exact: true }).click()
  await requested
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  release()
  await expect.poll(() => originalRequestSettled, { message: 'the old-account original request settles after switching accounts' }).toBe(true)
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 25)))
  expect(downloaded, 'account generation change retires the pending download').toBe(false)
  await page.unroute(routeMatcher, hold)
  page.off('requestfinished', settleOriginal); page.off('requestfailed', settleOriginal); page.off('download', onDownload)
})

test('served image capture also retains and downloads the exact source bytes', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createOwnerSession(page)
  const served: LocalImage & { path: string } = { ...localImages[0]!, name: 'served-source.svg', path: 'projects/served-source.svg' }
  await page.route('**/api/v1/fs/sources', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'cloud', kind: 'cloud', label: 'Cloud storage' }]) }))
  await page.route('**/api/v1/fs/catalog?*', (route) => {
    const source = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      source, files: [{ id: served.path, name: served.name, ext: 'svg', size: served.bytes.byteLength, mtime: 1, kind: 'image' }], photos: [], folders: [],
    }) })
  })
  await page.route('**/api/v1/fs/content?*', (route) => route.fulfill({ status: 200, contentType: served.mimeType, body: served.bytes }))
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  await picker.getByRole('button', { name: 'Cloud storage', exact: true }).click()
  const servedRow = picker.getByRole('button', { name: /^served-source\.svg\b/ }).first()
  await expect(servedRow).toBeVisible()
  await servedRow.click()
  await expect.poll(async () => {
    const detail = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)).json() as { workspace: { attachments: SavedAttachment[] } }
    const attachment = detail.workspace.attachments.find((item) => item.label === served.name)
    return attachment?.imageSnapshot?.image.originalByteLength ?? 0
  }, { timeout: ms(20_000) }).toBe(served.bytes.byteLength)
  const detail = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)).json() as { workspace: { attachments: SavedAttachment[] } }
  const attachment = detail.workspace.attachments.find((item) => item.label === served.name)!
  expect(attachment.kind, 'the import remains on the Files surface').toBe('file')
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  const selectedPreview = page.locator(`[data-attachment-preview="${attachment.id}"]`)
  await expect(selectedPreview).toBeVisible({ timeout: ms(20_000) })
  const preview = await openPreview(page, attachment)
  await captureOriginalSurface(page, preview, 'ready', 'files-owner-ready')
  await downloadAndCompare(page, preview, served)
})
