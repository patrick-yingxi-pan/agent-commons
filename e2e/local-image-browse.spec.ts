import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { svgFixture } from '../tests/helpers/svgFixture.mjs'
import { iconFixture } from '../tests/helpers/bitmapFixture.mjs'
import { assertWcag22Aa, settledAttachmentPreview, settledOpaquePaint } from './accessibility-helpers.ts'
import { API, createProject, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const FOLDER = `LOCAL_${'F'.repeat(32)}`
const GIT = `GIT_${'F'.repeat(32)}`
const NAME = 'Image browse fixture'
const PNG = 'design/long-folder-name-for-complete-relative-paths/reviewed-image.png'
const SVG = 'design/reviewed-vector.svg'
const ICO = 'design/new-icon.ico'
const INVALID = 'design/active.svg'
const LARGE = 'design/oversized.png'
const png = imageFixture(2400, 1200)
const svg = svgFixture(480, 240)
const ico = iconFixture()
const raw = { [PNG]: png, [SVG]: svg, [ICO]: ico,
  [INVALID]: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><script>alert(1)</script></svg>') }
type Source = 'folder' | 'git' | 'git-untracked'
const sources: Source[] = ['folder', 'git', 'git-untracked']
const viewports = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]
const browserSelector = (source: Source) => `[data-local-${source}-browser]`
const previewSelector = (source: Source) => `[data-local-${source}-file-preview]`
const listLabel = (source: Source) => source === 'folder' ? 'List folder paths' : source === 'git' ? 'List tracked paths' : 'List untracked paths'
const listName = (source: Source) => source === 'folder' ? 'Folder paths' : source === 'git' ? 'Tracked repository paths' : 'Untracked repository paths'
const rowSuffix = (source: Source) => source === 'folder' ? 'File' : source === 'git' ? 'Tracked file' : 'Untracked file'

async function fixture(page: Page) {
  await page.addInitScript(({ folder, git, name, files, oversized }) => {
    const state: any = { lists: [], reads: [], snapshots: 0, files, connected: true, heldPath: null, release: null }
    Object.defineProperty(window, '__localImageBrowse', { value: state })
    const entries = [...Object.keys(files), oversized].sort().map(path => ({ path, kind: 'file' }))
    const make = (sourceKind: string, id: string) => {
      const listing = (untracked = false) => ({ version: 1, ...(sourceKind === 'folder'
        ? { visited: entries.length + 2, hiddenCount: 0, directoryCount: 2 }
        : { excludedCount: 0, ...(untracked ? { scope: 'untracked' } : {}) }), files: entries })
      const read = async (input: any, source: any, untracked = false) => {
        if (source?.userId !== 'user-ada' || (untracked && (input.scope !== 'untracked' || !input.operationId))) throw new Error('Wrong principal or scope')
        state.reads.push({ source: untracked ? 'git-untracked' : sourceKind, path: input.path })
        if (input.path === state.heldPath) await new Promise(resolve => { state.release = resolve })
        return { version: 1, ...(untracked ? { scope: 'untracked' } : {}), path: input.path,
          sizeBytes: input.path === oversized ? 8 * 1024 * 1024 + 1 : state.files[input.path].length,
          snapshot: input.path === oversized ? { omitted: 'too-large' } : { image: { bytes: new Uint8Array(state.files[input.path]) } } }
      }
      return {
        list: async (source: any) => source?.userId === 'user-ada' && state.connected ? [{ id, name, remembered: true }] : [],
        connect: async () => { throw new Error('No reconnection') },
        disconnect: async () => { state.connected = false },
        files: async () => { state.lists.push(sourceKind); return listing() },
        file: async (_id: string, input: any, source: any) => read(input, source),
        untrackedFiles: async (_id: string, input: any) => {
          if (input.scope !== 'untracked' || !input.operationId) throw new Error('Missing explicit scope')
          state.lists.push('git-untracked'); return listing(true)
        },
        untrackedFile: async (_id: string, input: any, source: any) => read(input, source, true),
        cancelUntrackedRead: async () => {},
        snapshot: async () => { state.snapshots++; throw new Error('No bulk capture') },
        review: async () => { throw new Error('No Git review') },
      }
    }
    Object.defineProperty(window, 'agentCommonsDesktop', { value: { context: {
      localFolders: make('folder', folder), localGit: make('git', git),
    } } })
  }, { folder: FOLDER, git: GIT, name: NAME, files: Object.fromEntries(Object.entries(raw).map(([path, bytes]) => [path, [...bytes]])), oversized: LARGE })
}

async function openPicker(page: Page, source: Source) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: source === 'folder' ? /^Folder/ : /^Repository/ }).click()
  if (source === 'folder') await dialog.getByRole('button', { name: 'This computer', exact: true }).click()
  await dialog.getByRole('button', { name: `Browse files in ${NAME}`, exact: true }).click()
  if (source === 'git-untracked') {
    const toggle = dialog.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
    if (!(await toggle.isChecked())) await toggle.check()
  }
  return { dialog, browser: dialog.locator(browserSelector(source)) }
}

