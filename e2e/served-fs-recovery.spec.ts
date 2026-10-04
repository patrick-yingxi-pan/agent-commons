import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers'

const EMPTY_CATALOG = {
  source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
  files: [],
  photos: [],
  folders: [],
}

function errorBody(message = 'Temporary filesystem outage') {
  return { error: { code: 'internal', message } }
}

const FOLDER_SNAPSHOT = {
  version: 1, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z',
  sourceId: 'cloud', path: 'insights-dashboard', files: [{ name: 'readme.md', sizeBytes: 5, snapshot: { text: 'hello' } }],
}

async function createOwnedSession(page: Page): Promise<string> {
  const identity = `served-fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-${identity}` })
  const response = await page.request.post('/api/v1/sessions', { data: {} })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { id: string }).id
}

async function openPicker(page: Page, type: 'Files' | 'Photos' | 'Folder') {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: new RegExp(`^${type}`) }).click()
  return picker
}

async function assertPickerGeometry(page: Page, picker: ReturnType<Page['locator']>) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect.poll(async () => {
    const box = await picker.boundingBox()
    const viewport = page.viewportSize()!
    return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7
  }).toBe(true)
}

async function catalogFailureWalk(page: Page, type: 'Files' | 'Photos' | 'Folder', label: string) {
  let attempts = 0
  let releaseCatalog: (() => void) | undefined
  const heldCatalog = new Promise<void>((resolve) => { releaseCatalog = resolve })
  await page.route('**/api/v1/fs/catalog?source=cloud', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await heldCatalog
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(errorBody()) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG) })
  })
  try {
    const sessionId = await createOwnedSession(page)
    await page.goto(`/s/${sessionId}`)
    const picker = await openPicker(page, type)
    const readState = picker.locator('[data-fs-read-state]')
    await expect(readState).toHaveAttribute('data-fs-read-state', 'loading', { timeout: ms(15_000) })
    await expect.poll(() => attempts).toBe(1)
    await expect(readState).toContainText(`Loading ${label}…`)
    releaseCatalog?.()
    await expect(readState).toHaveAttribute('data-fs-read-state', 'error', { timeout: ms(15_000) })
    await expect(picker.getByRole('alert')).toContainText(`Could not load ${label}.`)
    await expect(picker.getByRole('alert').getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(picker.getByText(/Nothing here yet/)).toHaveCount(0)
    for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
      await page.setViewportSize({ width, height })
      await expect(page.locator('[data-fs-read-state="error"]')).toBeVisible()
      await assertPickerGeometry(page, picker)
      await assertWcag22Aa(page, `Served ${label} catalog failure ${width}x${height}`)
      await page.screenshot({ path: `.data/served-fs/${label}-catalog-error-${width}x${height}.png`, fullPage: true })
    }
    await picker.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(readState).toHaveAttribute('data-fs-read-state', 'empty', { timeout: ms(15_000) })
    await expect(picker.getByText(`Nothing here yet — no ${label}.`, { exact: true })).toBeVisible()
    expect(attempts).toBe(2)
  } finally {
    releaseCatalog?.()
    await page.unroute('**/api/v1/fs/catalog?source=cloud')
  }
}

test.setTimeout(ms(90_000))
const pendingReleases = new Set<() => void>()
test.afterEach(async ({ page }) => {
  for (const release of pendingReleases) release()
  pendingReleases.clear()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('files, photos, and folders disclose catalog failure, retry, and genuine empty state', async ({ page }) => {
  await catalogFailureWalk(page, 'Files', 'files')
  await page.keyboard.press('Escape')
  await catalogFailureWalk(page, 'Photos', 'photos')
  await page.keyboard.press('Escape')
  await catalogFailureWalk(page, 'Folder', 'folders')
  await page.keyboard.press('Escape')
})

test('a missing served catalog remains an explicit read error, not an empty source', async ({ page }) => {
  await page.route('**/api/v1/fs/catalog?source=cloud', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'No filesystem source' } }) })
  })
  const sessionId = await createOwnedSession(page)
  await page.goto(`/s/${sessionId}`)
  const picker = await openPicker(page, 'Files')
  await expect(picker.locator('[data-fs-read-state="error"]')).toBeVisible({ timeout: ms(15_000) })
  await expect(picker.getByRole('alert')).toContainText('Could not load files.')
  await expect(picker.getByText(/Nothing here yet/)).toHaveCount(0)
})

