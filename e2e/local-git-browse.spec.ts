import { test, expect, type Page } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { API, createProject } from './social-helpers.ts'
import { ms } from './budget.ts'

const GIT_ID = `GIT_${'A'.repeat(32)}`
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
const PRIVATE_LATE_TEXT = 'PRIVATE_STALE_LOCAL_GIT_PREVIEW_9F7A'

async function switchAccount(page: Page, optionText: string, expected: string) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click({ timeout: ms(10_000) })
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function signIntoAdaAndGrace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const ada = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(ada.ok(), await ada.text()).toBeTruthy()
  const grace = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(grace.ok(), await grace.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
}

async function expectNoOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    { message: `local Git browser has no page horizontal overflow at ${width}px` }).toBe(true)
}

async function addLargeNativeFixture(page: Page) {
  await page.addInitScript(({ connectionId, emptyPath, largePath, unreadablePath, lateDismissPath, lateAccountPath, lateText }) => {
    const entries: Array<{ path: string; kind: 'file' | 'conflict' | 'sparse' | 'unsupported' }> = Array.from({ length: 205 }, (_, index) => ({
      path: `src/${String(index).padStart(3, '0')}-file.md`, kind: 'file' as const,
    }))
    entries.push(
      { path: emptyPath, kind: 'file' },
      { path: largePath, kind: 'file' },
      { path: unreadablePath, kind: 'file' },
      { path: lateDismissPath, kind: 'file' },
      { path: lateAccountPath, kind: 'file' },
      { path: 'src/zzz-conflict.md', kind: 'conflict' },
      { path: 'src/zzz-sparse.md', kind: 'sparse' },
      { path: 'src/zzz-unsupported.bin', kind: 'unsupported' },
    )
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    const harness: any = {
      listCalls: 0, fileCalls: [], snapshotCalls: 0, holdNextList: false,
      resolveList: undefined, listing: undefined,
      resolveDismissPreview: undefined, resolveAccountPreview: undefined,
    }
    Object.defineProperty(window, '__localGitBrowseHarness', { configurable: true, value: harness })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada'
          ? [{ id: connectionId, name: 'Browse fixture', remembered: true }]
          : [],
        connect: async () => { throw new Error('browse acceptance must not connect repositories') },
        snapshot: async () => { harness.snapshotCalls += 1; throw new Error('browsing never captures a saved repository snapshot') },
        review: async () => { throw new Error('browse acceptance does not read the change review') },
        files: async (id: string, source: any) => {
          harness.listCalls++
          harness.listSources ??= []
          harness.listSources.push({ id, userId: source?.userId })
          const listing = { version: 1, files: entries, excludedCount: 1 }
          harness.listing = listing
          if (harness.holdNextList) {
            harness.holdNextList = false
            return await new Promise(resolve => { harness.resolveList = resolve })
          }
          return listing
        },
        file: async (id: string, selection: { path: string }, source: any) => {
          harness.fileCalls.push({ id, path: selection.path, userId: source?.userId })
          if (selection.path === lateDismissPath) return await new Promise(resolve => { harness.resolveDismissPreview = resolve })
          if (selection.path === lateAccountPath) return await new Promise(resolve => { harness.resolveAccountPreview = resolve })
          if (selection.path === largePath) return { version: 1, path: selection.path, sizeBytes: 65_537, snapshot: { omitted: 'too-large' } }
          if (selection.path === unreadablePath) return { version: 1, path: selection.path, sizeBytes: 0, snapshot: { omitted: 'unreadable' } }
          if (selection.path === emptyPath) return { version: 1, path: selection.path, sizeBytes: 0, snapshot: { text: '' } }
          return { version: 1, path: selection.path, sizeBytes: new TextEncoder().encode(lateText).byteLength, snapshot: { text: lateText } }
        },
        disconnect: async () => undefined,
      } } },
    })
  }, {
    connectionId: GIT_ID, emptyPath: EMPTY_PATH, largePath: LARGE_PATH,
    unreadablePath: UNREADABLE_PATH, lateDismissPath: LATE_DISMISS_PATH, lateAccountPath: LATE_ACCOUNT_PATH, lateText: PRIVATE_LATE_TEXT,
  })
}

