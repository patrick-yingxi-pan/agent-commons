/** Structured local previews enter the ordinary, explicitly reviewed artifact flow. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { parseLocalFolderFileListing } from '../contract/localFolderBrowse.mjs'
import { parseLocalGitFileListing } from '../contract/localGitBrowse.mjs'
import { isLocalConnectionId } from '../contract/localFolderCapture.ts'
import { isLocalGitConnectionId } from '../contract/localGitCapture.ts'
import { assertWcag22Aa, settledOpaquePaint } from './accessibility-helpers.ts'
import { API } from './social-helpers.ts'
import { ms } from './budget.ts'

const FOLDER_ID = `LOCAL_${'E'.repeat(32)}`
const GIT_ID = `GIT_${'E'.repeat(32)}`
const stamp = Date.now().toString(36)
const BOOK = `workbooks/review-${stamp}.xlsx`
const DECK = `presentations/review-${stamp}.pptx`
const BAD_BOOK = `workbooks/incomplete-${stamp}.xlsx`
const BOOK_SHEETS = [
  { name: 'Summary', rows: [['Metric', 'Value'], ['Revenue', '42'], ['Status', 'ready']] },
  { name: 'Detail', rows: [['Item', 'Count'], ['North', '7']] },
]
const BOOK_BYTES = [...xlsxFixture({ sheets: BOOK_SHEETS })]
const DECK_BYTES = [...pptxFixture({ slides: [
  { name: 'Quarterly review', shapes: ['Revenue outlook', 'Q4 target: 42'] },
  { name: 'Next steps', shapes: ['Confirm owners', 'Publish the plan'] },
] })]
const BAD_BOOK_BYTES = [...xlsxFixture({ sheets: [{ name: 'No cache', rows: [
  [{ formula: '1+1' }, 'Description'],
  ['A', 'literal'],
] }] })]
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function installNativeFixture(page: Page) {
  expect(isLocalConnectionId(FOLDER_ID)).toBe(true)
  expect(isLocalGitConnectionId(GIT_ID)).toBe(true)
  const paths = [BOOK, DECK, BAD_BOOK]
  const entries = [...paths].sort().map(path => ({ path, kind: 'file' as const }))
  const folderListing = { version: 1, visited: paths.length + 2, hiddenCount: 0, directoryCount: 2, files: entries }
  const gitListing = { version: 1, files: entries, excludedCount: 0 }
  expect(parseLocalFolderFileListing(folderListing)).toEqual(folderListing)
  expect(parseLocalGitFileListing(gitListing)).toEqual(gitListing)
  await page.addInitScript(({ folderId, gitId, folderListing, gitListing, files }) => {
    const state: any = { reads: [], lists: [], snapshots: 0, connected: true, files }
    Object.defineProperty(window, '__localStructuredCreate', { configurable: true, value: state })
    const source = (id: string, kind: 'folder' | 'git', listing: any) => ({
      list: async (auth: any) => auth?.userId === 'user-ada' && state.connected
        ? [{ id, name: kind === 'folder' ? 'Structured Folder fixture' : 'Structured Git fixture', remembered: true }] : [],
      connect: async () => { throw new Error('preview review must not reconnect a source') },
      files: async (sourceId: string, auth: any) => {
        if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong source listing')
        state.lists.push({ kind, sourceId })
        return structuredClone(listing)
      },
      file: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong source read')
        return read(kind, input.path, auth.userId)
      },
      untrackedFiles: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== gitId || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked listing')
        state.lists.push({ kind: 'git-untracked', sourceId })
        return { ...structuredClone(gitListing), scope: 'untracked' }
      },
      untrackedFile: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== gitId || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked read')
        return read('git-untracked', input.path, auth.userId)
      },
      cancelUntrackedRead: async () => true,
      snapshot: async () => { state.snapshots++; throw new Error('structured adoption does not capture source snapshots') },
      review: async () => { throw new Error('structured adoption does not read Git review state') },
      disconnect: async () => { state.connected = false },
    })
    function read(kind: string, path: string, userId: string) {
      state.reads.push({ kind, path, userId })
      const bytes = state.files[path]
      if (!bytes) throw new Error('unknown test path')
      const format = path.endsWith('.xlsx') ? 'xlsx' : 'pptx'
      return { version: 1, ...(kind === 'git-untracked' ? { scope: 'untracked' } : {}), path,
        sizeBytes: bytes.length, snapshot: { document: { format, bytes: new Uint8Array(bytes) } } }
    }
    Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: { context: {
      localFolders: source(folderId, 'folder', folderListing),
      localGit: source(gitId, 'git', gitListing),
    } } })
  }, { folderId: FOLDER_ID, gitId: GIT_ID, folderListing, gitListing,
    files: { [BOOK]: BOOK_BYTES, [DECK]: DECK_BYTES, [BAD_BOOK]: BAD_BOOK_BYTES } })
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

async function switchAccountBehindDraft(page: Page, name: string) {
  await page.getByTestId('account-chip').dispatchEvent('click')
  const option = page.getByTestId('account-stack-option').filter({ hasText: name }).first()
  await expect(option).toBeAttached()
  await option.dispatchEvent('click')
  await expect(page.getByTestId('account-chip')).toContainText(name)
}

async function selectPreview(browser: ReturnType<Page['locator']>, source: 'folder' | 'git' | 'git-untracked', path: string) {
  const listName = source === 'folder' ? 'List folder paths' : source === 'git-untracked' ? 'List untracked paths' : 'List tracked paths'
  const listing = browser.locator(`[data-local-${source}-browser-listing]`)
  if (!(await listing.isVisible())) await browser.getByRole('button', { name: listName, exact: true }).click()
  await expect(listing).toBeVisible()
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(path)
  const row = source === 'folder' ? 'File' : source === 'git-untracked' ? 'Untracked file' : 'Tracked file'
  const list = source === 'folder' ? 'Folder paths' : source === 'git-untracked' ? 'Untracked repository paths' : 'Tracked repository paths'
  await browser.getByRole('list', { name: list, exact: true }).getByRole('button', { name: `${path} ${row}`, exact: true }).click()
  const preview = browser.locator(`[data-local-${source}-file-preview]`)
  await expect(preview.getByRole('region', { name: `Preview of ${path}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  return preview
}

async function expectResponsiveReview(page: Page, subject: Locator, info: TestInfo, prefix: string, anchor: Locator) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await anchor.scrollIntoViewIfNeeded()
    await settledOpaquePaint(anchor)
    await expect(anchor).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => subject.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    if (viewport.width === 320 || viewport.width === 1280) await assertWcag22Aa(page, `${prefix} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${prefix}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize(VIEWPORTS[4])
}

async function artifactContent(page: Page, id: string) {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as Record<string, any>)[id]
}

test('Folder workbook preview opens a reviewed, editable draft and saves only after Create', async ({ page }, info) => {
  test.setTimeout(ms(120_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts`) writes.push(request.url())
  })
  await page.goto(`/contexts/${FOLDER_ID}`)
  const browser = page.locator('[data-local-folder-browser]')
  const preview = await selectPreview(browser, 'folder', BOOK)
  const reviewAction = browser.getByRole('button', { name: 'Review as new sheet', exact: true })
  await expect(reviewAction).toBeVisible()
  await expect(reviewAction).toBeEnabled()
  const readCount = await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)
  await expectResponsiveReview(page, preview, info, 'local-structured-folder-preview', reviewAction)
  await page.setViewportSize(VIEWPORTS[4])
  await reviewAction.click()

  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog.locator('[data-local-structured-draft]')).toBeVisible()
  await expect(dialog.getByLabel('Format')).toHaveValue('sheet')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('')
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toContainText('Revenue')
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Use imported sheet', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(readCount)
  await dialog.getByLabel('Name', { exact: true }).fill('typed-workbook.xlsx')
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await dialog.getByLabel('Import scope').selectOption('all')
  await expect(dialog.getByRole('region', { name: 'Imported workbook', exact: true })).toContainText('Detail')
  await dialog.getByLabel('Import scope').selectOption('selected')
  await dialog.getByLabel('Worksheet', { exact: true }).selectOption({ label: 'Detail' })
  const headers = dialog.getByRole('checkbox', { name: 'First row contains column names', exact: true })
  await headers.click()
  await expect(headers).toHaveAttribute('aria-checked', 'false')
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toContainText('Item')
  await expectResponsiveReview(page, dialog, info, 'local-structured-folder-review', dialog.getByRole('region', { name: 'Imported sheet', exact: true }))
  await page.setViewportSize(VIEWPORTS[4])
  await dialog.getByRole('button', { name: 'Use imported sheet', exact: true }).click()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('typed-workbook.xlsx')
  await expect(dialog.locator('[data-local-structured-draft]')).toBeVisible()
  await expect(dialog.getByLabel('Sheet row 1 value 1')).toHaveValue('Item')
  await dialog.getByLabel('Sheet row 1 value 1').fill('Edited Item')
  expect(writes).toEqual([])
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(readCount)
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  expect(writes).toHaveLength(1)
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  const body = await artifactContent(page, id)
  expect(body.type).toBe('sheet')
  expect(JSON.stringify(body)).toContain('Edited Item')
  expect(JSON.stringify(body)).not.toContain(BOOK)
  expect(JSON.stringify(body)).not.toContain(Buffer.from(BOOK_BYTES).toString('base64'))
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.snapshots)).toBe(0)
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(readCount)
  await page.reload()
  expect(JSON.stringify(await artifactContent(page, id))).toContain('Edited Item')
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads)).toEqual([])
})

test('tracked Git presentation preview adopts literal slides after explicit Use and Create', async ({ page }, info) => {
  test.setTimeout(ms(120_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${GIT_ID}`)
  const browser = page.locator('[data-local-git-browser]')
  const preview = await selectPreview(browser, 'git', DECK)
  await expect(browser.getByRole('button', { name: 'Review as new slides', exact: true })).toBeEnabled()
  await expect(preview).toContainText('Confirm owners', { timeout: ms(20_000) })
  const readsBefore = await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts`) writes.push(request.url())
  })
  await browser.getByRole('button', { name: 'Review as new slides', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog.locator('[data-local-structured-draft]')).toBeVisible()
  await expect(dialog.getByLabel('Format')).toHaveValue('slide')
  await expect(dialog.getByRole('region', { name: 'Imported slides', exact: true })).toBeVisible()
  await dialog.getByLabel('Name', { exact: true }).fill('team-review.pptx')
  await expect(dialog.getByRole('region', { name: 'Imported slides', exact: true })).toContainText('Revenue outlook')
  await expectResponsiveReview(page, dialog, info, 'local-structured-tracked-slides-review', dialog.getByRole('region', { name: 'Imported slides', exact: true }))
  await page.setViewportSize(VIEWPORTS[4])
  expect(writes).toEqual([])
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(readsBefore)
  await dialog.getByRole('button', { name: 'Use imported slides', exact: true }).click()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('team-review.pptx')
  await expect(dialog.getByLabel('Slide 1 title')).toHaveValue('Revenue outlook')
  await dialog.getByLabel('Slide 1 bullet 1', { exact: true }).fill('Edited literal bullet')
  expect(writes).toEqual([])
  await expectResponsiveReview(page, dialog, info, 'local-structured-tracked-slides', dialog.getByLabel('Slide 1 title', { exact: true }))
  await page.setViewportSize(VIEWPORTS[4])
  await dialog.getByRole('button', { name: 'Create slides', exact: true }).click()
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  expect(writes).toHaveLength(1)
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  const body = await artifactContent(page, id)
  expect(body.type).toBe('slides')
  expect(JSON.stringify(body)).toContain('Edited literal bullet')
  expect(JSON.stringify(body)).not.toContain(DECK)
  expect(JSON.stringify(body)).not.toContain(Buffer.from(DECK_BYTES).toString('base64'))
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.snapshots)).toBe(0)
})

test('opted-in untracked Git structured draft is private and nested Escape returns to its preview', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  const made = await page.request.post(`${API}/sessions`, { data: {} })
  expect(made.ok(), await made.text()).toBe(true)
  const session = await made.json() as { id: string }
  await page.goto(`/s/${session.id}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const contextDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await contextDialog.getByRole('button', { name: /^Repository/ }).click()
  const native = contextDialog.locator('[data-native-git-picker]')
  await native.getByRole('button', { name: 'Browse files in Structured Git fixture', exact: true }).click()
  const toggle = native.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  const browser = native.locator('[data-local-git-untracked-browser]')
  const preview = await selectPreview(browser, 'git-untracked', BOOK)
  await expect(browser.getByRole('button', { name: 'Review as new sheet', exact: true })).toBeEnabled()
  const readsBefore = await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)
  await browser.getByRole('button', { name: 'Review as new sheet', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await dialog.getByLabel('Name', { exact: true }).fill('private-draft.xlsx')
  await expect(dialog.locator('[data-local-structured-draft]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(preview.getByRole('region', { name: `Preview of ${BOOK}`, exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(readsBefore)
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.snapshots)).toBe(0)
  await expect(page.getByText('private-draft.xlsx', { exact: true })).toHaveCount(0)
  await browser.getByRole('button', { name: 'Review as new sheet', exact: true }).click()
  const secondDraft = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await secondDraft.getByLabel('Name', { exact: true }).fill('account-private.xlsx')
  await switchAccountBehindDraft(page, 'Grace Hopper')
  await expect(secondDraft).toHaveCount(0)
  await expect(page.getByText('account-private.xlsx', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.snapshots)).toBe(0)
})

test('a missing cached formula value cannot become an imported draft or artifact', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${FOLDER_ID}`)
  const browser = page.locator('[data-local-folder-browser]')
  const preview = await selectPreview(browser, 'folder', BAD_BOOK)
  await expect(preview).toBeVisible()
  const action = browser.getByRole('button', { name: 'Review as new sheet', exact: true })
  await expect(action).toBeEnabled()
  await action.click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByLabel('Name', { exact: true }).fill('incomplete.xlsx')
  const useCandidate = dialog.getByRole('button', { name: /Use imported (sheet|workbook)/ })
  await expect(useCandidate).toBeVisible()
  await expect(useCandidate).toBeDisabled()
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts`) writes.push(request.url())
  })
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  expect(writes).toEqual([])
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.snapshots)).toBe(0)
})

test('discard and format changes never silently restore a captured structured candidate', async ({ page }) => {
  await installNativeFixture(page)
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${FOLDER_ID}`)
  const browser = page.locator('[data-local-folder-browser]')
  await selectPreview(browser, 'folder', BOOK)
  await browser.getByRole('button', { name: 'Review as new sheet', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toHaveCount(0)
  await dialog.getByLabel('Format').selectOption('slide')
  await dialog.getByLabel('Format').selectOption('sheet')
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Sheet row 1 value 1')).toHaveValue('')
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(1)
  await page.keyboard.press('Escape')
  await browser.getByRole('button', { name: 'Review as new sheet', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Imported sheet', exact: true })).toContainText('Revenue')
  expect(await page.evaluate(() => (window as any).__localStructuredCreate.reads.length)).toBe(1)
})