test('a failed revalidation cannot offer cached files for attachment', async ({ page }) => {
  let fail = false
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  pendingReleases.add(release)
  await page.route('**/api/v1/fs/catalog?source=cloud', async (route) => {
    if (fail) await held
    await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? errorBody() : {
      ...EMPTY_CATALOG, files: [{ id: 'cached-note.md', name: 'cached-note.md', kind: 'doc', ext: 'md', size: 10, mtime: 1 }],
    }) })
  })
  const sessionId = await createOwnedSession(page)
  await page.goto(`/s/${sessionId}`)
  const picker = await openPicker(page, 'Files')
  await expect(picker.getByRole('button', { name: /cached-note\.md/ })).toBeVisible()
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  fail = true
  const reopened = await openPicker(page, 'Files')
  await expect(reopened.locator('[data-fs-read-state="loading"]')).toBeVisible()
  await expect(reopened.getByRole('button', { name: /cached-note\.md/ })).toHaveCount(0)
  release()
  await expect(reopened.locator('[data-fs-read-state="error"]')).toBeVisible()
  await expect(reopened.getByRole('button', { name: /cached-note\.md/ })).toHaveCount(0)
  fail = false
  await reopened.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(reopened.getByRole('button', { name: /cached-note\.md/ })).toBeVisible()
})

test('source discovery failure keeps the selected cloud source and retries', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/v1/fs/sources', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(errorBody('Source discovery is temporarily unavailable')) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'cloud', kind: 'cloud', label: 'Cloud storage' }]) })
  })
  const sessionId = await createOwnedSession(page)
  await page.goto(`/s/${sessionId}`)
  const picker = await openPicker(page, 'Files')
  await expect(picker.locator('[data-fs-read-state="error"]')).toBeVisible({ timeout: ms(15_000) })
  const computer = picker.getByRole('button', { name: 'This computer', exact: true })
  await expect(computer).toHaveAttribute('aria-pressed', 'false')
  await expect(picker.getByRole('button', { name: /Add files from this computer/ })).toHaveCount(0)
  await expect(picker.getByRole('alert')).toContainText('Could not load file sources.')
  for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    await assertPickerGeometry(page, picker)
    await assertWcag22Aa(page, `Served source discovery failure ${width}x${height}`)
    await page.screenshot({ path: `.data/served-fs/source-discovery-error-${width}x${height}.png`, fullPage: true })
  }
  await picker.getByRole('button', { name: 'Retry', exact: true }).click()
  const cloud = picker.getByRole('button', { name: 'Cloud storage', exact: true })
  await expect(cloud).toBeVisible()
  await expect(cloud).toHaveAttribute('aria-pressed', 'true')
  await expect(computer).toHaveAttribute('aria-pressed', 'false')
  expect(attempts).toBe(2)
  await computer.click()
  await expect(computer).toHaveAttribute('aria-pressed', 'true')
  await expect(cloud).toHaveAttribute('aria-pressed', 'false')
})

test('served folder read failure never attaches, retries once, and fences pending completion', async ({ page }) => {
  let folderAttempts = 0
  let contextWrites = 0
  let releaseFolder: (() => void) | undefined
  const heldFolder = new Promise<void>((resolve) => { releaseFolder = resolve })
  pendingReleases.add(() => releaseFolder?.())
  await page.route('**/api/v1/fs/catalog?source=cloud', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
        files: [], photos: [],
        folders: [{ id: 'insights-dashboard', name: 'insights-dashboard', path: 'insights-dashboard', fileCount: 1, mtime: 1 }],
      }),
    })
  })
  await page.route('**/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard', async (route) => {
    folderAttempts += 1
    if (folderAttempts === 1) {
      await heldFolder
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(errorBody('Folder read failed')) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FOLDER_SNAPSHOT),
    })
  })
  await page.route('**/api/v1/sessions/*/context-state', async (route) => {
    contextWrites += 1
    await route.continue()
  })
  const sessionId = await createOwnedSession(page)
  await page.goto(`/s/${sessionId}`)
  const picker = await openPicker(page, 'Folder')
  const row = picker.getByRole('button', { name: /insights-dashboard/ }).first()
  await expect(row).toBeVisible({ timeout: ms(15_000) })

  await row.click()
  await expect(picker.locator('[data-fs-folder-read="loading"]')).toBeVisible()
  await expect(row).toBeDisabled()
  expect(folderAttempts).toBe(1)
  expect(contextWrites).toBe(0)
  releaseFolder?.()
  await expect(picker.locator('[data-fs-folder-read="error"]')).toBeVisible({ timeout: ms(15_000) })
  await expect(picker.getByRole('alert')).toContainText('Could not read insights-dashboard. Nothing was attached.')
  await expect.poll(async () => ((await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()).workspace?.workspaces ?? []).length).toBe(0)
  expect(contextWrites).toBe(0)
  for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    await assertPickerGeometry(page, picker)
    await assertWcag22Aa(page, `Served folder read failure ${width}x${height}`)
    await page.screenshot({ path: `.data/served-fs/folder-read-error-${width}x${height}.png`, fullPage: true })
  }

  await picker.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(async () => ((await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()).workspace?.workspaces ?? []).length).toBe(1)
  await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'insights-dashboard/' })).toBeVisible()
  expect(folderAttempts).toBe(2)
  expect(contextWrites).toBe(1)
})

