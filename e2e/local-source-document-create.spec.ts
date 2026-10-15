/** Reviewed local previews enter the ordinary authored document flow. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { parseLocalFolderFileListing } from '../contract/localFolderBrowse.mjs'
import { parseLocalGitFileListing } from '../contract/localGitBrowse.mjs'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../contract/content.ts'
import { assertWcag22Aa, settledNarrowRail } from './accessibility-helpers.ts'
import { API, createProject } from './social-helpers.ts'
import { ms } from './budget.ts'

const FOLDER_ID = `LOCAL_${'F'.repeat(32)}`
const GIT_ID = `GIT_${'F'.repeat(32)}`
const stamp = Date.now().toString(36)
const TEXT_PATH = `notes/review-${stamp}.txt`
const DOCX_PATH = `docs/brief-${stamp}.docx`
const PDF_PATH = `research/scans/brief-${stamp}.pdf`
const EMPTY_PATH = `notes/empty-${stamp}.md`
const LARGE_PATH = `notes/large-${stamp}.md`
const XLSX_PATH = `data/unsupported-${stamp}.xlsx`
const PPTX_PATH = `slides/unsupported-${stamp}.pptx`
const IMAGE_PATH = `images/unsupported-${stamp}.png`
const LATE_PATH = `notes/late-${stamp}.md`
const OCR_PATH = `scans/pending-${stamp}.pdf`
const SOURCE_TEXT = `REVIEWED_LOCAL_SOURCE_${stamp}\n\nSecond paragraph stays editable.`
const DOCX_TEXT = `REVIEWED_DOCX_SOURCE_${stamp} · café 世界`
const PDF_TEXT = `REVIEWED_PDF_SOURCE_${stamp}`
const OCR_TEXT = `REVIEWED_OCR_SOURCE_${stamp}`
const PRIVATE_TEXT = `PRIVATE_ACCOUNT_DRAFT_${stamp}`
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

type NativeDocument = { format: string; bytes: number[] }
const IMAGE_BYTES = [...imageFixture(40, 20)]

const docs: Record<string, { text?: string; document?: NativeDocument; image?: number[]; sizeBytes?: number; omitted?: string }> = {
  [TEXT_PATH]: { text: SOURCE_TEXT },
  [DOCX_PATH]: { document: { format: 'docx', bytes: [...docxFixture({ paragraphs: [DOCX_TEXT, 'DOCX second paragraph'] })] } },
  [PDF_PATH]: { document: { format: 'pdf', bytes: [...pdfFixture({ pages: [PDF_TEXT, null], compress: true })] } },
  [EMPTY_PATH]: { text: '', sizeBytes: 0 },
  [LARGE_PATH]: { text: 'L'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS + 1) },
  [XLSX_PATH]: { document: { format: 'xlsx', bytes: [...xlsxFixture({ sheets: [{ name: 'Data', rows: [['private']]}] })] } },
  [PPTX_PATH]: { document: { format: 'pptx', bytes: [...pptxFixture({ slides: [{ name: 'Slide', shapes: ['private'] }] })] } },
  [IMAGE_PATH]: { image: IMAGE_BYTES },
  [LATE_PATH]: { text: `LATE_REVIEWED_TEXT_${stamp}` },
  [OCR_PATH]: { document: { format: 'pdf', bytes: [...pdfFixture({ pages: [PDF_TEXT], compress: true })] } },
}

async function installNativeFixture(page: Page) {
  const serialized = Object.fromEntries(Object.entries(docs).map(([path, item]) => [path, {
    ...item,
    ...(item.document ? { document: { format: item.document.format, bytes: item.document.bytes } } : {}),
  }]))
  const entries = Object.keys(serialized).sort().map(path => ({ path, kind: 'file' as const }))
  const directories = new Set(entries.flatMap(({ path }) => {
    const parts = path.split('/')
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
  }))
  const folderListing = { version: 1, visited: entries.length + directories.size, hiddenCount: 0, directoryCount: directories.size, files: entries }
  const gitListing = { version: 1, files: entries, excludedCount: 0 }
  expect(parseLocalFolderFileListing(folderListing)).toEqual(folderListing)
  expect(parseLocalGitFileListing(gitListing)).toEqual(gitListing)
  await page.addInitScript(({ folderId, gitId, files, folderListing, gitListing }) => {
    const state: any = { lists: [], reads: [], snapshots: 0, recognition: [], connected: true }
    Object.defineProperty(window, '__localSourceDocumentCreate', { configurable: true, value: state })
    const makeSource = (id: string, kind: string, listing: any) => ({
      list: async (input: any) => input?.userId === 'user-ada' && state.connected
        ? [{ id, name: `${kind} document fixture`, remembered: true }] : [],
      connect: async () => { throw new Error('reviewed adoption does not reconnect a source') },
      files: async (sourceId: string, auth: any) => {
        if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong source listing')
        state.lists.push({ source: kind, id, userId: auth.userId })
        return structuredClone(listing)
      },
      file: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong source read')
        state.reads.push({ source: kind, id, path: input.path, userId: auth.userId })
        const item = state.files[input.path]
        if (!item) throw new Error('unknown test path')
        if (state.holdReadPath === input.path) return await new Promise(resolve => {
          state.resolveRead = () => resolve({ version: 1, path: input.path,
            sizeBytes: new TextEncoder().encode(item.text).byteLength, snapshot: { text: item.text } })
        })
        const sizeBytes = item.sizeBytes ?? (item.text !== undefined
          ? new TextEncoder().encode(item.text).byteLength : item.image?.length ?? item.document.bytes.length)
        return { version: 1, path: input.path, sizeBytes,
          snapshot: item.text !== undefined ? { text: item.text }
            : item.omitted ? { omitted: item.omitted }
              : item.image ? { image: { bytes: new Uint8Array(item.image) } }
                : { document: { format: item.document.format, bytes: new Uint8Array(item.document.bytes) } } }
      },
      untrackedFiles: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== gitId || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked listing')
        state.lists.push({ source: 'git-untracked', id: sourceId, userId: auth.userId })
        return { ...structuredClone(gitListing), scope: 'untracked' }
      },
      untrackedFile: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== gitId || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked read')
        state.reads.push({ source: 'git-untracked', id: sourceId, path: input.path, userId: auth.userId })
        const item = state.files[input.path]
        if (!item) throw new Error('unknown test path')
        if (state.holdReadPath === input.path) return await new Promise(resolve => {
          state.resolveRead = () => resolve({ version: 1, scope: 'untracked', path: input.path,
            sizeBytes: new TextEncoder().encode(item.text).byteLength, snapshot: { text: item.text } })
        })
        const sizeBytes = item.sizeBytes ?? (item.text !== undefined
          ? new TextEncoder().encode(item.text).byteLength : item.image?.length ?? item.document.bytes.length)
        return { version: 1, scope: 'untracked', path: input.path, sizeBytes,
          snapshot: item.text !== undefined ? { text: item.text }
            : item.omitted ? { omitted: item.omitted }
              : item.image ? { image: { bytes: new Uint8Array(item.image) } }
                : { document: { format: item.document.format, bytes: new Uint8Array(item.document.bytes) } } }
      },
      cancelUntrackedRead: async () => true,
      snapshot: async () => { state.snapshots++; throw new Error('adoption never captures a source snapshot') },
      review: async () => { throw new Error('adoption never reads Git change review') },
      disconnect: async () => { state.connected = false },
    })
    state.files = files
    const desktop: any = { context: {
      localFolders: makeSource(folderId, 'Folder', folderListing),
      localGit: makeSource(gitId, 'Git', gitListing),
    }, pdfOcr: {
      recognize: (operationId: string, bytes: Uint8Array) => new Promise(resolve => state.recognition.push({ operationId, bytes: Array.from(bytes), resolve })),
      cancel: async () => true,
    } }
    Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: desktop })
  }, { folderId: FOLDER_ID, gitId: GIT_ID, files: serialized, folderListing, gitListing })
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
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
}

async function switchAccount(page: Page, optionText: string, expected: string) {
  await settledNarrowRail(page)
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click({ timeout: ms(10_000) })
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function switchAccountBehindDraft(page: Page, optionText: string, expected: string) {
  // The account menu lives behind the seeded child modal. Dispatch its real
  // button handlers so the account transition can exercise draft fencing.
  await page.getByTestId('account-chip').dispatchEvent('click')
  const option = page.getByTestId('account-stack-option').filter({ hasText: optionText }).first()
  await expect(option).toBeAttached()
  await option.dispatchEvent('click')
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function selectPreview(browser: Locator, source: 'folder' | 'git' | 'git-untracked', path: string) {
  const listAction = source === 'folder' ? 'List folder paths' : source === 'git-untracked' ? 'List untracked paths' : 'List tracked paths'
  const listing = browser.locator(`[data-local-${source}-browser-listing]`)
  if (!(await listing.isVisible())) await browser.getByRole('button', { name: listAction, exact: true }).click()
  await expect(listing).toBeVisible()
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(path)
  const rowLabel = source === 'folder' ? 'File' : source === 'git-untracked' ? 'Untracked file' : 'Tracked file'
  await browser.getByRole('list', { name: source === 'folder' ? 'Folder paths' : source === 'git-untracked' ? 'Untracked repository paths' : 'Tracked repository paths' })
    .getByRole('button', { name: `${path} ${rowLabel}`, exact: true }).click()
  const preview = browser.locator(`[data-local-${source}-file-preview]`)
  if (path !== IMAGE_PATH) {
    await expect(preview.getByRole('region', { name: `Preview of ${path}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  } else {
    await expect(preview.getByRole('img', { name: `Preview of ${path}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  }
  return preview
}

async function chooseSource(page: Page, kind: 'folder' | 'git', browserName: string) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: kind === 'folder' ? /^Folder/ : /^Repository/ }).click()
  if (kind === 'folder') await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  const native = picker.locator(kind === 'folder' ? '[data-native-folder-picker]' : '[data-native-git-picker]')
  await native.getByRole('button', { name: `Browse files in ${browserName}`, exact: true }).click()
  return { picker, native, browser: native.locator(`[data-local-${kind}-browser]`) }
}

async function expectNoPageOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    { message: `local source authoring has no page overflow at ${width}px` }).toBe(true)
}

async function artifactContent(page: Page, id: string) {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as Record<string, any>)[id]
}

test('Folder reviewed text opens the ordinary document draft and saves only after Create', async ({ page }, info: TestInfo) => {
  test.setTimeout(ms(120_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  const made = await page.request.post(`${API}/sessions`, { data: {} })
  expect(made.ok(), await made.text()).toBe(true)
  const session = await made.json() as { id: string }
  await page.goto(`/s/${session.id}`)
  const writes: string[] = []
  const messages: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path === `${API}/artifacts`) writes.push(path)
    if (request.method() === 'POST' && path.endsWith('/messages')) messages.push(path)
  })
  const { picker, browser } = await chooseSource(page, 'folder', 'Folder document fixture')
  const preview = await selectPreview(browser, 'folder', TEXT_PATH)
  await expect(preview.getByRole('region', { name: `Preview of ${TEXT_PATH}` })).toHaveText(SOURCE_TEXT)
  const action = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  const beforeReads = await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads.length)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await action.scrollIntoViewIfNeeded()
    await expect(action).toBeVisible()
    await expect(action).toBeEnabled()
    await expect(action).toBeInViewport()
    await expectNoPageOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `Folder source document action ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`local-source-document-folder-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize(VIEWPORTS[4])
  await action.click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Format')).toHaveValue('doc')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(`review-${stamp}.md`)
  await expect(dialog.getByLabel('Content')).toHaveValue(SOURCE_TEXT)
  await expect(dialog).toContainText(TEXT_PATH)
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()
  await expect(dialog.getByLabel('Content')).toBeEditable()
  expect(writes).toEqual([])
  expect(messages).toEqual([])
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads.length)).toBe(beforeReads)

  const content = dialog.getByLabel('Content')
  await content.fill(`${SOURCE_TEXT}\n\nEdited in ordinary authoring.`)
  const first = dialog.locator('input, textarea, select, button').first()
  const last = dialog.locator('input, textarea, select, button').last()
  await last.focus()
  await last.press('Tab')
  await expect(first).toBeFocused()
  await first.press('Shift+Tab')
  await expect(last).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(picker).toBeVisible()
  await expect(browser.getByRole('region', { name: `Preview of ${TEXT_PATH}`, exact: true })).toHaveText(SOURCE_TEXT)
  expect(writes).toEqual([])
  expect(messages).toEqual([])
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads.length)).toBe(beforeReads)

  const reopenedAdoption = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  await expect(reopenedAdoption).toBeVisible()
  await expect(reopenedAdoption).toBeEnabled()
  await reopenedAdoption.click()
  const reopened = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(reopened.getByLabel('Content')).toHaveValue(SOURCE_TEXT,
    'Cancel releases the detached source draft; a later adoption starts from the reviewed preview again')
  await reopened.getByLabel('Content').fill(`${SOURCE_TEXT}\n\nEdited in ordinary authoring.`)
  const create = reopened.getByRole('button', { name: 'Create document', exact: true })
  await expect(create).toBeVisible()
  await expect(create).toBeEnabled()
  await create.click()
  await expect(reopened).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  expect(writes).toEqual([`${API}/artifacts`])
  expect(messages).toEqual([])
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads.length)).toBe(beforeReads)
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  const body = await artifactContent(page, id)
  expect(body.blocks.map((block: any) => 'p' in block ? block.p : '').join('\n')).toContain('Edited in ordinary authoring.')
  expect(JSON.stringify(body)).not.toContain(Buffer.from(docs[TEXT_PATH]!.text!).toString('base64'))
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.snapshots)).toBe(0)
})

test('canonical Folder and tracked Git document previews preserve reviewed PDF and DOCX text', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  for (const item of [
    { id: FOLDER_ID, path: DOCX_PATH, source: 'folder' as const, expected: DOCX_TEXT },
    { id: GIT_ID, path: PDF_PATH, source: 'git' as const, expected: PDF_TEXT },
  ]) {
    await page.goto(`/contexts/${item.id}`)
    const browser = page.locator(item.source === 'folder' ? '[data-local-folder-browser]' : '[data-local-git-browser]')
    const preview = await selectPreview(browser, item.source, item.path)
    await expect(preview).toContainText(item.expected, { timeout: ms(20_000) })
    const action = browser.getByRole('button', { name: 'Use text in new document', exact: true })
    await expect(action).toBeEnabled()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await action.scrollIntoViewIfNeeded()
      await expect(action).toBeVisible()
      await expect(action).toBeEnabled()
      await expect(action).toBeInViewport()
      await expectNoPageOverflow(page, viewport.width)
      await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    await page.setViewportSize(VIEWPORTS[4])
    const reads = await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads.length)
    await action.click()
    const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
    await expect(dialog.getByLabel('Content')).toHaveValue(new RegExp(item.expected))
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(item.path.split('/').at(-1)!.replace(/\.[^.]+$/, '.md'))
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator(`[data-local-${item.source}-file-preview]`)).toBeVisible()
    expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads.length)).toBe(reads)
  }
})

test('Project Context browsing can open a detached reviewed document draft without writing', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  const projectName = `Local source draft ${stamp}`
  await createProject(page, projectName)
  const contextSection = page.locator('section.group\\/section').filter({
    has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
  })
  const contextHeading = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await contextHeading.getAttribute('aria-expanded') === 'false') await contextHeading.click()
  await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const native = dialog.locator('[data-native-git-picker]')
  await native.getByRole('button', { name: 'Browse files in Git document fixture', exact: true }).click()
  const browser = native.locator('[data-local-git-browser]')
  const preview = await selectPreview(browser, 'git', TEXT_PATH)
  await expect(preview).toContainText(SOURCE_TEXT)
  const action = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  await expect(action).toBeEnabled()
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts`) writes.push(request.url())
  })
  await action.click()
  const draft = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(draft.getByLabel('Content')).toHaveValue(SOURCE_TEXT)
  await expect(draft).toContainText(TEXT_PATH)
  expect(writes).toEqual([])
  await draft.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(browser.getByRole('region', { name: `Preview of ${TEXT_PATH}`, exact: true })).toHaveText(SOURCE_TEXT)
  expect(writes).toEqual([])
})

test('an unrelated held creation keeps its own draft and never borrows source provenance', async ({ page }) => {
  test.setTimeout(ms(75_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  const heldName = `held-unrelated-${stamp}.md`
  let attempts = 0
  await page.route(`**${API}/artifacts`, async route => {
    if (route.request().method() !== 'POST' || (route.request().postDataJSON() as { name?: string }).name !== heldName) {
      return route.continue()
    }
    attempts++
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
      error: { code: 'internal', message: 'Test-owned held creation.' },
    }) })
  })
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await dialog.getByLabel('Name', { exact: true }).fill(heldName)
  await dialog.getByLabel('Content').fill('Unrelated held document body.')
  const create = dialog.getByRole('button', { name: 'Create document', exact: true })
  await expect(create).toBeVisible()
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page.locator('[data-revisioned-mutation="artifact-create"][data-mutation-status="failed"]')).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  expect(attempts).toBe(1)

  await page.evaluate(id => {
    window.history.pushState(null, '', `/contexts/${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, FOLDER_ID)
  await expect(page).toHaveURL(`/contexts/${FOLDER_ID}`)
  const browser = page.locator('[data-local-folder-browser]')
  const preview = await selectPreview(browser, 'folder', TEXT_PATH)
  await expect(preview).toContainText(SOURCE_TEXT)
  const adoption = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  await expect(adoption).toBeVisible()
  await expect(adoption).toBeEnabled()
  await adoption.click()
  dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(heldName)
  await expect(dialog.getByLabel('Content')).toHaveValue('Unrelated held document body.')
  await expect(dialog.locator('[data-local-document-draft]')).toHaveCount(0)
  await expect(dialog).not.toContainText(TEXT_PATH)
  const recovery = dialog.getByRole('button', { name: 'Waiting for recovery…', exact: true })
  await expect(recovery).toBeVisible()
  await expect(recovery).toBeDisabled()
  expect(attempts).toBe(1)
})

test('untracked Git adoption stays opt-in and source drafts clear across account changes', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  const made = await page.request.post(`${API}/sessions`, { data: {} })
  expect(made.ok(), await made.text()).toBe(true)
  const session = await made.json() as { id: string }
  await page.goto(`/s/${session.id}`)
  const { native } = await chooseSource(page, 'git', 'Git document fixture')
  const toggle = native.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
  await expect(toggle).not.toBeChecked()
  await expect(native.locator('[data-local-git-untracked-browser]')).toHaveCount(0)
  await toggle.check()
  const browser = native.locator('[data-local-git-untracked-browser]')
  const preview = await selectPreview(browser, 'git-untracked', TEXT_PATH)
  await expect(preview).toContainText(SOURCE_TEXT)
  const adoption = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  await expect(adoption).toBeVisible()
  await expect(adoption).toBeEnabled()
  await adoption.click()
  const draft = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(draft.getByLabel('Content')).toHaveValue(SOURCE_TEXT)
  await draft.getByLabel('Content').fill(PRIVATE_TEXT)
  await switchAccountBehindDraft(page, 'Grace Hopper', 'Grace Hopper')
  await expect(draft).toHaveCount(0)
  await expect(page.getByText(PRIVATE_TEXT, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.snapshots)).toBe(0)
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
  const readsBeforeReload = await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads)
  expect(readsBeforeReload).toEqual([
    { source: 'git-untracked', id: GIT_ID, path: TEXT_PATH, userId: 'user-ada' },
  ])
  await page.goto(`/s/${session.id}`)
  await expect(page.getByText(PRIVATE_TEXT, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Add context', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.reads)).toEqual([],
    'fresh navigation does not reread the private source or reconstruct a private draft')
  expect(await page.evaluate(() => (window as any).__localSourceDocumentCreate.snapshots)).toBe(0)
})

test('empty, oversized, structured, image, and pending OCR previews cannot seed a document', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${FOLDER_ID}`)
  const browser = page.locator('[data-local-folder-browser]')
  for (const [path, refusal] of [
    [EMPTY_PATH, /no readable content|empty/i], [LARGE_PATH, /character authoring limit/i], [XLSX_PATH, /spreadsheet|sheet/i],
    [PPTX_PATH, /presentation|slide/i], [IMAGE_PATH, /image/i],
  ] as const) {
    const preview = await selectPreview(browser, 'folder', path)
    const action = browser.getByRole('button', { name: 'Use text in new document', exact: true })
    if (path === EMPTY_PATH || path === LARGE_PATH) {
      await expect(action).toBeDisabled()
      await expect(browser).toContainText(refusal)
    } else {
      await expect(action).toHaveCount(0)
      if (path === IMAGE_PATH) await expect(preview.getByRole('img', { name: `Preview of ${IMAGE_PATH}`, exact: true })).toBeVisible()
      else await expect(preview).toContainText(refusal)
    }
  }
  await page.evaluate(path => { (window as any).__localSourceDocumentCreate.holdReadPath = path }, LATE_PATH)
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(LATE_PATH)
  await browser.getByRole('list', { name: 'Folder paths' })
    .getByRole('button', { name: `${LATE_PATH} File`, exact: true }).click()
  await expect(browser.getByRole('status').filter({ hasText: `Reading ${LATE_PATH}…` })).toBeVisible()
  const pendingReadAdoption = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  await expect.poll(async () => (await pendingReadAdoption.count()) === 0 || await pendingReadAdoption.isDisabled()).toBe(true)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localSourceDocumentCreate.resolveRead)).toBe('function')
  await page.evaluate(() => (window as any).__localSourceDocumentCreate.resolveRead())
  const latePreview = browser.locator('[data-local-folder-file-preview]')
  await expect(latePreview.getByRole('region', { name: `Preview of ${LATE_PATH}`, exact: true })).toContainText(`LATE_REVIEWED_TEXT_${stamp}`)
  await expect(browser.getByRole('button', { name: 'Use text in new document', exact: true })).toBeEnabled()

  const pdf = await selectPreview(browser, 'folder', OCR_PATH)
  const adoption = browser.getByRole('button', { name: 'Use text in new document', exact: true })
  await expect(adoption).toBeEnabled()
  await expect(pdf.getByRole('region', { name: `Preview of ${OCR_PATH}`, exact: true })).toContainText(PDF_TEXT)
  const recognize = browser.getByRole('button', { name: 'Recognize scanned text', exact: true })
  await expect(recognize).toBeVisible()
  await expect(recognize).toBeEnabled()
  await recognize.click()
  await expect(browser.getByText('Recognizing PDF text…', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localSourceDocumentCreate.recognition.length)).toBe(1)
  await expect(adoption).toBeDisabled()
  await page.evaluate(({ text }) => {
    const item = (window as any).__localSourceDocumentCreate.recognition[0]
    item.resolve({ status: 'ready', pages: 1, textPages: 1, text })
  }, { path: OCR_PATH, text: OCR_TEXT })
  await expect(pdf).toContainText(OCR_TEXT)
  await expect(adoption).toBeEnabled()
  await adoption.click()
  const draft = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(draft.getByLabel('Content')).toHaveValue(OCR_TEXT)
  await draft.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(draft).toHaveCount(0)
})
