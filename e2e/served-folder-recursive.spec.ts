import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import { startMessagesFixture } from './attachment-endpoint.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const FOLDER_ID = 'cloud::insights-dashboard'
const SNAPSHOT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RECURSIVE_INTAKE = '**/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard&scope=recursive'
const SOURCE = { id: 'cloud', kind: 'cloud', label: 'Cloud storage' }
const FILES = [
  { name: 'docs/readme.md', text: '# Dashboard documentation\n\nNested documentation copy: review saved metrics definitions before changing the dashboard.\n' },
  { name: 'src/readme.md', text: '# Dashboard source guide\n\nNested source copy: widget implementation notes belong to the source folder, not the documentation folder.\n' },
]
const CAPTURED_NAMES = ['dashboard-preview.svg', 'design-spec.md', 'docs/readme.md', 'readme.md', 'src/readme.md']

function recursiveSnapshot(files = FILES, snapshotId = SNAPSHOT_ID) {
  return {
    version: 2,
    scope: 'recursive',
    snapshotId,
    capturedAt: '2026-10-04T12:00:00.000Z',
    sourceId: 'cloud',
    path: 'insights-dashboard',
    files: files.map(({ name, text }) => ({ name, sizeBytes: Buffer.byteLength(text), snapshot: { text } })),
  }
}

async function createSession(page: Page, tenant = `tenant-recursive-${randomUUID()}`, providerId?: string) {
  if (tenant !== 'tenant-acme') await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const response = await page.request.post('/api/v1/sessions', { data: providerId ? { providerId } : {} })
  expect(response.ok(), 'the session is created through the real API').toBe(true)
  return (await response.json() as { id: string }).id
}

async function openFolderPicker(page: Page, sourceLabel = 'Cloud storage') {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Folder/ }).click()
  await picker.getByRole('button', { name: sourceLabel, exact: true }).click()
  const row = picker.getByRole('button', { name: /^insights-dashboard\s/ }).first()
  const more = picker.getByRole('button', { name: /^More folders/ })
  const direct = await Promise.race([
    row.waitFor({ state: 'visible' }).then(() => true),
    more.waitFor({ state: 'visible' }).then(() => false),
  ])
  if (!direct) await more.click()
  await expect(row).toBeVisible({ timeout: ms(15_000) })
  return { picker, row }
}

async function capture(page: Page, info: TestInfo, state: string, viewport: typeof VIEWPORTS[number], subject: Locator) {
  await subject.scrollIntoViewIfNeeded()
  await expect(subject).toBeInViewport()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await assertWcag22Aa(page, `recursive served folder ${state} ${viewport.width}x${viewport.height}`)
  await page.screenshot({ path: info.outputPath(`${state}-${viewport.width}x${viewport.height}.png`), fullPage: true })
}

async function assertSavedTree(page: Page) {
  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  const preview = page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
  await settledAttachmentPreview(page, `[data-workspace-folder="${FOLDER_ID}"]`)
  await expect(group).toContainText('including subfolders (root-relative paths shown)')
  await expect(group.getByRole('button').filter({ hasText: 'docs/readme.md' })).toBeVisible()
  await expect(group.getByRole('button').filter({ hasText: 'src/readme.md' })).toBeVisible()
  for (const file of FILES) {
    const row = group.getByRole('button').filter({ hasText: file.name })
    await expect(row.locator('[data-folder-path-scope="recursive"]')).toHaveCSS('white-space', 'normal')
    await row.click()
    await expect(preview).toContainText(file.text)
  }
  return { group, preview }
}