async function select(browser: Locator, source: Source, path: string) {
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(path)
  await browser.getByRole('list', { name: listName(source), exact: true })
    .getByRole('button', { name: `${path} ${rowSuffix(source)}`, exact: true }).press('Enter')
  const preview = browser.locator(previewSelector(source))
  return { preview, image: preview.getByRole('img', { name: `Preview of ${path}`, exact: true }) }
}

async function matrix(page: Page, browser: Locator, image: Locator, info: TestInfo, label: string, settle?: () => Promise<void>) {
  for (const size of viewports) {
    await page.setViewportSize(size)
    await settle?.()
    await image.scrollIntoViewIfNeeded()
    await settledOpaquePaint(image)
    await expect(image).toBeInViewport()
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `${label} ${size.width}x${size.height}`)
    await page.screenshot({ path: info.outputPath(`${label}-${size.width}x${size.height}.png`) })
  }
  await page.setViewportSize(viewports[4])
}

async function emptySession(page: Page) {
  const response = await page.request.post(`${API}/sessions`, { data: {} })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).id as string
}

test('connected Folder, tracked Git and untracked Git images attach only the exact locally reviewed copy', async ({ page, browser: browserEngine }, info) => {
  test.setTimeout(ms(180_000))
  await fixture(page)
  const id = await emptySession(page)
  await page.goto(`/s/${id}`)
  const uploads: any[] = []
  const sends: string[] = []
  page.on('request', request => {
    if (request.method() !== 'POST') return
    if (new URL(request.url()).pathname.endsWith('/image-assets')) uploads.push(request.postDataJSON())
    if (new URL(request.url()).pathname.endsWith('/messages')) sends.push(request.url())
  })
  const saved: any[] = []
  for (const [index, source] of sources.entries()) {
    const path = [PNG, SVG, ICO][index]
    const { dialog, browser } = await openPicker(page, source)
    await browser.getByRole('button', { name: listLabel(source), exact: true }).click()
    expect(await page.evaluate(() => (window as any).__localImageBrowse.reads.length)).toBe(index)
    const { image } = await select(browser, source, path)
    await expect(image).toBeVisible({ timeout: ms(20_000) })
    const dataUrl = (await image.getAttribute('src'))!
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(uploads).toHaveLength(index, 'preview never uploads')
    expect(sends).toEqual([], 'preview and attachment never dispatch a model turn')
    await matrix(page, browser, image, info, `conversation-${source}`)
    await page.evaluate(path => { (window as any).__localImageBrowse.files[path] = [1, 2, 3] }, path)
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled({ timeout: ms(20_000) })
    await expect(dialog).toContainText(source === 'git-untracked' ? '2 added' : '1 added')
    expect(uploads).toHaveLength(index + 1)
    expect(uploads[index].image.data).toBe(dataUrl.split(',')[1])
    expect(uploads[index].original.data).toBe(raw[path].toString('base64'))
    expect(uploads[index].original.name).toBe(path.split('/').at(-1))
    const state = await (await page.request.get(`${API}/sessions/${id}`)).json()
    const attachment = state.workspace.attachments.find((item: any) => item.label === path)
    expect(attachment.kind).toBe('photo')
    expect(attachment.image.mimeType).toBe('image/png')
    expect(attachment.image.width).toBeLessThanOrEqual(2000)
    expect(attachment.image.originalByteLength).toBe(raw[path].length)
    expect(attachment.previewText).toBeUndefined()
    expect(JSON.stringify(attachment)).not.toContain(uploads[index].original.data)
    const content = await page.request.get(`${API}/image-assets/${attachment.image.id}/content`)
    expect(content.ok()).toBe(true)
    expect((await content.body()).toString('base64')).toBe(uploads[index].image.data)
    saved.push(attachment)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  }
  expect(await page.evaluate(() => (window as any).__localImageBrowse.reads.length)).toBe(3)
  expect(await page.evaluate(() => (window as any).__localImageBrowse.snapshots)).toBe(0)
  expect(sends).toEqual([])
  await page.reload()
  const after = await (await page.request.get(`${API}/sessions/${id}`)).json()
  expect(after.workspace.attachments).toEqual(saved)
  expect(await page.evaluate(() => (window as any).__localImageBrowse.reads)).toEqual([])
  await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
  await page.getByLabel('Audience id').fill('tenant-beta')
  await page.getByRole('button', { name: /Share|Publish/ }).last().click()
  const viewer = await newUser(browserEngine, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    await viewer.page.goto(`/s/${id}`)
    await expect(viewer.page.getByTitle('Photos (3)', { exact: true })).toBeVisible()
    await viewer.page.getByTitle('Photos (3)', { exact: true }).click()
    await viewer.page.getByRole('menu', { name: 'Photos', exact: true }).getByRole('button', { name: PNG, exact: true }).click()
    const preview = viewer.page.locator(`[data-attachment-preview="${saved[0].id}"]`)
    // PhotoThumb's image is decorative inside the named preview region;
    // the full-size image, not its navigation thumbnails, proves content loaded.
    const sharedImage = preview.locator('img.object-contain')
    await expect(sharedImage).toBeVisible()
    await matrix(viewer.page, preview, sharedImage, info, 'shared-photo',
      () => settledAttachmentPreview(viewer.page, `[data-attachment-preview="${saved[0].id}"]`))
    await expect(viewer.page.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0)
    await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    expect((await viewer.page.request.get(`${API}/image-assets/${saved[0].image.id}/original`)).status()).toBe(404)
  } finally { await viewer.context.close() }
  const foreign = await newUser(browserEngine, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    expect((await foreign.page.request.get(`${API}/sessions/${id}`)).status()).toBe(404)
    expect((await foreign.page.request.get(`${API}/image-assets/${saved[0].image.id}/content`)).status()).toBe(404)
  } finally { await foreign.context.close() }
})