test('closing or switching source fences a late served-folder result', async ({ page }) => {
  let contextWrites = 0
  await page.route('**/api/v1/sessions/*/context-state', async (route) => { contextWrites += 1; await route.continue() })
  let releaseSuccess: (() => void) | undefined
  let releaseError: (() => void) | undefined
  const heldSuccess = new Promise<void>((resolve) => { releaseSuccess = resolve })
  const heldError = new Promise<void>((resolve) => { releaseError = resolve })
  let folderAttempts = 0
  pendingReleases.add(() => releaseSuccess?.())
  pendingReleases.add(() => releaseError?.())
  let resolveFirstRoute: (() => void) | undefined
  let resolveSecondRoute: (() => void) | undefined
  const firstRouteDone = new Promise<void>((resolve) => { resolveFirstRoute = resolve })
  const secondRouteDone = new Promise<void>((resolve) => { resolveSecondRoute = resolve })
  await page.route('**/api/v1/fs/catalog?source=cloud', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...EMPTY_CATALOG, folders: [{ id: 'insights-dashboard', name: 'insights-dashboard', path: 'insights-dashboard', fileCount: 1, mtime: 1 }] }) })
  })
  await page.route('**/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard', async (route) => {
    folderAttempts += 1
    if (folderAttempts === 1) {
      try {
        await heldSuccess
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FOLDER_SNAPSHOT) })
      } finally { resolveFirstRoute?.() }
      return
    }
    try {
      await heldError
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(errorBody('late folder failure')) })
    } finally { resolveSecondRoute?.() }
  })
  const sessionId = await createOwnedSession(page)
  await page.goto(`/s/${sessionId}`)
  const picker = await openPicker(page, 'Folder')
  const row = picker.getByRole('button', { name: /insights-dashboard/ }).first()
  await expect(row).toBeVisible({ timeout: ms(15_000) })
  await row.click()
  await expect(picker.locator('[data-fs-folder-read="loading"]')).toBeVisible()
  const lateSuccess = page.waitForEvent('requestfailed', (request) => request.url().includes('/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard'))
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  releaseSuccess?.()
  await lateSuccess
  await firstRouteDone
  expect(contextWrites).toBe(0)
  await expect.poll(async () => ((await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()).workspace?.workspaces ?? []).length).toBe(0)

  const switched = await openPicker(page, 'Folder')
  const switchedRow = switched.getByRole('button', { name: /insights-dashboard/ }).first()
  await expect(switchedRow).toBeVisible({ timeout: ms(15_000) })
  await switchedRow.click()
  await expect(switched.locator('[data-fs-folder-read="loading"]')).toBeVisible()
  const lateError = page.waitForEvent('requestfailed', (request) => request.url().includes('/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard'))
  await switched.getByRole('button', { name: 'This computer', exact: true }).click()
  releaseError?.()
  await lateError
  await secondRouteDone
  expect(contextWrites).toBe(0)
  await expect.poll(async () => ((await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()).workspace?.workspaces ?? []).length).toBe(0)
  await expect(switched.getByRole('alert')).toHaveCount(0)
})

test('switching away and back abandons an older local-folder selection', async ({ page }) => {
  await page.addInitScript(() => {
    let resolve: (value: unknown) => void
    const held = new Promise((done) => { resolve = done })
    Object.defineProperty(window, 'agentCommonsDesktop', { value: { context: {
      pickFolder: () => held,
      pickFiles: async () => ({ status: 'cancelled' }),
    } } })
    Object.assign(window, { finishLocalFolder: () => resolve({ status: 'selected', folder: {
      name: 'abandoned-folder', files: [{ name: 'note.md', sizeBytes: 5, snapshot: { text: 'hello' } }],
    } }) })
  })
  let writes = 0
  await page.route('**/api/v1/sessions/*/context-state', async (route) => { writes += 1; await route.continue() })
  const sessionId = await createOwnedSession(page)
  await page.goto(`/s/${sessionId}`)
  const picker = await openPicker(page, 'Folder')
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  const choose = picker.getByRole('button', { name: /Choose a folder from this computer/ })
  await choose.click()
  await expect(choose).toBeDisabled()
  await picker.getByRole('button', { name: 'Cloud storage', exact: true }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  await expect(choose).toBeEnabled()
  await page.evaluate(async () => {
    ;(window as Window & { finishLocalFolder: () => void }).finishLocalFolder()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  expect(writes).toBe(0)
  const response = await page.request.get(`/api/v1/sessions/${sessionId}`)
  expect(response.ok()).toBe(true)
  expect((await response.json()).workspace.workspaces).toEqual([])
})