test('recursive cloud folder selection saves distinct nested paths for reload and model input at every viewport', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  const endpoint = await startMessagesFixture()
  const tenant = `tenant-recursive-model-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  try {
    const providerResponse = await page.request.post('/api/v1/providers', { data: {
      label: 'Recursive folder fixture', modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: endpoint.modelId },
    } })
    expect(providerResponse.ok(), 'the loopback model provider is registered through the real API').toBe(true)
    const provider = await providerResponse.json()
    expect(provider).toMatchObject({ defaultModelId: endpoint.modelId, models: [{ id: endpoint.modelId }] })
    const sessionId = await createSession(page, tenant, provider.id)
    let sourceReads = 0
    const requestedScopes: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/fs/folder-snapshot')) {
        sourceReads++
        requestedScopes.push(url.searchParams.get('scope') ?? 'flat')
      }
    })

    await page.goto(`/s/${sessionId}`)
    const { picker, row } = await openFolderPicker(page)
    await expect(row).toContainText('3 top-level files')
    const include = picker.getByRole('checkbox', { name: /Include subfolders/ })
    await expect(include).not.toBeChecked()
    expect(sourceReads, 'opening a source and listing folders does not capture folder contents').toBe(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(include).not.toBeChecked()
      await capture(page, info, 'picker-flat-default', viewport, include)
    }

    await include.check()
    await expect(picker).toContainText(/Include files up to 16 levels deep, across 64 subfolders and 500 entries/)
    expect(sourceReads, 'choosing a scope is not itself a source read').toBe(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(include).toBeChecked()
      await expect(picker).toContainText(/Include files up to 16 levels deep, across 64 subfolders and 500 entries/)
      await capture(page, info, 'picker-recursive-selected', viewport, include)
    }

    const intake = page.waitForResponse((response) => response.url().includes('/fs/folder-snapshot?source=cloud&path=insights-dashboard&scope=recursive'), { timeout: ms(15_000) })
    await row.click()
    const intakeResponse = await intake
    expect(intakeResponse.ok(), 'the real cloud folder reader returns the requested recursive copy').toBe(true)
    const captured = await intakeResponse.json()
    expect(captured).toMatchObject({ version: 2, scope: 'recursive', sourceId: 'cloud', path: 'insights-dashboard' })
    expect(captured.files.map((file: { name: string }) => file.name)).toEqual(CAPTURED_NAMES)
    await expect(picker.getByText('1 added', { exact: false })).toBeVisible()
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    expect(sourceReads).toBe(1)
    expect(requestedScopes).toEqual(['recursive'])
    const { group, preview } = await assertSavedTree(page)

    const stored = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
    const storedFolder = stored.workspace.workspaces.flatMap((workspace: { folders?: Array<{ id: string; snapshot?: unknown }> }) => workspace.folders ?? []).find((folder: { id: string }) => folder.id === FOLDER_ID)
    expect(storedFolder.snapshot).toEqual(captured)
    await page.reload()
    const reloaded = await assertSavedTree(page)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledAttachmentPreview(page, `[data-workspace-folder="${FOLDER_ID}"]`)
      for (const file of FILES) {
        const row = reloaded.group.getByRole('button').filter({ hasText: file.name })
        await expect(row).toBeVisible()
        await row.click()
        await expect(reloaded.preview).toContainText(file.text)
      }
      const docsRow = reloaded.group.getByRole('button').filter({ hasText: 'docs/readme.md' })
      await docsRow.click()
      await expect(reloaded.preview).toContainText(FILES[0].text)
      await capture(page, info, 'saved-recursive-reloaded', viewport, docsRow)
    }

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeEnabled()
    await composer.fill('Compare the two saved readme files.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment:' })).toBeVisible()
    const sent = endpoint.documents.at(-1)?.attached_files ?? []
    expect(sent).toContainEqual({ name: 'insights-dashboard/docs/readme.md', status: 'ready', text: FILES[0].text })
    expect(sent).toContainEqual({ name: 'insights-dashboard/src/readme.md', status: 'ready', text: FILES[1].text })
    expect(sourceReads, 'reload and model input use the persisted copy').toBe(1)
    expect(requestedScopes).toEqual(['recursive'])
    await group.getByRole('button').filter({ hasText: 'docs/readme.md' }).click()
    await expect(preview).toContainText(FILES[0].text)
    await capture(page, info, 'model-used-saved-recursive', VIEWPORTS[4], preview)

    const refreshPath = `/api/v1/sessions/${sessionId}/folders/${encodeURIComponent(FOLDER_ID)}/refresh`
    const refreshBodies: Array<{ expectedSnapshotId: string | null; requestId: string; scope?: string }> = []
    await page.route(`**${refreshPath}`, async (route) => {
      refreshBodies.push(route.request().postDataJSON() as typeof refreshBodies[number])
      if (refreshBodies.length === 1) {
        await route.fulfill({ status: 503, json: { error: { code: 'internal', message: 'Folder source unavailable.' } } })
      } else {
        await route.continue()
      }
    })
    await group.getByRole('button').filter({ hasText: 'docs/readme.md' }).click()
    await expect(preview).toContainText(FILES[0].text)
    await group.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true }).click()
    const refreshFailure = page.locator('[data-context-pane]').filter({ visible: true }).getByRole('alert').filter({ hasText: 'Folder source unavailable.' })
    await expect(refreshFailure).toBeVisible()
    await expect(preview).toContainText(FILES[0].text)
    const preserved = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
    const preservedFolder = preserved.workspace.workspaces.flatMap((workspace: { folders?: Array<{ id: string; snapshot?: unknown }> }) => workspace.folders ?? []).find((folder: { id: string }) => folder.id === FOLDER_ID)
    expect(preservedFolder.snapshot).toEqual(captured)
    expect(refreshBodies[0]).toMatchObject({ expectedSnapshotId: captured.snapshotId })
    expect(refreshBodies[0]).not.toHaveProperty('scope')
    await refreshFailure.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(refreshFailure).toHaveCount(0)
    expect(refreshBodies).toHaveLength(2)
    expect(refreshBodies[1]).toEqual(refreshBodies[0])
    const refreshed = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
    const refreshedFolder = refreshed.workspace.workspaces.flatMap((workspace: { folders?: Array<{ id: string; snapshot?: any }> }) => workspace.folders ?? []).find((folder: { id: string }) => folder.id === FOLDER_ID)
    expect(refreshedFolder.snapshot).toMatchObject({ version: 2, scope: 'recursive', snapshotId: refreshBodies[0]?.requestId })
    expect(refreshedFolder.snapshot.files.map((file: { name: string }) => file.name)).toEqual(CAPTURED_NAMES)
    expect(sourceReads, 'Refresh is a session action and does not issue a client intake read').toBe(1)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await new Promise<void>((resolve) => endpoint.server.close(() => resolve()))
  }
})

test('the runner folder picker exposes recursive scope and requests a v2 tree copy', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const tenant = `tenant-recursive-runner-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const runner = await page.request.post('/api/v1/runners', { data: {
    id: 'runner-local', label: 'Recursive runner fixture', host: 'e2e',
    capabilities: [
      { type: 'fs.read', scopes: ['~/projects'] },
      { type: 'fs.list', scopes: ['~/projects'] },
    ],
  } })
  expect(runner.ok(), 'the runner has explicit list and read authority').toBe(true)
  const sessionId = await createSession(page, tenant)
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/fs/folder-snapshot')) requests.push(`${url.searchParams.get('source')}|${url.searchParams.get('path')}|${url.searchParams.get('scope') ?? 'flat'}`)
  })
  await page.goto(`/s/${sessionId}`)
  const { picker, row } = await openFolderPicker(page, 'Recursive runner fixture')
  const include = picker.getByRole('checkbox', { name: /Include subfolders/ })
  await expect(include).not.toBeChecked()
  await include.check()
  await expect(picker).toContainText(/Include files up to 16 levels deep, across 64 subfolders and 500 entries/)
  const intake = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/fs/folder-snapshot') && url.searchParams.get('source') === 'runner:runner-local' && url.searchParams.get('scope') === 'recursive'
  }, { timeout: ms(15_000) })
  await row.click()
  const response = await intake
  expect(response.ok(), 'runner-backed recursive intake returns successfully').toBe(true)
  const snapshot = await response.json()
  expect(snapshot).toMatchObject({ version: 2, scope: 'recursive', sourceId: 'runner:runner-local', path: 'insights-dashboard' })
  expect(snapshot.files.map((file: { name: string }) => file.name)).toEqual(['perf.csv', 'src-notes.md', 'ui-sketch.svg'])
  expect(requests).toEqual(['runner:runner-local|insights-dashboard|recursive'])
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  const state = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
  expect(state.workspace.workspaces.flatMap((workspace: { folders?: Array<{ id: string; snapshot?: unknown }> }) => workspace.folders ?? []).find((folder: { id: string }) => folder.id === 'runner:runner-local::insights-dashboard')?.snapshot).toEqual(snapshot)
})

