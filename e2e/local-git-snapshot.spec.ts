import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { startMessagesFixture } from './attachment-endpoint.ts'
import { ms } from './budget.ts'
import { API, newUser } from './social-helpers.ts'
import { settledAttachmentPreview } from './accessibility-helpers.ts'

const GIT_ID = `GIT_${'A'.repeat(32)}`
const FOLDER_ID = `ui-host::${GIT_ID}`
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

async function expectContained(page: Page, subject: Locator) {
  await subject.scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const box = await subject.boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport && box.x >= 4 && box.y >= 4
      && box.x + box.width <= viewport.width - 4
      && box.y + box.height <= viewport.height - 4
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function settleFiniteMotion(page: Page) {
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter(animation => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return typeof endTime === 'number' && Number.isFinite(endTime)
    })
    await Promise.allSettled(animations.map(animation => animation.finished))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function expectPopoverContained(page: Page, dialog: Locator, done: Locator) {
  await expect.poll(async () => {
    const frame = await dialog.boundingBox()
    const footer = await done.boundingBox()
    const viewport = page.viewportSize()
    return !!frame && !!footer && !!viewport && frame.x >= 0 && frame.y >= 0
      && frame.x + frame.width <= viewport.width && frame.y + frame.height <= viewport.height
      && footer.x >= frame.x && footer.y >= frame.y
      && footer.x + footer.width <= frame.x + frame.width
      && footer.y + footer.height <= frame.y + frame.height
      && footer.x + footer.width <= viewport.width && footer.y + footer.height <= viewport.height
  }, { message: 'the Add context popover and its Done action stay inside the viewport' }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function captureMatrix(page: Page, subject: Locator, testInfo: { outputPath: (path: string) => string }, state: string, options: { dialog?: Locator; done?: Locator; preview?: string; file?: RegExp } = {}) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    if (options.preview) await settledAttachmentPreview(page, options.preview)
    else await settleFiniteMotion(page)
    // Responsive panel hosts remount at tier boundaries. Open the intended
    // saved file in each host instead of screenshotting its default selection.
    if (options.file) await page.locator(options.preview!).filter({ visible: true }).getByRole('button', { name: options.file }).click()
    await expect(subject).toBeVisible()
    if (options.dialog && options.done) await expectPopoverContained(page, options.dialog, options.done)
    else await expectContained(page, subject)
    await page.screenshot({ path: testInfo.outputPath(`local-git-${state}-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])
  if (options.preview) await settledAttachmentPreview(page, options.preview)
  else await settleFiniteMotion(page)
}

function sessionFolders(session: any) {
  return session?.workspace?.workspaces?.flatMap((workspace: any) => workspace?.folders ?? []) ?? []
}

async function switchAccount(page: Page, optionText: string, expected: string) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

test('native Git repository attaches saved tracked text and refreshes only on explicit action', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const fixture = await startMessagesFixture()
  const stamp = Date.now().toString(36)
  try {
    await page.addInitScript(() => {
      ;(window as any).__nativeGitText = 'Saved tracked repository text.'
      ;(window as any).__nativeGitCalls = []
      Object.defineProperty(window, 'agentCommonsDesktop', {
        configurable: false,
        value: { context: { localGit: {
          list: async (source: unknown) => {
            ;(window as any).__nativeGitCalls.push(['list', source])
            return []
          },
          connect: async (input: { remember: boolean }, source: unknown) => {
            ;(window as any).__nativeGitCalls.push(['connect', input, source])
            return { status: 'connected', connection: { id: `GIT_${'A'.repeat(32)}`, name: 'Commons', remembered: input.remember } }
          },
          snapshot: async (id: string, source: unknown) => {
            const text = (window as any).__nativeGitText as string
            ;(window as any).__nativeGitCalls.push(['snapshot', id, source, text])
            return { name: 'Commons', files: [
              { path: 'assets/icon.png', sizeBytes: 0, snapshot: { omitted: 'unsupported' } },
              { path: 'src/nested/notes.md', sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text } },
            ] }
          },
          disconnect: async (id: string, source: unknown) => { (window as any).__nativeGitCalls.push(['disconnect', id, source]) },
        } } },
      })
    })
    const providerResponse = await page.request.post('/api/v1/providers', { data: {
      label: `Local Git ${stamp}`, modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: fixture.url, model: 'e2e-attachment-model' },
    } })
    expect(providerResponse.ok()).toBeTruthy()
    const provider = await providerResponse.json()
    const created = await page.request.post('/api/v1/sessions', { data: { providerId: provider.id } })
    expect(created.ok()).toBeTruthy()
    const session = await created.json() as { id: string }

    await page.goto(`/s/${session.id}`)
    await page.getByRole('button', { name: 'Add context' }).click()
    const picker = page.getByRole('dialog', { name: 'Add context' })
    await picker.getByRole('button', { name: /^Repository/ }).click()
    const repoPicker = picker.locator('[data-native-git-picker]')
    await expect(repoPicker).toContainText('This computer')
    await captureMatrix(page, repoPicker.getByText('This computer', { exact: true }), testInfo, 'picker', {
      dialog: picker, done: picker.getByRole('button', { name: 'Done', exact: true }),
    })
    const limits = repoPicker.locator('summary', { hasText: 'Capture limits and exclusions' })
    await limits.click()
    await expect(repoPicker).toContainText('more than 500 tracked entries cannot be captured')
    await expect(repoPicker).toContainText('Tracked working-tree files include uncommitted edits')
    await expect(repoPicker).toContainText('global Git configuration is not used')
    await limits.click()
    await page.setViewportSize(VIEWPORTS[0])
    await settleFiniteMotion(page)
    const pickerBody = picker.locator('[data-fs-picker-body]')
    await expect(pickerBody).toBeVisible()
    await expectPopoverContained(page, picker, picker.getByRole('button', { name: 'Done', exact: true }))
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Add context' }).click()
    const reopenedPicker = page.getByRole('dialog', { name: 'Add context' })
    await reopenedPicker.getByRole('button', { name: /^Repository/ }).click()
    const reopenedRepoPicker = reopenedPicker.locator('[data-native-git-picker]')
    await reopenedRepoPicker.getByRole('checkbox', { name: /Remember this connection/ }).click()
    await reopenedRepoPicker.getByRole('button', { name: /Choose a repository from this computer/ }).click()
    const attach = reopenedRepoPicker.getByRole('button', { name: 'Attach Commons' })
    await expect(attach).toBeVisible()
    await expect(reopenedRepoPicker).toContainText('Remembered on this device')
    await attach.click()
    await expect(reopenedPicker).toContainText('1 added')
    await reopenedPicker.getByRole('button', { name: 'Done', exact: true }).click()

    const folderId = FOLDER_ID
    const savedState = async () => await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    const savedText = (folder: any) => folder?.gitSnapshot?.files?.find((file: { path: string }) => file.path === 'src/nested/notes.md')?.snapshot?.text
    const savedById = (session: any) => sessionFolders(session).find((folder: { id: string }) => folder.id === folderId)
    await expect.poll(async () => savedText(savedById(await savedState()))).toBe('Saved tracked repository text.')
    const savedFolder = savedById(await savedState())
    expect(savedFolder.localSnapshot).toBeUndefined()
    expect(JSON.stringify(savedFolder)).not.toContain('/private/')

    const folderGroup = page.locator(`[data-workspace-folder="${folderId}"]`)
    await expect(folderGroup).toContainText('Saved Git snapshot')
    await folderGroup.getByRole('button', { name: /^src\/nested\/notes\.md(?: |$)/ }).click()
    const preview = page.locator('[data-folder-snapshot-preview]')
    await expect(preview).toContainText('Saved tracked repository text.')
    await expect(preview).toContainText('opening and sending do not read the repository')
    await expect(folderGroup).toContainText('1 tracked file(s) have no saved text')
    await captureMatrix(page, preview.locator('p').first(), testInfo, 'saved-preview', { preview: '[data-workspace-folder="' + folderId + '"]', file: /^src\/nested\/notes\.md(?: |$)/ })
    expect(await page.evaluate(() => (window as any).__nativeGitCalls.filter((call: unknown[]) => call[0] === 'snapshot').length)).toBe(1)

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Summarize the saved repository note.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment: Saved tracked repository text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.documents.at(-1)?.attached_files).toContainEqual({ name: 'Commons/src/nested/notes.md', status: 'ready', text: 'Saved tracked repository text.' })
    expect(await page.evaluate(() => (window as any).__nativeGitCalls.filter((call: unknown[]) => call[0] === 'snapshot').length)).toBe(1,
      'opening the preview and sending use the saved copy without another source read')

    await page.evaluate(() => { (window as any).__nativeGitText = 'Explicitly refreshed tracked text.' })
    const refreshRequests: unknown[] = []
    await page.route(`**/api/v1/sessions/${session.id}/workspace/folders/**/local-git-refresh`, async route => {
      refreshRequests.push(route.request().postDataJSON())
      if (refreshRequests.length === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Temporary Git refresh outage' } }) })
        return
      }
      await route.continue()
    })
    await folderGroup.getByRole('button', { name: 'Refresh Commons' }).click()
    const recovery = page.locator('[data-context-pane] [role="alert"], [data-overlay-dock] [role="alert"]')
      .filter({ hasText: 'Temporary Git refresh outage', visible: true })
    await expect(recovery).toBeVisible()
    await captureMatrix(page, recovery, testInfo, 'refresh-recovery', { preview: '[data-workspace-folder="' + folderId + '"]' })
    expect(savedText(savedById(await savedState()))).toBe('Saved tracked repository text.')
    expect(await page.evaluate(() => (window as any).__nativeGitCalls.filter((call: unknown[]) => call[0] === 'snapshot').length)).toBe(2,
      'failed delivery retains the exact captured snapshot for retry')
    await recovery.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(async () => savedText(savedById(await savedState()))).toBe('Explicitly refreshed tracked text.')
    expect(await page.evaluate(() => (window as any).__nativeGitCalls.filter((call: unknown[]) => call[0] === 'snapshot').length)).toBe(2)
    expect(refreshRequests).toHaveLength(2)
    expect(refreshRequests[1]).toEqual(refreshRequests[0], 'retry reuses the exact saved snapshot bytes and receipt')
    const refreshed = savedById(await savedState())
    expect(refreshed.gitSnapshot.snapshotId).not.toBe(savedFolder.gitSnapshot.snapshotId)
    await expect(folderGroup).toContainText('Tracked working-tree files include uncommitted edits')

    // Reload restores the capture. Preview and model input remain saved-only.
    await page.reload()
    const reloadedGroup = page.locator(`[data-workspace-folder="${folderId}"]`)
    await settledAttachmentPreview(page, `[data-workspace-folder="${folderId}"]`)
    await reloadedGroup.getByRole('button', { name: /^src\/nested\/notes\.md(?: |$)/ }).click()
    await expect(preview).toContainText('Explicitly refreshed tracked text.')
    expect(await page.evaluate(() => (window as any).__nativeGitCalls.filter((call: unknown[]) => call[0] === 'snapshot').length)).toBe(0)
    await composer.fill('Use the saved repository note after reload.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment: Explicitly refreshed tracked text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.documents.at(-1)?.attached_files).toContainEqual({ name: 'Commons/src/nested/notes.md', status: 'ready', text: 'Explicitly refreshed tracked text.' })
    expect(await page.evaluate(() => (window as any).__nativeGitCalls.filter((call: unknown[]) => call[0] === 'snapshot').length)).toBe(0)
  } finally {
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})

test('saved Git copy is readable by an authorized conversation audience, walled from a foreign tenant, and survives Disconnect', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const shared = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const text = `Owner saved Git text ${Date.now().toString(36)}`
  try {
    await owner.page.addInitScript(({ id, text }) => {
      Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: { context: { localGit: {
        list: async () => [{ id, name: 'Commons', remembered: true }],
        connect: async () => ({ status: 'connected', connection: { id, name: 'Commons', remembered: true } }),
        snapshot: async () => ({ name: 'Commons', files: [{ path: 'src/nested/notes.md', sizeBytes: text.length, snapshot: { text } }] }),
        disconnect: async () => undefined,
      } } } })
    }, { id: GIT_ID, text })
    const made = await owner.page.request.post(`${API}/sessions`, { data: { firstMessage: `Git audience snapshot ${Date.now().toString(36)}`, persistFirstMessage: true } })
    expect(made.ok(), await made.text()).toBeTruthy()
    const session = await made.json() as { id: string }
    const url = `/s/${encodeURIComponent(session.id)}`
    await owner.page.goto(url)
    await owner.page.getByRole('button', { name: 'Add context' }).click()
    const dialog = owner.page.getByRole('dialog', { name: 'Add context' })
    await dialog.getByRole('button', { name: /^Repository/ }).click()
    const gitPicker = dialog.locator('[data-native-git-picker]')
    await expect(gitPicker.getByRole('button', { name: 'Attach Commons' })).toBeVisible()
    await gitPicker.getByRole('button', { name: 'Attach Commons' }).click()
    await expect(dialog).toContainText('1 added')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const folder = owner.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`)
    await folder.getByRole('button', { name: /^src\/nested\/notes\.md(?: |$)/ }).click()
    const preview = owner.page.locator('[data-folder-snapshot-preview]')
    await expect(preview).toContainText(text)

    const foreignBefore = await foreign.page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
    expect(foreignBefore.status()).toBe(404, 'a foreign tenant cannot read the unshared saved copy')
    const sharedBefore = await shared.page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
    expect(sharedBefore.status()).toBe(404, 'the audience is walled until the owner grants access')

    await owner.page.getByRole('button', { name: 'Share this conversation' }).click()
    await owner.page.getByLabel('Audience id').fill('tenant-beta')
    await owner.page.getByLabel('Tier').selectOption({ label: 'Comment' })
    await owner.page.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(owner.page.getByText('tenant-beta')).toBeVisible()
    await owner.page.keyboard.press('Escape')
    await expect(owner.page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)

    const sharedRead = await shared.page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
    expect(sharedRead.ok(), await sharedRead.text()).toBeTruthy()
    const sharedSession = await sharedRead.json()
    expect(sessionFolders(sharedSession).find((row: { id: string }) => row.id === FOLDER_ID)?.gitSnapshot?.files?.[0]?.snapshot?.text).toBe(text)
    await shared.page.goto(url)
    const sharedFolder = shared.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`)
    await sharedFolder.getByRole('button', { name: /^src\/nested\/notes\.md(?: |$)/ }).click()
    const sharedPreview = shared.page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
    await expect(sharedPreview).toContainText(text)
    await expect(sharedFolder).toContainText('Only the conversation owner can refresh this copy.')
    await expect(sharedFolder.getByRole('button', { name: /^Refresh / })).toHaveCount(0)
    await expect(sharedFolder.getByRole('button', { name: /^(Add|Attach|Remove) / })).toHaveCount(0)
    await expect(shared.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await shared.page.setViewportSize(viewport)
      await settledAttachmentPreview(shared.page, `[data-workspace-folder="${FOLDER_ID}"]`)
      await expect(sharedPreview.locator('p').first()).toBeInViewport({ ratio: 1 })
      await expect.poll(() => shared.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await shared.page.screenshot({ path: testInfo.outputPath(`local-git-shared-${viewport.width}x${viewport.height}.png`), fullPage: true })
    }
    const foreignAfter = await foreign.page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
    expect(foreignAfter.status()).toBe(404, 'the grant does not expose the saved copy to another tenant')

    await foreign.page.addInitScript(({ id }) => {
      Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: { context: { localGit: {
        list: async () => [], connect: async () => ({ status: 'cancelled' }), snapshot: async () => ({ name: 'Unavailable', files: [] }), disconnect: async () => undefined,
      } } } })
    }, { id: GIT_ID })
    await foreign.page.goto(`/contexts/${GIT_ID}`)
    await expect(foreign.page.getByText('This repository connection is not available to this account on this device. Saved snapshots remain in their conversations.', { exact: true })).toBeVisible()
    await expect(foreign.page.getByText(text, { exact: false })).toHaveCount(0)

    await owner.page.getByRole('button', { name: 'Add context' }).click()
    const managePicker = owner.page.getByRole('dialog', { name: 'Add context' })
    await managePicker.getByRole('button', { name: /^Repository/ }).click()
    await managePicker.locator('[data-native-git-picker]').getByRole('button', { name: 'Manage Commons' }).click()
    const detail = owner.page.locator(`[data-local-git-detail="${GIT_ID}"]`)
    await expect(detail.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
    await captureMatrix(owner.page, detail.locator('header'), testInfo, 'management')
    await detail.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(owner.page.getByText('This repository connection is not available to this account on this device.')).toBeVisible()
    const afterDisconnect = await owner.page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
    const savedAfterDisconnect = sessionFolders(await afterDisconnect.json()).find((row: { id: string }) => row.id === FOLDER_ID)
    expect(savedAfterDisconnect?.gitSnapshot?.files?.find((file: { path: string }) => file.path === 'src/nested/notes.md')?.snapshot?.text).toBe(text)
    await owner.page.goto(url)
    const savedAfterDisconnectRow = owner.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`)
    await savedAfterDisconnectRow.getByRole('button', { name: /^src\/nested\/notes\.md(?: |$)/ }).click()
    await expect(owner.page.locator('[data-folder-snapshot-preview]')).toContainText(text)
  } finally {
    await owner.context.close()
    await shared.context.close()
    await foreign.context.close()
  }
})

test('switching accounts fences a pending native Git capture before it can attach', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.addInitScript(({ id }) => {
    ;(window as any).__nativeGitCaptureStarted = false
    ;(window as any).__nativeGitCaptureResolved = false
    Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: { context: { localGit: {
      list: async () => [{ id, name: 'Pending Commons', remembered: true }],
      connect: async () => ({ status: 'connected', connection: { id, name: 'Pending Commons', remembered: true } }),
      snapshot: async () => {
        ;(window as any).__nativeGitCaptureStarted = true
        return await new Promise(resolve => {
          ;(window as any).__resolveNativeGitCapture = (value: unknown) => {
            ;(window as any).__nativeGitCaptureResolved = true
            resolve(value)
          }
        })
      },
      disconnect: async () => undefined,
    } } } })
  }, { id: GIT_ID })
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const adaLogin = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(adaLogin.ok()).toBeTruthy()
  const graceLogin = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(graceLogin.ok()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')

  const created = await page.request.post(`${API}/sessions`, { data: { firstMessage: `Pending native Git ${Date.now().toString(36)}`, persistFirstMessage: true } })
  expect(created.ok(), await created.text()).toBeTruthy()
  const session = await created.json() as { id: string }
  let contextWrites = 0
  await page.route(`**${API}/sessions/${encodeURIComponent(session.id)}/context-state`, async route => {
    if (route.request().method() !== 'GET') contextWrites += 1
    await route.continue()
  })
  await page.goto(`/s/${encodeURIComponent(session.id)}`)
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Repository/ }).click()
  const attach = picker.locator('[data-native-git-picker]').getByRole('button', { name: 'Attach Pending Commons' })
  await attach.click()
  await expect.poll(() => page.evaluate(() => (window as any).__nativeGitCaptureStarted)).toBe(true)

  await switchAccount(page, 'Grace Hopper', 'Grace Hopper')
  await page.evaluate(() => (window as any).__resolveNativeGitCapture({ name: 'Pending Commons', files: [{ path: 'notes.md', sizeBytes: new TextEncoder().encode('must not attach').byteLength, snapshot: { text: 'must not attach' } }] }))
  await expect.poll(() => page.evaluate(() => (window as any).__nativeGitCaptureResolved)).toBe(true)
  await settleFiniteMotion(page)
  await expect.poll(() => contextWrites).toBe(0)

  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
  const readBack = await page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
  expect(readBack.ok(), await readBack.text()).toBeTruthy()
  const record = await readBack.json()
  expect(sessionFolders(record).some((folder: { id: string }) => folder.id === FOLDER_ID)).toBe(false)
  expect(contextWrites).toBe(0, 'a native result captured for the old account never writes into the old session after the switch')
})