test('canonical Folder and Git details preview images at every viewport without attachment authority', async ({ page }, info) => {
  test.setTimeout(ms(180_000))
  await fixture(page)
  for (const source of sources) {
    await page.goto(`/contexts/${source === 'folder' ? FOLDER : GIT}`)
    if (source === 'git-untracked') await page.getByRole('checkbox', { name: 'Browse untracked files', exact: true }).check()
    const browser = page.locator(browserSelector(source))
    await browser.getByRole('button', { name: listLabel(source), exact: true }).click()
    const { image } = await select(browser, source, PNG)
    await expect(image).toBeVisible({ timeout: ms(20_000) })
    await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
    await matrix(page, browser, image, info, `canonical-${source}`)
  }
})

test('Project source image preview remains read-only at every viewport', async ({ page }, info) => {
  test.setTimeout(ms(180_000))
  await fixture(page)
  await page.goto('/')
  await createProject(page, `Image source review ${Date.now()}`)
  const context = page.locator('section[class~="group/section"]').filter({ has: page.locator('[data-section-title]', { hasText: /^Context$/i }) })
  const heading = context.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click()
  for (const source of sources) {
    const { dialog, browser } = await openPicker(page, source)
    await browser.getByRole('button', { name: listLabel(source), exact: true }).click()
    const { image } = await select(browser, source, SVG)
    await expect(image).toBeVisible({ timeout: ms(20_000) })
    await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
    await matrix(page, browser, image, info, `project-${source}`)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  }
  expect(await page.evaluate(() => (window as any).__localImageBrowse.snapshots)).toBe(0)
})