test('an empty recursive capture is explicit and remains an empty saved copy', async ({ page }, info) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  let reads = 0
  await page.route(RECURSIVE_INTAKE, async (route) => {
    reads++
    await route.fulfill({ json: recursiveSnapshot([]) })
  })
  await page.goto(`/s/${sessionId}`)
  const { picker, row } = await openFolderPicker(page)
  const include = picker.getByRole('checkbox', { name: /Include subfolders/ })
  await expect(include).not.toBeChecked()
  await include.check()
  await row.click()
  await expect(picker.getByText('1 added', { exact: false })).toBeVisible()
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(group).toContainText('No visible files in this saved folder tree.')
    await expect(group).toContainText('including subfolders (root-relative paths shown)')
    await settledAttachmentPreview(page, `[data-workspace-folder="${FOLDER_ID}"]`)
    await capture(page, info, 'empty-recursive-saved', viewport, group)
  }
  expect(reads).toBe(1)
  await page.reload()
  await expect(group).toContainText('No visible files in this saved folder tree.')
  const state = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
  expect(state.workspace.workspaces[0].folders[0].snapshot).toEqual(recursiveSnapshot([]))
})

test('a recursive draft Refresh rereads only recursive scope and survives first-send materialization', async ({ page }, info) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-recursive-draft-${randomUUID()}` })
  const scopes: string[] = []
  let durableRefreshPosts = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/fs/folder-snapshot')) scopes.push(url.searchParams.get('scope') ?? 'flat')
    if (request.method() === 'POST' && /\/folders\/.*\/refresh$/.test(url.pathname)) durableRefreshPosts++
  })
  await page.goto('/')
  const { picker, row } = await openFolderPicker(page)
  await picker.getByRole('checkbox', { name: /Include subfolders/ }).check()
  const intake = page.waitForResponse((response) => response.url().includes('/fs/folder-snapshot?source=cloud&path=insights-dashboard&scope=recursive'), { timeout: ms(15_000) })
  await row.click()
  expect((await intake).ok()).toBe(true)
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  const refresh = group.getByRole('button', { name: 'Refresh insights-dashboard/', exact: true })
  await expect(refresh).toBeVisible()
  const refreshRead = page.waitForResponse((response) => response.url().includes('/fs/folder-snapshot?source=cloud&path=insights-dashboard&scope=recursive'), { timeout: ms(15_000) })
  await refresh.click()
  expect((await refreshRead).ok()).toBe(true)
  expect(scopes).toEqual(['recursive', 'recursive'])
  expect(durableRefreshPosts, 'draft Refresh has no session route to mutate').toBe(0)
  await expect(group.getByRole('button').filter({ hasText: 'docs/readme.md' })).toBeVisible()
  await expect(group.getByRole('button').filter({ hasText: 'src/readme.md' })).toBeVisible()
  await group.getByRole('button').filter({ hasText: 'docs/readme.md' }).click()
  await expect(page.locator('[data-folder-snapshot-preview]').filter({ visible: true })).toContainText(FILES[0].text)
  await capture(page, info, 'draft-recursive-refreshed', VIEWPORTS[4], group.getByRole('button').filter({ hasText: 'docs/readme.md' }))

  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Review the refreshed recursive draft.')
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
  await page.waitForURL(/\/s\/[^/?]+$/)
  const sessionId = new URL(page.url()).pathname.split('/').at(-1)!
  await expect.poll(async () => {
    const state = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
    return state.workspace?.workspaces?.[0]?.folders?.[0]?.snapshot?.scope
  }).toBe('recursive')
  const persisted = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
  expect(persisted.workspace.workspaces[0].folders[0].snapshot.files.map((file: { name: string }) => file.name)).toEqual(CAPTURED_NAMES)
  expect(scopes).toEqual(['recursive', 'recursive'])
  expect(durableRefreshPosts).toBe(0)
})

test('recursive intake refuses a mismatched flat response and retries only the requested scope', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  const requestedScopes: string[] = []
  await page.route('**/api/v1/fs/folder-snapshot?source=cloud&path=insights-dashboard**', async (route) => {
    const url = new URL(route.request().url())
    requestedScopes.push(url.searchParams.get('scope') ?? 'flat')
    await route.fulfill({ json: requestedScopes.length === 1
      ? { version: 1, snapshotId: SNAPSHOT_ID, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'insights-dashboard', files: [] }
      : recursiveSnapshot() })
  })
  await page.goto(`/s/${sessionId}`)
  const { picker, row } = await openFolderPicker(page)
  await picker.getByRole('checkbox', { name: /Include subfolders/ }).check()
  await row.click()
  const refusal = picker.getByRole('alert')
  await expect(refusal).toContainText('Could not read insights-dashboard. Nothing was attached.')
  expect(requestedScopes).toEqual(['recursive'])
  const beforeRetry = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
  expect(beforeRetry.workspace.workspaces).toEqual([])
  await refusal.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(picker.getByText('1 added', { exact: false })).toBeVisible()
  expect(requestedScopes).toEqual(['recursive', 'recursive'])
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  const state = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json()
  expect(state.workspace.workspaces[0].folders[0].snapshot).toEqual(recursiveSnapshot())
})

test('shared recursive folder reads show saved relative names only and never touch the source', async ({ browser }, info) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const peer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': `user-recursive-foreign-${randomUUID()}`, 'x-tenant-id': `tenant-recursive-foreign-${randomUUID()}` })
  try {
    const sessionId = await createSession(owner.page, 'tenant-acme')
    const attached = await owner.page.request.patch(`/api/v1/sessions/${sessionId}/context-state`, { data: {
      operations: [{ action: 'attach', context: { id: FOLDER_ID, type: 'folder', label: 'insights-dashboard', scope: 'insights-dashboard', source: SOURCE } }],
      workspace: { workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [], folders: [{ id: FOLDER_ID, label: 'insights-dashboard/', snapshot: recursiveSnapshot() }] }], repos: [], connectors: [], attachments: [] },
    } })
    expect(attached.ok(), 'the owner saves a recursive folder through the real session route').toBe(true)
    const grant = await owner.page.request.post('/api/v1/grants', { data: {
      subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
    } })
    expect(grant.ok(), 'the owner grants the peer view access').toBe(true)
    const sourceReads: string[] = []
    peer.page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/fs/folder-snapshot')) sourceReads.push(url.pathname + url.search)
    })
    await peer.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const group = peer.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
    await expect(group.locator('[data-served-folder-state="saved"]')).toBeVisible({ timeout: ms(20_000) })
    await expect(group).toContainText('including subfolders (root-relative paths shown)')
    const preview = peer.page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
    for (const file of FILES) {
      const row = group.getByRole('button').filter({ hasText: file.name })
      await expect(row).toBeVisible()
      await row.click()
      await expect(preview).toContainText(file.text)
    }
    await expect(group.getByRole('button', { name: /^Refresh / })).toHaveCount(0)
    await expect(group.getByRole('button', { name: /^Remove insights-dashboard/ })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await peer.page.setViewportSize(viewport)
      await settledAttachmentPreview(peer.page, `[data-workspace-folder="${FOLDER_ID}"]`)
      for (const file of FILES) {
        const row = group.getByRole('button').filter({ hasText: file.name })
        await expect(row).toBeVisible()
        await row.click()
        await expect(preview).toContainText(file.text)
      }
      const docsRow = group.getByRole('button').filter({ hasText: 'docs/readme.md' })
      await docsRow.click()
      await expect(preview).toContainText(FILES[0].text)
      await capture(peer.page, info, 'shared-recursive-saved', viewport, docsRow)
    }
    expect(sourceReads, 'shared saved content is portable and does not call folder intake').toEqual([])

    const denied = foreign.page.waitForResponse((response) => response.url().includes(`/api/v1/sessions/${sessionId}`) && response.request().method() === 'GET', { timeout: ms(10_000) })
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await denied).status(), 'a foreign tenant cannot retrieve the saved recursive copy').toBe(404)
    await expect(foreign.page.getByText(FILES[0].text, { exact: false })).toHaveCount(0)
  } finally {
    await owner.context.close()
    await peer.context.close()
    await foreign.context.close()
  }
})