test('a clean native Git catalog stays actionable and its short-screen picker keeps Done reachable', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0])
  let catalogReads = 0
  await page.route(`**${API}/context-catalog**`, route => {
    catalogReads += 1
    return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ developmentFixtures: false, connectors: [], mcp: [], repos: [], setups: [] }),
    })
  })
  await page.addInitScript(({ id }) => {
    ;(window as any).__gitRememberValues = []
    Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: { context: { localGit: {
      list: async () => [],
      connect: async (input: { remember: boolean }) => {
        ;(window as any).__gitRememberValues.push(input.remember)
        return { status: 'connected', connection: { id, name: 'Opt-in Commons', remembered: input.remember } }
      },
      snapshot: async () => ({ name: 'Opt-in Commons', files: Array.from({ length: 501 }, (_, index) => ({
        path: `assets/${String(index).padStart(4, '0')}.png`, sizeBytes: 0, snapshot: { omitted: 'unsupported' },
      })) }),
      disconnect: async () => undefined,
    } } } })
  }, { id: GIT_ID })
  const created = await page.request.post(`${API}/sessions`, { data: { firstMessage: `Empty Git catalog ${Date.now().toString(36)}`, persistFirstMessage: true } })
  expect(created.ok()).toBeTruthy()
  const session = await created.json() as { id: string }
  await page.goto(`/s/${encodeURIComponent(session.id)}`)
  await page.getByRole('button', { name: 'Add context' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context' })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const body = dialog.locator('[data-fs-picker-body]')
  const gitPicker = dialog.locator('[data-native-git-picker]')
  await expect.poll(() => catalogReads).toBeGreaterThan(0)
  await expect(gitPicker).toContainText('No repository connections. Choose one above')
  await expect(dialog).not.toContainText('Repository connections are not available yet')
  const remember = gitPicker.getByRole('checkbox', { name: /Remember this connection/ })
  await expect(remember).toHaveAttribute('aria-checked', 'false')
  await gitPicker.getByRole('button', { name: /Choose a repository from this computer/ }).click()
  await expect(gitPicker.getByRole('button', { name: 'Attach Opt-in Commons' })).toBeVisible()
  await expect(gitPicker).toContainText('Until app closes')
  expect(await page.evaluate(() => (window as any).__gitRememberValues)).toEqual([false])
  await gitPicker.getByRole('button', { name: 'Attach Opt-in Commons' }).click()
  await expect(gitPicker.getByRole('alert')).toContainText('Nothing was attached')
  const readBack = await page.request.get(`${API}/sessions/${encodeURIComponent(session.id)}`)
  expect(sessionFolders(await readBack.json()).some((folder: { id: string }) => folder.id === FOLDER_ID)).toBe(false,
    'an over-limit tracked entry list is refused rather than silently truncated')
  await expect(body).toBeVisible()
  await expectPopoverContained(page, dialog, dialog.getByRole('button', { name: 'Done', exact: true }))
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
