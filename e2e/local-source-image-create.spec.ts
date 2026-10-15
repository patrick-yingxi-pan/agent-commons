/** Selected local images enter an explicit, local OCR document review. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { isLocalConnectionId } from '../contract/localFolderCapture.ts'
import { isLocalGitConnectionId } from '../contract/localGitCapture.ts'
import { parseLocalFolderFileListing } from '../contract/localFolderBrowse.mjs'
import { parseLocalGitFileListing } from '../contract/localGitBrowse.mjs'
import { assertWcag22Aa, settledOpaquePaint } from './accessibility-helpers.ts'
import { API } from './social-helpers.ts'
import { ms } from './budget.ts'

const FOLDER = `LOCAL_${'F'.repeat(32)}`
const GIT = `GIT_${'F'.repeat(32)}`
const PATH = `images/ocr-review-${Date.now().toString(36)}.png`
const RAW = [...imageFixture(2400, 1200)]
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const
type Source = 'folder' | 'git' | 'git-untracked'
const SOURCES: Source[] = ['folder', 'git', 'git-untracked']
const selector = (source: Source) => `[data-local-${source}-browser]`
const previewSelector = (source: Source) => `[data-local-${source}-file-preview]`
const listAction = (source: Source) => source === 'folder' ? 'List folder paths' : source === 'git' ? 'List tracked paths' : 'List untracked paths'
const listingName = (source: Source) => source === 'folder' ? 'Folder paths' : source === 'git' ? 'Tracked repository paths' : 'Untracked repository paths'
const rowName = (source: Source) => source === 'folder' ? 'File' : source === 'git' ? 'Tracked file' : 'Untracked file'

async function installFixture(page: Page, withOcr = true) {
  const entries = [{ path: PATH, kind: 'file' as const }]
  const folderListing = { version: 1, visited: entries.length + 1, hiddenCount: 0, directoryCount: 1, files: entries }
  const gitListing = { version: 1, excludedCount: 0, files: entries }
  expect(isLocalConnectionId(FOLDER)).toBe(true)
  expect(isLocalGitConnectionId(GIT)).toBe(true)
  expect(parseLocalFolderFileListing(folderListing)).toEqual(folderListing)
  expect(parseLocalGitFileListing(gitListing)).toEqual(gitListing)
  await page.addInitScript(({ folderId, gitId, folderListing, gitListing, path, raw, withOcr: hasOcr }) => {
    const state: any = { reads: [], lists: [], snapshots: 0, files: { [path]: raw }, recognition: [], cancellations: [], connected: true }
    Object.defineProperty(window, '__localImageCreate', { configurable: true, value: state })
    const makeSource = (id: string, kind: Source, listing: any) => ({
      list: async (auth: any) => auth?.userId === 'user-ada' && state.connected
        ? [{ id, name: 'Image OCR fixture', remembered: true }] : [],
      connect: async () => { throw new Error('image OCR review must not reconnect') },
      files: async (sourceId: string, auth: any) => {
        if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong image source listing')
        state.lists.push(kind)
        return structuredClone(listing)
      },
      file: async (sourceId: string, input: any, auth: any) => read(sourceId, input, auth, kind),
      untrackedFiles: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== gitId || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked listing')
        state.lists.push('git-untracked')
        return { ...structuredClone(gitListing), scope: 'untracked' }
      },
      untrackedFile: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== gitId || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked read')
        return read(sourceId, input, auth, 'git-untracked')
      },
      cancelUntrackedRead: async () => true,
      snapshot: async () => { state.snapshots++; throw new Error('image OCR never captures a source snapshot') },
      review: async () => { throw new Error('image OCR never reads Git review state') },
      disconnect: async () => { state.connected = false },
    })
    function read(sourceId: string, input: any, auth: any, kind: Source) {
      if (sourceId !== (kind === 'folder' ? folderId : gitId) || auth?.userId !== 'user-ada' || input?.path !== path) throw new Error('wrong image source read')
      state.reads.push({ source: kind, path: input.path })
      const bytes = state.files[path]
      return { version: 1, ...(kind === 'git-untracked' ? { scope: 'untracked' } : {}), path,
        sizeBytes: bytes.length, snapshot: { image: { bytes: new Uint8Array(bytes) } } }
    }
    const desktop: any = { context: {
      localFolders: makeSource(folderId, 'folder', folderListing),
      localGit: makeSource(gitId, 'git', gitListing),
    } }
    if (hasOcr) desktop.imageOcr = {
      recognize: (operationId: string, bytes: Uint8Array) => new Promise(resolve => state.recognition.push({ operationId, bytes: Array.from(bytes), resolve })),
      cancel: async (operationId: string) => { state.cancellations.push(operationId); return true },
    }
    Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: desktop })
  }, { folderId: FOLDER, gitId: GIT, folderListing, gitListing, path: PATH, raw: RAW, withOcr })
}

async function signIntoAdaAndGrace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  for (const [email, password] of [
    ['ada@acme.example', 'ada-demo-password'], ['grace@acme.example', 'grace-demo-password'],
  ]) {
    const response = await page.request.post(`${API}/auth/login`, { data: { email, password } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace')
}

async function switchAccount(page: Page, name: string) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(name)
}

async function switchAccountBehindDialog(page: Page, name: string) {
  await page.getByTestId('account-chip').dispatchEvent('click')
  const option = page.getByTestId('account-stack-option').filter({ hasText: name }).first()
  await expect(option).toBeAttached()
  await option.dispatchEvent('click')
  await expect(page.getByTestId('account-chip')).toContainText(name)
}

async function selectImage(page: Page, source: Source) {
  await page.goto(`/contexts/${source === 'folder' ? FOLDER : GIT}`)
  if (source === 'git-untracked') await page.getByRole('checkbox', { name: 'Browse untracked files', exact: true }).check()
  const browser = page.locator(selector(source))
  const listing = browser.locator(`[data-local-${source}-browser-listing]`)
  if (!(await listing.isVisible())) await browser.getByRole('button', { name: listAction(source), exact: true }).click()
  await expect(listing).toBeVisible()
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(PATH)
  await browser.getByRole('list', { name: listingName(source), exact: true })
    .getByRole('button', { name: `${PATH} ${rowName(source)}`, exact: true }).click()
  const preview = browser.locator(previewSelector(source))
  const image = preview.getByRole('img', { name: `Preview of ${PATH}`, exact: true })
  await expect(image).toBeVisible({ timeout: ms(20_000) })
  return { browser, preview, image }
}

async function fiveViewportReview(page: Page, subject: Locator, anchor: Locator, info: TestInfo, label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await anchor.scrollIntoViewIfNeeded()
    await settledOpaquePaint(anchor)
    await expect(anchor).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => subject.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const box = await subject.boundingBox()
    expect(box, `${label} is laid out at ${viewport.width}x${viewport.height}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
    if (await subject.getAttribute('role') === 'dialog') {
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize(VIEWPORTS[4])
}

async function resolveRecognition(page: Page, result: unknown, index = -1) {
  await page.evaluate(({ result, index }) => (window as any).__localImageCreate.recognition.at(index).resolve(result), { result, index })
}

function contentWrites(writes: Array<{ method: string; pathname: string; body: string }>) {
  return writes.filter(write => /(?:artifacts|image-assets|messages|generate|model|upload)/i.test(write.pathname))
}

async function openNestedFolderImage(page: Page) {
  const made = await page.request.post(`${API}/sessions`, { data: {} })
  expect(made.ok(), await made.text()).toBe(true)
  await page.goto(`/s/${(await made.json()).id}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Folder/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  await picker.getByRole('button', { name: 'Browse files in Image OCR fixture', exact: true }).click()
  const browser = picker.locator('[data-local-folder-browser]')
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(PATH)
  await browser.getByRole('list', { name: 'Folder paths', exact: true })
    .getByRole('button', { name: `${PATH} File`, exact: true }).click()
  const preview = browser.locator('[data-local-folder-file-preview]')
  await expect(preview.getByRole('img', { name: `Preview of ${PATH}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  return { picker, browser, preview }
}

test('Folder, tracked Git and opted-in untracked Git images start an explicit OCR document draft from the captured normalized PNG', async ({ page }, info) => {
  test.setTimeout(ms(180_000))
  await installFixture(page)
  await signIntoAdaAndGrace(page)
  const writes: Array<{ method: string; pathname: string; body: string }> = []
  page.on('request', request => {
    if (!request.url().includes('/api/v1/') || !['POST', 'PUT', 'PATCH'].includes(request.method())) return
    writes.push({ method: request.method(), pathname: new URL(request.url()).pathname, body: request.postData() ?? '' })
  })

  for (const [index, source] of SOURCES.entries()) {
    const { browser, preview, image } = await selectImage(page, source)
    const shown = await image.getAttribute('src')
    expect(shown).toMatch(/^data:image\/png;base64,/)
    const readCount = await page.evaluate(() => (window as any).__localImageCreate.reads.length)
    expect(await page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(0)
    const extract = browser.getByRole('button', { name: 'Extract text to new document', exact: true })
    await expect(extract).toBeEnabled()
    if (index === 0) await fiveViewportReview(page, browser, extract, info, 'local-image-folder-preview')

    // The next explicit action must use this captured normalized preview, even
    // if the underlying path changes after the preview was rendered.
    await page.evaluate(({ path, replacement }) => { (window as any).__localImageCreate.files[path] = replacement },
      { path: PATH, replacement: [7, 6, 5, 4, 3] })
    const writesBefore = writes.length
    const recognitionBefore = await page.evaluate(() => (window as any).__localImageCreate.recognition.length as number)
    await extract.click()
    const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('status')).toContainText(/recogniz.*this Mac/i)
    await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(recognitionBefore + 1)
    const captured = await page.evaluate(() => (window as any).__localImageCreate.recognition.at(-1) as { operationId: string; bytes: number[] })
    expect(captured.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    const normalized = Buffer.from(shown!.slice('data:image/png;base64,'.length), 'base64')
    expect(captured.bytes).toEqual([...normalized])
    expect(captured.bytes).not.toEqual(RAW)
    await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => (window as any).__localImageCreate.reads.length)).toBe(readCount)
    expect(writes.slice(writesBefore), 'OCR review does not upload, call a model, or save a draft').toEqual([])

    const recognized = `Recognized local image ${index + 1}.`
    await resolveRecognition(page, { status: 'ready', text: recognized })
    const imported = dialog.getByRole('textbox', { name: 'Imported text', exact: true })
    await expect(imported).toHaveValue(recognized)
    await expect(imported).toHaveAttribute('readonly', '')
    await expect(dialog.getByRole('button', { name: 'Use imported text', exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('')
    if (index === 0) await fiveViewportReview(page, dialog, imported, info, 'local-image-ocr-review')
    await dialog.getByRole('button', { name: 'Use imported text', exact: true }).click()
    const content = dialog.getByLabel('Content', { exact: true })
    await expect(content).toBeFocused()
    await expect(content).toHaveValue(recognized)
    const correction = `${recognized}\n\nReviewed and edited by Ada.`
    await content.fill(correction)
    expect(writes.slice(writesBefore), 'imported text stays local until Create').toEqual([])
    await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
    const createWrites = writes.slice(writesBefore).filter(write => write.pathname === '/api/v1/artifacts')
    expect(createWrites).toHaveLength(1)
    expect(JSON.parse(createWrites[0]!.body).body).toBe(correction)
    expect(writes.slice(writesBefore).every(write => ['/api/v1/artifacts', '/api/v1/social/viewed'].includes(write.pathname))).toBe(true)
    expect(createWrites[0]!.body).not.toContain(PATH)
    expect(createWrites[0]!.body).not.toContain(Buffer.from(RAW).toString('base64'))
    expect(createWrites[0]!.body).not.toContain(shown!)
    expect(await page.evaluate(() => (window as any).__localImageCreate.snapshots)).toBe(0)
  }
})

test('no-text OCR stays honest, Escape and account switches fence late local results, and discarded seeds stay discarded', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await installFixture(page)
  await signIntoAdaAndGrace(page)
  const { picker, browser, preview } = await openNestedFolderImage(page)
  const writes: Array<{ method: string; pathname: string; body: string }> = []
  page.on('request', request => {
    if (!request.url().includes('/api/v1/') || !['POST', 'PUT', 'PATCH'].includes(request.method())) return
    writes.push({ method: request.method(), pathname: new URL(request.url()).pathname, body: request.postData() ?? '' })
  })

  await browser.getByRole('button', { name: 'Extract text to new document', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(1)
  await resolveRecognition(page, { status: 'ready', text: 'A candidate text that will be discarded.' })
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveValue('A candidate text that will be discarded.')
  await dialog.getByLabel('Name', { exact: true }).fill('kept-image-name.md')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await dialog.getByLabel('Format').selectOption('sheet')
  await dialog.getByLabel('Format').selectOption('doc')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('kept-image-name.md')
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(1)
  expect(contentWrites(writes)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(picker).toBeVisible()
  await expect(preview.getByRole('img', { name: `Preview of ${PATH}`, exact: true })).toBeVisible()

  await browser.getByRole('button', { name: 'Extract text to new document', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(2)
  await resolveRecognition(page, { status: 'no-text' })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText('No readable text was found.')
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Use imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  await dialog.getByLabel('Name', { exact: true }).fill('no-text-draft.md')
  await dialog.getByLabel('Format').selectOption('sheet')
  await dialog.getByLabel('Format').selectOption('doc')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('no-text-draft.md')
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(2)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(preview.getByRole('img', { name: `Preview of ${PATH}`, exact: true })).toBeVisible()

  await browser.getByRole('button', { name: 'Extract text to new document', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(3)
  const escaped = await page.evaluate(() => (window as any).__localImageCreate.recognition[2].operationId as string)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.cancellations.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).__localImageCreate.cancellations[0])).toBe(escaped)
  await resolveRecognition(page, { status: 'ready', text: 'Late after Escape.' })
  await expect(dialog).toHaveCount(0)
  expect(contentWrites(writes)).toEqual([])

  await browser.getByRole('button', { name: 'Extract text to new document', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.recognition.length)).toBe(4)
  const switched = await page.evaluate(() => (window as any).__localImageCreate.recognition[3].operationId as string)
  await switchAccountBehindDialog(page, 'Grace Hopper')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localImageCreate.cancellations.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).__localImageCreate.cancellations[1])).toBe(switched)
  await resolveRecognition(page, { status: 'ready', text: 'Late after account change.' })
  expect(contentWrites(writes)).toEqual([])

})

test('a browser without native image OCR exposes no local image extraction action', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await installFixture(page, false)
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await page.goto(`/contexts/${FOLDER}`)
  const unsupported = page.locator('[data-local-folder-browser]')
  await unsupported.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await unsupported.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(PATH)
  await unsupported.getByRole('list', { name: 'Folder paths', exact: true })
    .getByRole('button', { name: `${PATH} File`, exact: true }).click()
  await expect(unsupported.getByRole('img', { name: `Preview of ${PATH}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(unsupported.getByRole('button', { name: 'Extract text to new document', exact: true })).toHaveCount(0)
})