test('invalid and oversized local images cannot attach and Dismiss fences a late selected image', async ({ page }) => {
  test.setTimeout(ms(75_000))
  await fixture(page)
  const id = await emptySession(page)
  await page.goto(`/s/${id}`)
  const uploads: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/image-assets')) uploads.push(request.url()) })
  const { browser } = await openPicker(page, 'folder')
  await browser.getByRole('button', { name: listLabel('folder'), exact: true }).click()
  for (const path of [INVALID, LARGE]) {
    const { preview } = await select(browser, 'folder', path)
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('status')).toContainText(path === LARGE ? /8 MiB|8 MB/ : /could not|not supported|invalid/i)
    await expect(preview.getByRole('img')).toHaveCount(0)
    await expect(preview.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  }
  await page.evaluate(path => { (window as any).__localImageBrowse.heldPath = path }, PNG)
  await select(browser, 'folder', PNG)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localImageBrowse.release)).toBe('function')
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.evaluate(() => (window as any).__localImageBrowse.release())
  await expect(browser.getByRole('button', { name: listLabel('folder'), exact: true })).toBeEnabled()
  await expect(browser.locator(previewSelector('folder'))).toHaveCount(0)
  expect(uploads).toEqual([])
  const saved = await (await page.request.get(`${API}/sessions/${id}`)).json()
  expect(saved.workspace.attachments).toEqual([])
})

test('pending image upload survives picker remount and retry reuses the exact reviewed bytes', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await fixture(page)
  const id = await emptySession(page)
  await page.goto(`/s/${id}`)
  const { dialog, browser } = await openPicker(page, 'folder')
  await browser.getByRole('button', { name: listLabel('folder'), exact: true }).click()
  const { image } = await select(browser, 'folder', PNG)
  await expect(image).toBeVisible({ timeout: ms(20_000) })
  const shown = await image.getAttribute('src')
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const uploads: any[] = []
  await page.route('**/api/v1/image-assets', async route => {
    uploads.push(route.request().postDataJSON())
    if (uploads.length !== 1) return route.continue()
    // Persist the asset, then lose acknowledgement. Retry must not reread or
    // renormalize a changed source, even though no context was submitted yet.
    await route.fetch()
    await held
    await route.fulfill({ status: 503, json: { error: 'test-owned lost upload acknowledgement' } })
  })
  try {
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect.poll(() => uploads.length).toBe(1)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const reopened = await openPicker(page, 'folder')
    await expect(reopened.browser.getByRole('button', { name: 'Saving saved copy…', exact: true })).toBeDisabled()
    await page.evaluate(path => { (window as any).__localImageBrowse.files[path] = [0, 1] }, PNG)
    release()
    await expect(reopened.browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
    await expect(reopened.browser.getByRole('alert')).toContainText('Could not confirm this saved copy')
    await reopened.browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect(reopened.browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    expect(uploads).toHaveLength(2)
    expect(uploads[1]).toEqual(uploads[0])
    expect(uploads[1].image.data).toBe(shown!.split(',')[1])
    expect(await page.evaluate(() => (window as any).__localImageBrowse.reads.length)).toBe(1)
    const saved = await (await page.request.get(`${API}/sessions/${id}`)).json()
    expect(saved.workspace.attachments).toHaveLength(1)
    expect(saved.workspace.attachments[0].kind).toBe('photo')
  } finally { release(); await page.unroute('**/api/v1/image-assets') }
})

test('dismissing the reviewed image cancels pre-context upload publication', async ({ page }) => {
  test.setTimeout(ms(75_000))
  await fixture(page)
  const id = await emptySession(page)
  await page.goto(`/s/${id}`)
  const { browser } = await openPicker(page, 'git-untracked')
  await browser.getByRole('button', { name: listLabel('git-untracked'), exact: true }).click()
  const { image } = await select(browser, 'git-untracked', ICO)
  await expect(image).toBeVisible({ timeout: ms(20_000) })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started = false
  let completed = false
  const contextPosts: string[] = []
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/context-state')) contextPosts.push(request.url()) })
  await page.route('**/api/v1/image-assets', async route => {
    const response = await route.fetch()
    started = true
    await held
    await route.fulfill({ response }).catch(() => {})
    completed = true
  })
  try {
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect.poll(() => started).toBe(true)
    await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
    release()
    await expect.poll(() => completed).toBe(true)
    await expect(browser.locator(previewSelector('git-untracked'))).toHaveCount(0)
    await expect(browser.getByRole('button', { name: listLabel('git-untracked'), exact: true })).toBeEnabled()
    const saved = await (await page.request.get(`${API}/sessions/${id}`)).json()
    expect(saved.workspace.attachments).toEqual([])
    expect(contextPosts).toEqual([])
  } finally { release(); await page.unroute('**/api/v1/image-assets') }
})