test('local Git browsing is explicit, searchable, paged, omission-aware, and account-fenced', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  await addLargeNativeFixture(page)
  await signIntoAdaAndGrace(page)
  await page.goto(`/contexts/${GIT_ID}`)
  const detail = page.locator(`[data-local-git-detail="${GIT_ID}"]`)
  const browser = detail.locator('[data-local-git-browser]')
  await expect(detail.getByRole('heading', { name: 'Browse fixture' })).toBeVisible()
  await expect(browser.getByRole('heading', { name: 'Browse files', exact: true })).toBeVisible()
  await expect(browser.locator('[data-local-git-browser-listing]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localGitBrowseHarness.listCalls)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls.length)).toBe(0)
  await expect(browser.getByText('Browse limits and privacy', { exact: true })).toBeVisible()

  await page.evaluate(() => { (window as any).__localGitBrowseHarness.holdNextList = true })
  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localGitBrowseHarness.resolveList)).toBe('function')
  await expect(browser.getByRole('status')).toContainText('Reading bounded tracked-path metadata')
  await expect(browser.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(browser.getByRole('status')).toContainText('The previous read is finishing')
  await expect(browser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).__localGitBrowseHarness.resolveList((window as any).__localGitBrowseHarness.listing))
  await expect(browser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeEnabled()
  await expect(browser.locator('[data-local-git-browser-listing]')).toHaveCount(0)

  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toBeVisible()
  await expect(browser).toContainText('213 tracked paths')
  await expect(browser).toContainText('1 ignored paths excluded')
  await expect(browser).toContainText('bounded Git metadata and applicable ignore files')
  await expect.poll(() => page.evaluate(() => (window as any).__localGitBrowseHarness.listCalls)).toBe(2)
  expect(await page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls)).toEqual([])
  const list = browser.getByRole('list', { name: 'Tracked repository paths' })
  await expect(list.getByRole('listitem')).toHaveCount(100)
  await expect(browser).toContainText('page 1 of 3')

  const search = browser.getByRole('searchbox', { name: 'Search paths' })
  await search.fill('204-file')
  await expect(browser).toContainText('1 matching paths')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('src/204-file.md')
  await search.fill('')
  await expect(list.getByRole('listitem')).toHaveCount(100)
  await browser.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(browser).toContainText('page 2 of 3')
  await expect(list.getByRole('listitem')).toHaveCount(100)
  await list.getByRole('button', { name: 'src/150-file.md Tracked file', exact: true }).click()
  const preview = browser.locator('[data-local-git-file-preview]')
  await expect(preview.getByRole('region', { name: 'Preview of src/150-file.md' })).toContainText(PRIVATE_LATE_TEXT)
  await expect.poll(() => page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls)).toEqual([
    { id: GIT_ID, path: 'src/150-file.md', userId: 'user-ada' },
  ])
  const selectFilteredPath = async (path: string) => {
    await search.fill(path)
    const button = list.getByRole('button', { name: `${path} Tracked file`, exact: true })
    await expect(button).toBeVisible()
    await button.click()
  }
  await selectFilteredPath(EMPTY_PATH)
  await expect(preview.getByRole('region', { name: `Preview of ${EMPTY_PATH}` })).toBeVisible()
  await expect(preview.getByRole('region', { name: `Preview of ${EMPTY_PATH}` })).toHaveText('')
  await expect(preview).toContainText('0 bytes')
  await expect(preview).toContainText('Empty file (0 bytes).')
  await selectFilteredPath(LARGE_PATH)
  await expect(preview).toContainText('This file exceeds the 64 KiB preview limit; no content was returned.')
  await selectFilteredPath(UNREADABLE_PATH)
  await expect(preview).toContainText('The file could not be read; no content was returned.')
  await search.fill('zzz-conflict')
  const conflict = list.getByRole('button', { name: 'src/zzz-conflict.md Conflict', exact: true })
  await expect(conflict).toBeDisabled()
  await search.fill('zzz-sparse')
  const sparse = list.getByRole('button', { name: 'src/zzz-sparse.md Sparse checkout', exact: true })
  await expect(sparse).toBeDisabled()
  await search.fill('zzz-unsupported')
  const unsupported = list.getByRole('button', { name: 'src/zzz-unsupported.bin Unsupported', exact: true })
  await expect(unsupported).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls.length)).toBe(4,
    'only explicitly chosen supported paths requested previews')

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await browser.scrollIntoViewIfNeeded()
    await expectNoOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `browser section has no horizontal overflow at ${viewport.width}px` }).toBe(true)
    await assertWcag22Aa(page, `local Git detail browser ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`local-git-browser-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])

  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls.length)).toBe(4)

  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toBeVisible()
  const lateDismissList = browser.getByRole('list', { name: 'Tracked repository paths' })
  await browser.getByRole('searchbox', { name: 'Search paths' }).fill(LATE_DISMISS_PATH)
  const lateDismiss = lateDismissList.getByRole('button', { name: `${LATE_DISMISS_PATH} Tracked file`, exact: true })
  await lateDismiss.click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localGitBrowseHarness.resolveDismissPreview)).toBe('function')
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(browser.getByRole('status')).toContainText('The previous read is finishing')
  await expect(browser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeDisabled()
  await page.evaluate(({ path, text }) => (window as any).__localGitBrowseHarness.resolveDismissPreview({
    version: 1, path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text },
  }), { path: LATE_DISMISS_PATH, text: PRIVATE_LATE_TEXT })
  await expect(browser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeEnabled()
  await expect(page.getByText(PRIVATE_LATE_TEXT, { exact: true })).toHaveCount(0)

  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toBeVisible()
  const lateAccountList = browser.getByRole('list', { name: 'Tracked repository paths' })
  await browser.getByRole('searchbox', { name: 'Search paths' }).fill(LATE_ACCOUNT_PATH)
  await lateAccountList.getByRole('button', { name: `${LATE_ACCOUNT_PATH} Tracked file`, exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localGitBrowseHarness.resolveAccountPreview)).toBe('function')
  expect(await page.evaluate(() => (window as any).__localGitBrowseHarness.fileCalls.length)).toBe(6)
  const beforeSwitch = await page.evaluate(() => (window as any).__localGitBrowseHarness)
  expect(beforeSwitch.snapshotCalls).toBe(0)
  expect(beforeSwitch.listSources.every((entry: any) => entry.id === GIT_ID && entry.userId === 'user-ada')).toBe(true)
  await switchAccount(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.locator('[data-local-git-file-preview]')).toHaveCount(0)
  await page.evaluate(({ path, text }) => (window as any).__localGitBrowseHarness.resolveAccountPreview({
    version: 1, path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text },
  }), { path: LATE_ACCOUNT_PATH, text: PRIVATE_LATE_TEXT })
  await expect(page.getByText(PRIVATE_LATE_TEXT, { exact: true })).toHaveCount(0)
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
  await expect(page.locator('[data-local-git-file-preview]')).toHaveCount(0)
})

