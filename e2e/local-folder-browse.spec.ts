/** Desktop-shaped UI proof; native IPC and descriptor traversal are separate gates. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { API, createProject } from './social-helpers.ts'
import { ms } from './budget.ts'
import { POPOVER_MARGIN } from '../src/lib/popover.ts'

const ID = `LOCAL_${'B'.repeat(32)}`
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const EMPTY_PATH = 'src/zzz-empty.md'
const LARGE_PATH = 'src/zzz-large.md'
const UNREADABLE_PATH = 'src/zzz-unreadable.md'
const LATE_DISMISS_PATH = 'src/zzz-late-dismiss.md'
const LATE_ACCOUNT_PATH = 'src/zzz-late-account.md'
const PREVIEW_TEXT = 'PRIVATE_LOCAL_FOLDER_PREVIEW_frozen-before-attach'

async function signIntoAdaAndGrace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const ada = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(ada.ok(), await ada.text()).toBeTruthy()
  const grace = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(grace.ok(), await grace.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
}

async function addFolderBrowseFixture(page: Page, name: string) {
  await page.addInitScript(({ id, name, emptyPath, largePath, unreadablePath, lateDismissPath, lateAccountPath, previewText }) => {
    const files: Array<{ path: string; kind: 'file' | 'unsupported' }> = Array.from({ length: 205 }, (_, index) => ({
      path: `src/${String(index).padStart(3, '0')}-file.md`, kind: 'file' as const,
    }))
    files.push(
      { path: emptyPath, kind: 'file' },
      { path: largePath, kind: 'file' },
      { path: unreadablePath, kind: 'file' },
      { path: lateDismissPath, kind: 'file' },
      { path: lateAccountPath, kind: 'file' },
      { path: 'assets/logo.png', kind: 'unsupported' },
    )
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    const state: any = {
      rows: [], hiddenPaths: ['src/.hidden-secret.md', '.env', '.git/config', 'src/private/.token'],
      filesCalls: [], fileCalls: [], snapshotCalls: [], snapshotTreeCalls: [],
      holdNextFiles: false, listing: undefined, resolveFiles: undefined,
      disconnectCalls: [], holdNextDisconnect: false, resolveDisconnect: undefined, rejectDisconnect: undefined,
      resolveDismissPreview: undefined, resolveAccountPreview: undefined,
      text: previewText, failListing: false, failPreview: false,
    }
    Object.defineProperty(window, '__localFolderBrowseHarness', { configurable: true, value: state })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localFolders: {
        list: async (source: any) => source?.userId === 'user-ada' ? state.rows : [],
        connect: async () => { throw new Error('browse acceptance must not reconnect folders') },
        snapshot: async (...args: unknown[]) => { state.snapshotCalls.push(args); throw new Error('browsing never captures a whole-folder snapshot') },
        snapshotTree: async (...args: unknown[]) => { state.snapshotTreeCalls.push(args); throw new Error('browsing never captures a recursive folder snapshot') },
        files: async (connectionId: string, source: any) => {
          state.filesCalls.push({ id: connectionId, userId: source?.userId })
          if (state.failListing) throw new Error('private native listing detail')
          const listing = { version: 1, visited: files.length + state.hiddenPaths.length + 3,
            hiddenCount: state.hiddenPaths.length, directoryCount: 3, files }
          state.listing = listing
          if (state.holdNextFiles) {
            state.holdNextFiles = false
            return await new Promise(resolve => { state.resolveFiles = resolve })
          }
          return listing
        },
        file: async (connectionId: string, selection: { path: string }, source: any) => {
          state.fileCalls.push({ id: connectionId, path: selection.path, userId: source?.userId })
          if (state.failPreview) throw new Error('private native preview detail')
          if (selection.path === lateDismissPath) return await new Promise(resolve => { state.resolveDismissPreview = resolve })
          if (selection.path === lateAccountPath) return await new Promise(resolve => { state.resolveAccountPreview = resolve })
          if (selection.path === largePath) return { version: 1, path: selection.path, sizeBytes: 65_537, snapshot: { omitted: 'too-large' } }
          if (selection.path === unreadablePath) return { version: 1, path: selection.path, sizeBytes: 0, snapshot: { omitted: 'unreadable' } }
          if (selection.path === emptyPath) return { version: 1, path: selection.path, sizeBytes: 0, snapshot: { text: '' } }
          return { version: 1, path: selection.path, sizeBytes: new TextEncoder().encode(state.text).byteLength, snapshot: { text: state.text } }
        },
        disconnect: async (connectionId: string, source: any) => {
          state.disconnectCalls.push({ id: connectionId, userId: source?.userId })
          if (state.holdNextDisconnect) {
            state.holdNextDisconnect = false
            await new Promise((resolve, reject) => {
              state.resolveDisconnect = resolve
              state.rejectDisconnect = reject
            })
          }
          state.rows = state.rows.filter((row: { id: string }) => row.id !== connectionId)
        },
      } } },
    })
    state.rows = [{ id, name, remembered: true }]
  }, {
    id: ID, name, emptyPath: EMPTY_PATH, largePath: LARGE_PATH, unreadablePath: UNREADABLE_PATH,
    lateDismissPath: LATE_DISMISS_PATH, lateAccountPath: LATE_ACCOUNT_PATH, previewText: PREVIEW_TEXT,
  })
}

async function switchAccount(page: Page, optionText: string, expected: string) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click({ timeout: ms(10_000) })
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function folderPicker(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Folder/ }).click()
  await dialog.getByRole('button', { name: 'This computer', exact: true }).click()
  return dialog
}

async function expectNoPageOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    { message: `local folder browser has no page horizontal overflow at ${width}px` }).toBe(true)
}

async function expectPopoverContained(page: Page, width: number, height: number, surface: string) {
  // Match the existing UI-1 browser tolerance: the shared 8px margin allows
  // one pixel for fractional layout rounding, while vertical bounds use the
  // same live workspace body that usePopoverShift measures.
  const margin = POPOVER_MARGIN - 1
  await expect.poll(() => page.evaluate(({ edge }) => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-popover]')].filter((panel) => {
      const style = getComputedStyle(panel)
      const rect = panel.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
    if (!panels.length) return false
    return panels.every((panel) => {
      const rect = panel.getBoundingClientRect()
      const workspace = panel.closest<HTMLElement>('[data-popover-viewport]')?.getBoundingClientRect()
      const top = Math.max(0, workspace?.top ?? 0)
      const bottom = Math.min(innerHeight, workspace?.bottom ?? innerHeight)
      return rect.left >= edge && rect.right <= innerWidth - edge &&
        rect.top >= top + edge && rect.bottom <= bottom - edge
    })
  }, { edge: margin }), `${surface} popover clears all viewport edges by ${margin}px at ${width}x${height}`)
    .toBe(true)
}

test('native local Folder browsing is explicit, paged, omission-aware, dismissible, and account-fenced', async ({ page }, info: TestInfo) => {
  test.setTimeout(ms(120_000))
  await addFolderBrowseFixture(page, 'Browse fixture')
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${ID}`)
  const detail = page.locator(`[data-local-folder-detail="${ID}"]`)
  const browser = detail.locator('[data-local-folder-browser]')
  await expect(detail.getByRole('heading', { name: 'Browse fixture', exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeVisible()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.filesCalls.length)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(0)

  await page.evaluate(() => { (window as any).__localFolderBrowseHarness.holdNextFiles = true })
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localFolderBrowseHarness.resolveFiles)).toBe('function')
  await expect(browser.getByRole('status')).toContainText('Listing folder paths')
  await expect(browser.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).__localFolderBrowseHarness.resolveFiles((window as any).__localFolderBrowseHarness.listing))
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeEnabled()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)

  await page.evaluate(() => { (window as any).__localFolderBrowseHarness.failListing = true })
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.getByRole('alert')).toBeVisible()
  await expect(browser.getByRole('alert')).not.toContainText('private native listing detail')
  await page.evaluate(() => { (window as any).__localFolderBrowseHarness.failListing = false })
  await browser.getByRole('button', { name: 'Retry path listing', exact: true }).click()
  const listing = browser.locator('[data-local-folder-browser-listing]')
  await expect(listing).toBeVisible()
  await expect(browser).toContainText('211 visible paths')
  await expect(browser).toContainText('visited 218 entries')
  await expect(browser).toContainText('4 hidden paths excluded')
  await expect(browser).toContainText('3 directories')
  expect(await page.evaluate(() => {
    const harness = (window as any).__localFolderBrowseHarness
    const listed = new Set(harness.listing.files.map((file: { path: string }) => file.path))
    return harness.hiddenPaths.filter((path: string) => listed.has(path))
  })).toEqual([], 'the declared native hidden candidates are omitted from visible path metadata')
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.filesCalls.length)).toBe(3)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls)).toEqual([], 'listing never reads file bodies')
  await expect(browser.getByRole('list', { name: 'Folder paths' }).getByRole('listitem')).toHaveCount(100)
  await expect(browser).toContainText('page 1 of 3')
  const search = browser.getByRole('searchbox', { name: 'Search paths' })
  const rows = browser.getByRole('list', { name: 'Folder paths' })
  await search.fill('.hidden-secret')
  await expect(browser).toContainText('No folder paths match this search.')
  await expect(rows.getByRole('listitem')).toHaveCount(0)
  await search.fill('204-file')
  await expect(browser).toContainText('1 matching paths')
  await expect(rows.getByRole('listitem')).toHaveCount(1)
  await search.fill('')
  await browser.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(browser).toContainText('page 2 of 3')
  await rows.getByRole('button', { name: 'src/150-file.md File', exact: true }).click()
  const preview = browser.locator('[data-local-folder-file-preview]')
  await expect(preview.getByRole('region', { name: 'Preview of src/150-file.md' })).toContainText(PREVIEW_TEXT)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls)).toEqual([
    { id: ID, path: 'src/150-file.md', userId: 'user-ada' },
  ])

  const choose = async (path: string) => {
    await search.fill(path)
    await rows.getByRole('button', { name: `${path} File`, exact: true }).click()
  }
  await choose(EMPTY_PATH)
  await expect(preview.getByRole('region', { name: `Preview of ${EMPTY_PATH}` })).toHaveText('')
  await expect(preview).toContainText('Empty file (0 bytes)')
  await choose(LARGE_PATH)
  await expect(preview).toContainText('exceeds the 64 KiB preview limit')
  await choose(UNREADABLE_PATH)
  await expect(preview).toContainText('could not be read')
  await search.fill('logo.png')
  await expect(rows.getByRole('button', { name: 'assets/logo.png Unsupported', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(4,
    'only selected supported files request a preview; unsupported paths remain disabled')
  await page.evaluate(() => { (window as any).__localFolderBrowseHarness.failPreview = true })
  await choose('src/151-file.md')
  await expect(browser.getByRole('alert')).toBeVisible()
  await expect(browser.getByRole('alert')).not.toContainText('private native preview detail')
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(5)
  await page.evaluate(() => { (window as any).__localFolderBrowseHarness.failPreview = false })
  await choose('src/151-file.md')
  await expect(preview.getByRole('region', { name: 'Preview of src/151-file.md' })).toContainText(PREVIEW_TEXT)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(6,
    'an explicit retry after a refused preview reads only the selected file')

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await browser.scrollIntoViewIfNeeded()
    await expectNoPageOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `local folder browser has no horizontal overflow at ${viewport.width}px` }).toBe(true)
    await assertWcag22Aa(page, `Local folder detail browser ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`local-folder-detail-browser-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }

  await page.setViewportSize(VIEWPORTS[4])
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(6)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  const lateRows = browser.getByRole('list', { name: 'Folder paths' })
  await browser.getByRole('searchbox', { name: 'Search paths' }).fill(LATE_DISMISS_PATH)
  await lateRows.getByRole('button', { name: `${LATE_DISMISS_PATH} File`, exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localFolderBrowseHarness.resolveDismissPreview)).toBe('function')
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.evaluate(({ path, text }) => (window as any).__localFolderBrowseHarness.resolveDismissPreview({
    version: 1, path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text },
  }), { path: LATE_DISMISS_PATH, text: PREVIEW_TEXT })
  await expect(page.getByText(PREVIEW_TEXT, { exact: true })).toHaveCount(0)

  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  const accountRows = browser.getByRole('list', { name: 'Folder paths' })
  await browser.getByRole('searchbox', { name: 'Search paths' }).fill(LATE_ACCOUNT_PATH)
  await accountRows.getByRole('button', { name: `${LATE_ACCOUNT_PATH} File`, exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localFolderBrowseHarness.resolveAccountPreview)).toBe('function')
  await switchAccount(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await page.evaluate(({ path, text }) => (window as any).__localFolderBrowseHarness.resolveAccountPreview({
    version: 1, path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text },
  }), { path: LATE_ACCOUNT_PATH, text: PREVIEW_TEXT })
  await expect(page.getByText(PREVIEW_TEXT, { exact: true })).toHaveCount(0)
})

test('picker attaches one frozen preview only after explicit Attach saved copy and acknowledgement', async ({ page }, info: TestInfo) => {
  test.setTimeout(ms(120_000))
  await addFolderBrowseFixture(page, 'Picker fixture')
  const made = await page.request.post(`${API}/sessions`, { data: {} })
  expect(made.ok(), await made.text()).toBeTruthy()
  const session = await made.json() as { id: string }
  const messagePosts: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/sessions/${session.id}/messages`)) {
      messagePosts.push(request.url())
    }
  })
  await page.goto(`/s/${session.id}`)
  const dialog = await folderPicker(page)
  const picker = dialog.locator('[data-native-folder-picker]')
  await picker.getByRole('button', { name: 'Browse files in Picker fixture', exact: true }).click()
  const browser = picker.locator('[data-local-folder-browser]')
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.filesCalls.length)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(0)
  await expect(dialog.locator('[data-attachment-preview]')).toHaveCount(0)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls)).toEqual([],
    'listing exposes metadata but does not read any file body')
  const pathButton = browser.getByRole('list', { name: 'Folder paths' }).getByRole('button', { name: 'src/004-file.md File', exact: true })
  await pathButton.press('Enter')
  const preview = browser.locator('[data-local-folder-file-preview]')
  await expect(preview.getByRole('region', { name: 'Preview of src/004-file.md' })).toContainText(PREVIEW_TEXT)
  const beforeAttach = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
  expect(JSON.stringify(beforeAttach)).not.toContain(PREVIEW_TEXT, 'listing and preview are transient until Attach saved copy')
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.snapshotCalls.length)).toBe(0)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.snapshotTreeCalls.length)).toBe(0)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectNoPageOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `local folder picker browser has no horizontal overflow at ${viewport.width}px` }).toBe(true)
    const attachSavedCopy = browser.getByRole('button', { name: 'Attach saved copy', exact: true })
    await attachSavedCopy.scrollIntoViewIfNeeded()
    await expect(attachSavedCopy).toBeVisible()
    await expect(attachSavedCopy).toBeEnabled()
    await expectPopoverContained(page, viewport.width, viewport.height, 'Local folder picker')
    await assertWcag22Aa(page, `Local folder picker browser ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`local-folder-picker-browser-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }

  await page.setViewportSize(VIEWPORTS[4])
  await page.evaluate(() => { (window as any).__localFolderBrowseHarness.text = 'Source changed after the shown preview.' })
  let releaseAttach!: () => void
  let attachSeen!: () => void
  const heldAttach = new Promise<void>(resolve => { releaseAttach = resolve })
  const requestSeen = new Promise<void>(resolve => { attachSeen = resolve })
  const attachedBodies: unknown[] = []
  await page.route(`**/sessions/${session.id}/context-state`, async route => {
    attachedBodies.push(route.request().postDataJSON())
    attachSeen()
    await heldAttach
    await route.continue()
  })
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).press('Enter')
  await requestSeen
  await expect(browser.getByRole('button', { name: 'Saving saved copy…', exact: true })).toBeDisabled()
  expect(attachedBodies).toHaveLength(1, 'one explicit preview submits one context mutation')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const reopened = await folderPicker(page)
  const reopenedPicker = reopened.locator('[data-native-folder-picker]')
  await reopenedPicker.getByRole('button', { name: 'Browse files in Picker fixture', exact: true }).click()
  const reopenedBrowser = reopenedPicker.locator('[data-local-folder-browser]')
  await expect(reopenedBrowser.getByRole('button', { name: 'Saving saved copy…', exact: true })).toBeDisabled()
  releaseAttach()
  await expect(reopenedBrowser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(reopened).toContainText('1 added')
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls)).toEqual([
    { id: ID, path: 'src/004-file.md', userId: 'user-ada' },
  ], 'attaching uses the already-frozen preview and performs no second native read')
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.snapshotCalls.length)).toBe(0)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.snapshotTreeCalls.length)).toBe(0)
  expect(messagePosts).toEqual([], 'opening, listing, previewing, and attaching a saved copy do not send a message or invoke model input')
  await reopened.getByRole('button', { name: 'Done', exact: true }).click()
  const saved = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
  expect(saved.workspace.attachments.find((item: any) => item.label === 'src/004-file.md')?.previewText)
    .toBe(PREVIEW_TEXT, 'the exact visible preview, not later source bytes, is persisted')
  expect(JSON.stringify(saved)).not.toContain('Source changed after the shown preview.')
})

test('Project context can browse and preview local folders but never attaches a copy or snapshot', async ({ page }, info: TestInfo) => {
  test.setTimeout(ms(120_000))
  await addFolderBrowseFixture(page, 'Project fixture')
  await signIntoAdaAndGrace(page)
  const projectName = `Folder browse read-only ${Date.now().toString(36)}`
  await createProject(page, projectName)
  const projectPath = new URL(page.url()).pathname
  const contextSection = page.locator('section.group\\/section').filter({
    has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
  })
  const contextHeading = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await contextHeading.getAttribute('aria-expanded') === 'false') await contextHeading.click()
  await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Folder/ }).click()
  await dialog.getByRole('button', { name: 'This computer', exact: true }).click()
  const picker = dialog.locator('[data-native-folder-picker]')
  await expect(picker.getByRole('button', { name: 'Attach Project fixture', exact: true })).toHaveCount(0)
  await picker.getByRole('button', { name: 'Browse files in Project fixture', exact: true }).click()
  const browser = picker.locator('[data-local-folder-browser]')
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.filesCalls.length)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls.length)).toBe(0)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  const row = browser.getByRole('list', { name: 'Folder paths' }).getByRole('button', { name: 'src/001-file.md File', exact: true })
  await row.press('Enter')
  const preview = browser.locator('[data-local-folder-file-preview]')
  await expect(preview.getByRole('region', { name: 'Preview of src/001-file.md' })).toContainText(PREVIEW_TEXT)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.fileCalls)).toEqual([
    { id: ID, path: 'src/001-file.md', userId: 'user-ada' },
  ])
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.snapshotCalls.length)).toBe(0)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.snapshotTreeCalls.length)).toBe(0)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectNoPageOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `Project folder browser has no horizontal overflow at ${viewport.width}px` }).toBe(true)
    await expectPopoverContained(page, viewport.width, viewport.height, 'Project folder picker')
    await assertWcag22Aa(page, `Project local folder browser ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`local-folder-project-browser-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])
  expect(new URL(page.url()).pathname).toBe(projectPath)
})

test('disconnect fences the visible preview before acknowledgement and after failure', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await addFolderBrowseFixture(page, 'Disconnect fixture')
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${ID}`)
  const detail = page.locator(`[data-local-folder-detail="${ID}"]`)
  const browser = detail.locator('[data-local-folder-browser]')
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  const row = browser.getByRole('list', { name: 'Folder paths' }).getByRole('button', { name: 'src/001-file.md File', exact: true })
  await row.click()
  await expect(browser.locator('[data-local-folder-file-preview]')).toContainText(PREVIEW_TEXT)

  expect(await browser.locator('[data-local-folder-browser-listing]').count()).toBe(1)
  expect(await browser.locator('[data-local-folder-file-preview]').count()).toBe(1)
  await page.evaluate(() => {
    const state = (window as any).__localFolderBrowseHarness
    state.holdNextDisconnect = true
    state.resolveDisconnect = undefined
    state.rejectDisconnect = undefined
  })
  await detail.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localFolderBrowseHarness.resolveDisconnect)).toBe('function')
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await expect(detail.getByRole('heading', { name: 'Disconnect fixture', exact: true })).toBeVisible()

  await page.evaluate(() => (window as any).__localFolderBrowseHarness.rejectDisconnect(new Error('private native disconnect detail')))
  await expect(detail.getByRole('alert')).toContainText('Could not confirm the access change.')
  await expect(detail.getByRole('button', { name: 'Check connections', exact: true })).toBeVisible()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await expect(page.getByText(PREVIEW_TEXT, { exact: true })).toHaveCount(0)

  await detail.getByRole('button', { name: 'Check connections', exact: true }).click()
  await expect(detail.getByRole('alert')).toHaveCount(0)
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeEnabled()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  await browser.getByRole('list', { name: 'Folder paths' }).getByRole('button', { name: 'src/001-file.md File', exact: true }).click()
  await expect(browser.locator('[data-local-folder-file-preview]')).toContainText(PREVIEW_TEXT)

  await page.evaluate(() => {
    const state = (window as any).__localFolderBrowseHarness
    state.holdNextDisconnect = true
    state.resolveDisconnect = undefined
    state.rejectDisconnect = undefined
  })
  await detail.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localFolderBrowseHarness.resolveDisconnect)).toBe('function')
  await expect(browser.locator('[data-local-folder-browser-listing]')).toHaveCount(0)
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await page.evaluate(() => (window as any).__localFolderBrowseHarness.resolveDisconnect())
  await expect(page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
  await expect(page.locator('[data-local-folder-browser]')).toHaveCount(0)
  await expect(page.getByText(PREVIEW_TEXT, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.rows)).toEqual([],
    'disconnect removes the native connection before its detail surface retires')
  expect(await page.evaluate(() => (window as any).__localFolderBrowseHarness.disconnectCalls)).toEqual([
    { id: ID, userId: 'user-ada' }, { id: ID, userId: 'user-ada' },
  ], 'failed disconnect is reconciled before an explicit retry and successful removal')
})