test('picker attaches only an explicitly previewed frozen copy and never rereads on Attach saved copy', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(VIEWPORTS[4])
  await page.addInitScript(({ connectionId }) => {
    const harness = { filesCalls: 0, fileCalls: [] as string[], snapshotCalls: 0, text: 'Frozen preview bytes before attach.' }
    Object.defineProperty(window, '__localGitPickerBrowseHarness', { configurable: true, value: harness })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada' ? [{ id: connectionId, name: 'Picker fixture', remembered: true }] : [],
        connect: async () => { throw new Error('picker browsing must not reconnect repositories') },
        snapshot: async () => { harness.snapshotCalls++; throw new Error('browsing and saved-copy attachment never capture snapshots') },
        review: async () => { throw new Error('picker browsing never reads changes') },
        files: async () => {
          harness.filesCalls++
          return { version: 1, files: [{ path: 'src/frozen.md', kind: 'file' }], excludedCount: 0 }
        },
        file: async (_id: string, selection: { path: string }) => {
          harness.fileCalls.push(selection.path)
          const text = harness.text
          return { version: 1, path: selection.path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text } }
        },
        disconnect: async () => undefined,
      } } },
    })
  }, { connectionId: GIT_ID })
  const made = await page.request.post(`${API}/sessions`, { data: { firstMessage: 'Git browse picker fixture', persistFirstMessage: true } })
  expect(made.ok(), await made.text()).toBeTruthy()
  const session = await made.json() as { id: string }
  await page.goto(`/s/${session.id}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const gitPicker = dialog.locator('[data-native-git-picker]')
  const browseToggle = gitPicker.getByRole('button', { name: 'Browse files in Picker fixture', exact: true })
  await expect(browseToggle).toBeVisible()
  await browseToggle.click()
  const browser = gitPicker.locator('[data-local-git-browser]')
  await expect(browser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeVisible()
  await expect(browser.getByText('Browse limits and privacy', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitPickerBrowseHarness.filesCalls)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localGitPickerBrowseHarness.fileCalls.length)).toBe(0)
  await expect(dialog.locator('[data-attachment-preview]')).toHaveCount(0)
  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitPickerBrowseHarness.fileCalls.length)).toBe(0)
  const frozenPath = browser.getByRole('list', { name: 'Tracked repository paths' }).getByRole('button', { name: 'src/frozen.md Tracked file', exact: true })
  await frozenPath.press('Enter')
  const preview = browser.locator('[data-local-git-file-preview]')
  await expect(preview.getByRole('region', { name: 'Preview of src/frozen.md' })).toContainText('Frozen preview bytes before attach.')
  await expect(browser).toContainText('It is available to model input when the conversation is next sent; attaching does not send a message or call the model.')
  const beforeAttach = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
  expect(JSON.stringify(beforeAttach)).not.toContain('Frozen preview bytes before attach.',
    'listing and preview alone do not persist the source text')

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectNoOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `picker browser has no horizontal overflow at ${viewport.width}px` }).toBe(true)
    const attachSavedCopy = browser.getByRole('button', { name: 'Attach saved copy', exact: true })
    await attachSavedCopy.scrollIntoViewIfNeeded()
    await expect(attachSavedCopy).toBeVisible()
    await expect(attachSavedCopy).toBeEnabled()
    await expect.poll(() => attachSavedCopy.evaluate(node => {
      const rect = node.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight
    }), { message: `Attach saved copy is reachable at ${viewport.width}x${viewport.height}` }).toBe(true)
    await assertWcag22Aa(page, `local Git picker browser ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`local-git-picker-browser-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])

  await page.evaluate(() => { (window as any).__localGitPickerBrowseHarness.text = 'Changed after the captured preview.' })
  let releaseAttach!: () => void
  let observeAttach!: () => void
  const heldAttach = new Promise<void>(resolve => { releaseAttach = resolve })
  const attachSeen = new Promise<void>(resolve => { observeAttach = resolve })
  let attachRequests = 0
  await page.route(`**/api/v1/sessions/${session.id}/context-state`, async route => {
    attachRequests++
    observeAttach()
    await heldAttach
    await route.continue()
  })
  const attachSavedCopy = browser.getByRole('button', { name: 'Attach saved copy', exact: true })
  await attachSavedCopy.press('Enter')
  await attachSeen
  const pendingSavedCopy = browser.getByRole('button', { name: 'Saving saved copy…', exact: true })
  await expect(pendingSavedCopy).toBeDisabled()
  await expect(dialog).not.toContainText('1 added', { timeout: 250 })
  expect(attachRequests).toBe(1, 'the exact preview intent enqueues only one attachment while awaiting acknowledgement')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const reopenedDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await reopenedDialog.getByRole('button', { name: /^Repository/ }).click()
  const reopenedPicker = reopenedDialog.locator('[data-native-git-picker]')
  await reopenedPicker.getByRole('button', { name: 'Browse files in Picker fixture', exact: true }).click()
  const reopenedBrowser = reopenedPicker.locator('[data-local-git-browser]')
  await expect(reopenedBrowser.getByRole('button', { name: 'Saving saved copy…', exact: true })).toBeDisabled()
  expect(attachRequests).toBe(1, 'closing and reopening while the context mutation is pending does not enqueue a duplicate')
  releaseAttach()
  await expect(reopenedBrowser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(reopenedDialog).toContainText('1 added')
  expect(await page.evaluate(() => (window as any).__localGitPickerBrowseHarness.fileCalls)).toEqual(['src/frozen.md'])
  expect(await page.evaluate(() => (window as any).__localGitPickerBrowseHarness.snapshotCalls)).toBe(0)
  await reopenedDialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const acknowledgedDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await acknowledgedDialog.getByRole('button', { name: /^Repository/ }).click()
  const acknowledgedPicker = acknowledgedDialog.locator('[data-native-git-picker]')
  await acknowledgedPicker.getByRole('button', { name: 'Browse files in Picker fixture', exact: true }).click()
  await expect(acknowledgedPicker.locator('[data-local-git-browser]').getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(acknowledgedDialog).toContainText('1 added')
  expect(attachRequests).toBe(1, 'reopening after acknowledgement preserves Added without enqueueing another mutation')
  await acknowledgedDialog.getByRole('button', { name: 'Done', exact: true }).click()
  const attachmentPreview = page.locator('[data-attachment-preview]').filter({ visible: true })
  await expect(attachmentPreview).toContainText('Frozen preview bytes before attach.')
  await expect(attachmentPreview).not.toContainText('Changed after the captured preview.')
  await expect.poll(() => page.evaluate(() => (window as any).__localGitPickerBrowseHarness.fileCalls.length)).toBe(1)
  const sessionBody = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
  expect(sessionBody.workspace.attachments.find((item: any) => item.label === 'src/frozen.md')?.previewText)
    .toBe('Frozen preview bytes before attach.', 'the explicit saved-copy action persists exactly the already shown text')
})

test('a draft saved preview remains Added after first send materializes its session', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.addInitScript(({ connectionId }) => {
    const harness = { listCalls: 0, fileCalls: 0 }
    Object.defineProperty(window, '__localGitDraftBrowseHarness', { configurable: true, value: harness })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada' ? [{ id: connectionId, name: 'Draft browse fixture', remembered: true }] : [],
        connect: async () => { throw new Error('draft browsing must not reconnect repositories') },
        snapshot: async () => { throw new Error('saved preview attachment never captures a snapshot') },
        review: async () => { throw new Error('draft browsing never reads changes') },
        files: async () => {
          harness.listCalls++
          return { version: 1, files: [{ path: 'src/draft-preview.md', kind: 'file' }], excludedCount: 0 }
        },
        file: async (_id: string, selection: { path: string }) => {
          harness.fileCalls++
          const text = 'Draft preview bytes survive first send.'
          return { version: 1, path: selection.path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text } }
        },
        disconnect: async () => undefined,
      } } },
    })
  }, { connectionId: GIT_ID })
  await signIntoAdaAndGrace(page)
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeVisible()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const picker = dialog.locator('[data-native-git-picker]')
  await picker.getByRole('button', { name: 'Browse files in Draft browse fixture', exact: true }).click()
  const browser = picker.locator('[data-local-git-browser]')
  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await browser.getByRole('list', { name: 'Tracked repository paths' })
    .getByRole('button', { name: 'src/draft-preview.md Tracked file', exact: true }).press('Enter')
  await expect(browser.locator('[data-local-git-file-preview]')).toContainText('Draft preview bytes survive first send.')
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(dialog).toContainText('1 added')
  await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__localGitDraftBrowseHarness.fileCalls)).toBe(1)

  await composer.fill('Send the explicit preview with this first message.')
  await composer.press('Enter')
  await expect(page).toHaveURL(/\/s\/[^/?#]+$/, { timeout: ms(20_000) })
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!)
  let savedId = ''
  await expect.poll(async () => {
    const response = await page.request.get(`${API}/sessions/${sessionId}`)
    if (!response.ok()) return false
    const body = await response.json()
    const saved = body.workspace?.attachments?.find((item: any) => item.label === 'src/draft-preview.md')
    if (!saved) return false
    savedId = saved.id
    return saved.previewText
  }, { message: 'the first send materializes the draft preview attachment', timeout: ms(20_000) }).toBe('Draft preview bytes survive first send.')

  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const reopened = page.getByRole('dialog', { name: 'Add context', exact: true })
  await reopened.getByRole('button', { name: /^Repository/ }).click()
  const reopenedPicker = reopened.locator('[data-native-git-picker]')
  await reopenedPicker.getByRole('button', { name: 'Browse files in Draft browse fixture', exact: true }).click()
  const reopenedBrowser = reopenedPicker.locator('[data-local-git-browser]')
  await expect(reopened).toContainText('1 added')
  await expect(reopenedBrowser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(reopenedBrowser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  const finalBody = await (await page.request.get(`${API}/sessions/${sessionId}`)).json()
  const copies = finalBody.workspace.attachments.filter((item: any) => item.id === savedId)
  expect(copies).toHaveLength(1, 'reopening after draft materialization does not create a second saved attachment')
  expect(await page.evaluate(() => (window as any).__localGitDraftBrowseHarness.fileCalls)).toBe(1)
})

test('Project context can browse and preview local Git but never offers saved-copy attachment', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(VIEWPORTS[4])
  await page.addInitScript(({ connectionId }) => {
    const harness = { listCalls: 0, fileCalls: [] as string[], snapshotCalls: 0 }
    Object.defineProperty(window, '__localGitProjectBrowseHarness', { configurable: true, value: harness })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada' ? [{ id: connectionId, name: 'Project browse fixture', remembered: true }] : [],
        connect: async () => { throw new Error('project browsing must not reconnect repositories') },
        snapshot: async () => { harness.snapshotCalls++; throw new Error('project browsing never captures a saved snapshot') },
        review: async () => { throw new Error('project browsing does not read changes') },
        files: async () => {
          harness.listCalls++
          return { version: 1, files: [{ path: 'src/project-preview.md', kind: 'file' }], excludedCount: 0 }
        },
        file: async (_id: string, selection: { path: string }) => {
          harness.fileCalls.push(selection.path)
          const text = 'Project preview remains descriptive only.'
          return { version: 1, path: selection.path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text } }
        },
        disconnect: async () => undefined,
      } } },
    })
  }, { connectionId: GIT_ID })
  await signIntoAdaAndGrace(page)
  const projectName = `Git browse read-only ${Date.now().toString(36)}`
  await createProject(page, projectName)
  const projectPath = new URL(page.url()).pathname
  const contextSection = page.locator('section.group\\/section').filter({
    has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
  })
  const contextHeading = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await contextHeading.getAttribute('aria-expanded') === 'false') await contextHeading.click()
  await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const nativePicker = dialog.locator('[data-native-git-picker]')
  await expect(nativePicker.getByRole('button', { name: 'Attach Project browse fixture', exact: true })).toHaveCount(0)
  await expect(nativePicker).not.toContainText('Save a read-only copy of top-level text files')
  await nativePicker.getByRole('button', { name: 'Browse files in Project browse fixture', exact: true }).click()
  const browser = nativePicker.locator('[data-local-git-browser]')
  await expect.poll(() => page.evaluate(() => (window as any).__localGitProjectBrowseHarness.listCalls)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localGitProjectBrowseHarness.fileCalls.length)).toBe(0)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toBeVisible()
  const path = browser.getByRole('list', { name: 'Tracked repository paths' }).getByRole('button', { name: 'src/project-preview.md Tracked file', exact: true })
  await path.press('Enter')
  const preview = browser.locator('[data-local-git-file-preview]')
  await expect(preview.getByRole('region', { name: 'Preview of src/project-preview.md' })).toContainText('Project preview remains descriptive only.')
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await expect(browser).not.toContainText('Attach saved copy is a separate choice')
  expect(await page.evaluate(() => (window as any).__localGitProjectBrowseHarness.fileCalls)).toEqual(['src/project-preview.md'])
  expect(await page.evaluate(() => (window as any).__localGitProjectBrowseHarness.snapshotCalls)).toBe(0)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectNoOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `Project browser has no horizontal overflow at ${viewport.width}px` }).toBe(true)
    await assertWcag22Aa(page, `Project local Git browser ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`local-git-project-browser-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])
  expect(new URL(page.url()).pathname).toBe(projectPath)
})
