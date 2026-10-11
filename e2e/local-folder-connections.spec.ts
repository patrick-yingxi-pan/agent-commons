/** Desktop-shaped UI proof; native IPC, encryption and relaunch are separate gates. */
import { mkdir } from 'node:fs/promises'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const ID = 'LOCAL_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const FOLDER_ID = `ui-host::${ID}`
const VIEWPORTS = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]
const RELATIVE_FILE = 'src/tests/local-note-with-a-deliberately-long-relative-filename.md'
const DEMO_ACCOUNTS = [
  ['ada@acme.example', 'ada-demo-password'],
  ['grace@acme.example', 'grace-demo-password'],
  ['maya@growthworks.example', 'maya-demo-password'],
  ['noor@northlight.example', 'noor-demo-password'],
  ['omar@harborsupport.example', 'omar-demo-password'],
  ['rei@reislab.example', 'rei-demo-password'],
]

async function revealRowWithinScrollport(row: ReturnType<Page['locator']>) {
  await row.scrollIntoViewIfNeeded()
  const bounds = await row.evaluate(element => {
    const rowRect = element.getBoundingClientRect()
    let scrollport = element.parentElement
    while (scrollport) {
      const style = getComputedStyle(scrollport)
      if (['auto', 'scroll'].includes(style.overflowY) && scrollport.scrollHeight > scrollport.clientHeight) break
      scrollport = scrollport.parentElement
    }
    if (!scrollport) return null
    const portRect = scrollport.getBoundingClientRect()
    const top = portRect.top + scrollport.clientTop
    const bottom = top + scrollport.clientHeight
    return {
      top: Math.round(rowRect.top), bottom: Math.round(rowRect.bottom),
      scrollTop: Math.round(top), scrollBottom: Math.round(bottom),
      fullyInside: rowRect.top >= top - 1 && rowRect.bottom <= bottom + 1,
    }
  })
  expect(bounds, 'the file row has an actual scrollable ancestor').not.toBeNull()
  expect(bounds!.fullyInside, `file row bounds ${bounds!.top}–${bounds!.bottom} inside scrollport ${bounds!.scrollTop}–${bounds!.scrollBottom}`).toBe(true)
}

async function nativeFixture(page: Page, name = 'Research notes', treeAvailable = true) {
  await page.addInitScript(({ id, name, treeAvailable, relativeFile }) => {
    const state = { rows: [] as any[], calls: [] as any[], text: 'First saved local text.', treeText: 'First nested local text.', failRead: false }
    ;(window as any).__localFolders = state
    Object.defineProperty(window, 'agentCommonsDesktop', { value: { context: { localFolders: {
      list: async (source: any) => { state.calls.push(['list', source]); return state.rows },
      connect: async ({ remember }: any, source: any) => {
        state.calls.push(['connect', remember, source])
        const connection = { id, name, remembered: remember }
        state.rows = [connection]
        return { status: 'connected', connection }
      },
      snapshot: async (id: string, source: any) => {
        state.calls.push(['snapshot', id, source])
        if (state.failRead || !state.rows.length) throw new Error('Unavailable')
        return { name, files: [{ name: 'readme.md', sizeBytes: new TextEncoder().encode(state.text).length, snapshot: { text: state.text } }] }
      },
      ...(treeAvailable ? { snapshotTree: async (id: string, source: any) => {
        state.calls.push(['snapshotTree', id, source])
        if (state.failRead || !state.rows.length) throw new Error('Unavailable')
        return { name, files: [{ name: relativeFile, sizeBytes: new TextEncoder().encode(state.treeText).length, snapshot: { text: state.treeText } }] }
      } } : {}),
      disconnect: async (id: string, source: any) => { state.calls.push(['disconnect', id, source]); state.rows = [] },
    } } } })
  }, { id: ID, name, treeAvailable, relativeFile: RELATIVE_FILE })
}

async function stackDemoAccountsAndReturnToAda(page: Page) {
  for (const [email, password] of DEMO_ACCOUNTS) {
    const response = await page.request.post('/api/v1/auth/login', { data: { email, password } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Rei Tanaka')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
}

async function picker(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Folder/ }).click()
  await dialog.getByRole('button', { name: 'This computer', exact: true }).click()
  return dialog
}

test('failed local Folder controls retain back navigation without reading files', async ({ page }) => {
  await nativeFixture(page)
  await page.route('**/src/components/LocalFolderConnections.tsx*', route => route.abort('failed'))
  await page.goto(`/contexts/${ID}`)
  await expect(page.getByRole('heading', { name: 'Local folder', exact: true })).toBeVisible()
  await expect(page.getByText('Couldn’t load local folder controls. Saved copies are unchanged. Copy unsent text before reloading.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload controls', exact: true })).toBeVisible()
  const back = page.getByRole('button', { name: /^Back to / }).filter({ visible: true })
  await expect(back).toHaveCount(1)
  await back.click()
  await expect(page).not.toHaveURL(new RegExp(ID))
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot'))).toEqual([])
})

test('Contexts main and rail reuse one local connection and canonical detail without capture', async ({ page }) => {
  await nativeFixture(page)
  await page.goto('/contexts')
  const main = page.locator('main')
  await main.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('button', { name: 'Connect a local folder', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: /Remember this connection/ })).not.toBeChecked()
  await page.getByRole('button', { name: 'Choose a folder from this computer', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(main.getByText('Research notes', { exact: true })).toBeVisible()
  const rail = page.locator('nav[aria-label="Sections"] [data-section-tree="contexts"]')
  const group = rail.locator('[data-collection-section="local-folders"]')
  await expect(group.getByRole('button', { name: 'Local folders on this device', exact: true })).toBeVisible()
  await group.getByRole('button', { name: 'Expand Local folders on this device', exact: true }).click()
  await rail.getByRole('button', { name: 'Research notes', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/contexts/${ID}$`))
  await expect(main.locator(`[data-local-folder-detail="${ID}"]`)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot'))).toEqual([])
})

test('local Folder connect reads nothing; explicit Attach and recovery-safe Refresh save copies; Disconnect preserves them', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await nativeFixture(page)
  const response = await page.request.post('/api/v1/sessions', { data: {} })
  expect(response.ok()).toBe(true)
  const sessionId = (await response.json()).id
  await page.goto(`/s/${sessionId}`)
  const dialog = await picker(page)
  await expect(dialog.getByRole('checkbox', { name: /Remember this connection/ })).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Choose a folder from this computer' }).click()
  await expect(dialog.getByRole('button', { name: 'Attach Research notes', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot'))).toEqual([])
  await dialog.getByRole('button', { name: 'Attach Research notes', exact: true }).click()
  await expect(dialog).toContainText('1 added')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  const preview = page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
  await expect(preview).toContainText('First saved local text.')
  const refresh = group.getByRole('button', { name: 'Refresh Research notes/', exact: true })
  const route = `**/sessions/${sessionId}/local-folders/*/refresh`
  const bodies: unknown[] = []
  await page.route(route, async route => {
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 1) await route.abort('failed')
    else await route.continue()
  })
  await page.evaluate(() => { (window as any).__localFolders.text = 'Second saved local text.' })
  await refresh.click()
  const retry = page.getByRole('button', { name: 'Retry', exact: true }).filter({ visible: true }).first()
  await expect(retry).toBeVisible()
  await expect(preview).toContainText('First saved local text.')
  await expect(refresh).toBeDisabled()
  await page.evaluate(() => { (window as any).__localFolders.text = 'Must not be silently reread.' })
  await retry.click()
  await expect(preview).toContainText('Second saved local text.')
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot').length)).toBe(2)
  await page.evaluate(() => { (window as any).__localFolders.failRead = true })
  await refresh.click()
  const useSaved = page.getByRole('button', { name: 'Use saved state', exact: true }).filter({ visible: true }).first()
  await expect(useSaved).toBeVisible()
  await useSaved.click()
  await expect(preview).toContainText('Second saved local text.')
  // Navigate without resetting the native fixture: the canonical detail is a
  // normal app link, not another picker or a filesystem read.
  const again = await picker(page)
  await again.getByRole('button', { name: 'Manage Research notes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Research notes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByText('This connection is not available to this account on this device.', { exact: false })).toBeVisible()
  const saved = await page.request.get(`/api/v1/sessions/${sessionId}`)
  expect((await saved.json()).workspace.workspaces[0].folders[0].localSnapshot.files[0].snapshot.text).toBe('Second saved local text.')
  await page.goto(`/s/${sessionId}`)
  await expect(page.locator('[data-folder-snapshot-preview]').filter({ visible: true })).toContainText('Second saved local text.')
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot'))).toEqual([])
})

test('recursive local Folder scope is explicit, preserves relative labels, and retries the frozen capture', async ({ page }, info: TestInfo) => {
  test.setTimeout(ms(120_000))
  await nativeFixture(page)
  await page.goto('/')
  await stackDemoAccountsAndReturnToAda(page)
  const response = await page.request.post('/api/v1/sessions', { data: {} })
  expect(response.ok()).toBe(true)
  const sessionId = (await response.json()).id
  await page.goto(`/s/${sessionId}`)
  const dialog = await picker(page)
  const recursive = dialog.getByRole('checkbox', { name: /Include subfolders/ })
  await expect(recursive).not.toBeChecked()
  await recursive.check()
  await expect(dialog).toContainText('up to 16 levels, 64 folders and 500 entries')
  await dialog.getByRole('button', { name: 'Choose a folder from this computer' }).click()
  await dialog.getByRole('button', { name: 'Attach Research notes', exact: true }).click()
  await expect(dialog).toContainText('1 added')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()

  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  const preview = page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
  await expect(group).toContainText('including subfolders (relative paths shown)')
  const fileRow = group.getByRole('button').filter({ hasText: RELATIVE_FILE }).last()
  await expect(page.getByText(RELATIVE_FILE, { exact: true }).filter({ visible: true }).last()).toBeVisible()
  await expect(preview).toContainText('First nested local text.')
  const attachCalls = await page.evaluate(() => (window as any).__localFolders.calls.map((c: any[]) => c[0]))
  expect(attachCalls.filter((call: string) => call === 'snapshotTree')).toHaveLength(1)
  expect(attachCalls.filter((call: string) => call === 'snapshot')).toHaveLength(0)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledAttachmentPreview(page, `[data-workspace-folder="${FOLDER_ID}"]`)
    if (viewport.width === 844) await revealRowWithinScrollport(fileRow)
    await expect(preview).toContainText('First nested local text.')
    await expect(page.getByText(RELATIVE_FILE, { exact: true }).filter({ visible: true }).last()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `Recursive saved local copy ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`recursive-saved-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }

  const bodies: unknown[] = []
  await page.route(`**/sessions/${sessionId}/local-folders/*/refresh`, async route => {
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 1) await route.abort('failed')
    else await route.continue()
  })
  await page.evaluate(() => { (window as any).__localFolders.treeText = 'Second nested saved text.' })
  await group.getByRole('button', { name: 'Refresh Research notes/', exact: true }).click()
  const retry = page.getByRole('button', { name: 'Retry', exact: true }).filter({ visible: true }).first()
  await expect(retry).toBeVisible()
  await expect(preview).toContainText('First nested local text.')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledAttachmentPreview(page, `[data-workspace-folder="${FOLDER_ID}"]`)
    if (viewport.width === 844) await revealRowWithinScrollport(fileRow)
    await expect(retry).toBeVisible()
    await expect(preview).toContainText('First nested local text.')
    await expect(page.getByText(RELATIVE_FILE, { exact: true }).filter({ visible: true }).last()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `Recursive held Refresh ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`recursive-held-retry-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
  await page.evaluate(() => { (window as any).__localFolders.treeText = 'Must not be silently reread.' })
  await retry.click()
  await expect(preview).toContainText('Second nested saved text.')
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[0]).toMatchObject({ snapshot: { version: 2, scope: 'recursive', files: [{ name: RELATIVE_FILE }] } })
  const calls = await page.evaluate(() => (window as any).__localFolders.calls.map((c: any[]) => c[0]))
  expect(calls.filter((call: string) => call === 'snapshotTree')).toHaveLength(2)
  expect(calls.filter((call: string) => call === 'snapshot')).toHaveLength(0)
  await page.reload()
  await expect(page.locator('[data-folder-snapshot-preview]').filter({ visible: true })).toContainText('Second nested saved text.')
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshotTree' || c[0] === 'snapshot'))).toEqual([])
})

test('a saved recursive copy stays readable when this desktop has no tree bridge, and Refresh refuses flat fallback', async ({ page }) => {
  await nativeFixture(page, 'Research notes', false)
  const made = await page.request.post('/api/v1/sessions', { data: {} })
  expect(made.ok()).toBe(true)
  const sessionId = (await made.json()).id
  const saved = await page.request.patch(`/api/v1/sessions/${sessionId}/context-state`, { data: {
    operations: [{ action: 'attach', context: { id: FOLDER_ID, type: 'folder', label: 'Research notes', scope: ID, source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' } } }],
    workspace: { workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [], folders: [{ id: FOLDER_ID, label: 'Research notes/', localSnapshot: {
      version: 2, scope: 'recursive', connectionId: ID, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z',
      files: [{ name: RELATIVE_FILE, sizeBytes: new TextEncoder().encode('Portable recursive copy').length, snapshot: { text: 'Portable recursive copy' } }],
    } }] }], repos: [], connectors: [], attachments: [] },
  } })
  expect(saved.ok(), await saved.text()).toBe(true)

  await page.goto(`/s/${sessionId}`)
  const dialog = await picker(page)
  await expect(dialog.getByRole('checkbox', { name: /Include subfolders/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const group = page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).filter({ visible: true })
  const preview = page.locator('[data-folder-snapshot-preview]').filter({ visible: true })
  await expect(preview).toContainText('Portable recursive copy')
  await expect(group).toContainText('including subfolders (relative paths shown)')
  await expect(page.getByText(RELATIVE_FILE, { exact: true }).filter({ visible: true }).last()).toBeVisible()

  let refreshRequests = 0
  await page.route(`**/sessions/${sessionId}/local-folders/*/refresh`, async route => {
    refreshRequests += 1
    await route.continue()
  })
  await group.getByRole('button', { name: 'Refresh Research notes/', exact: true }).click()
  const useSaved = page.getByRole('button', { name: 'Use saved state', exact: true }).filter({ visible: true }).first()
  await expect(useSaved).toBeVisible()
  await expect(preview).toContainText('Portable recursive copy')
  expect(refreshRequests).toBe(0, 'capture refusal occurs before any refresh request')
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshotTree' || c[0] === 'snapshot'))).toEqual([])
  await useSaved.click()
  await expect(preview).toContainText('Portable recursive copy')
})

test('local connection controls and detail fit every viewport, including long names', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  const name = `Research-${'long-name-'.repeat(16)}`
  await nativeFixture(page, name)
  await page.goto('/')
  const dialog = await picker(page)
  await dialog.getByRole('checkbox', { name: /Remember this connection/ }).check()
  await dialog.getByRole('button', { name: 'Choose a folder from this computer' }).click()
  await expect(dialog.getByText('Remembered on this device', { exact: true })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await dialog.getByRole('button', { name: `Attach ${name}`, exact: true }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('button', { name: `Attach ${name}`, exact: true })).toBeVisible()
    await expect.poll(async () => {
      const frame = await dialog.boundingBox()
      const done = await dialog.getByRole('button', { name: 'Done', exact: true }).boundingBox()
      return !!frame && !!done && done.y + done.height <= frame.y + frame.height - 7
    }, { message: 'Done remains fully inside the bounded picker, not clipped by overflow' }).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `Native folder picker ${viewport.width}x${viewport.height}`)
    await mkdir('.data/screenshots', { recursive: true })
    await page.screenshot({ path: `.data/screenshots/local-folder-picker-${viewport.width}x${viewport.height}-${info.workerIndex}.png`, fullPage: true })
  }
  await dialog.getByRole('button', { name: `Manage ${name}`, exact: true }).click()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `Native folder detail ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/screenshots/local-folder-detail-${viewport.width}x${viewport.height}-${info.workerIndex}.png`, fullPage: true })
  }
  expect(await page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot'))).toEqual([])
})

test('shared readers see saved local text without native authority; foreign accounts cannot retrieve it', async ({ browser }, info: TestInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-gamma' })
  try {
    const made = await owner.page.request.post('/api/v1/sessions', { data: {} })
    const sessionId = (await made.json()).id
    const saved = await owner.page.request.patch(`/api/v1/sessions/${sessionId}/context-state`, { data: {
      operations: [{ action: 'attach', context: { id: FOLDER_ID, type: 'folder', label: 'Research', scope: ID, source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' } } }],
      workspace: { workspaces: [{ id: 'workspace-main', label: 'Workspace', artifacts: [], folders: [{ id: FOLDER_ID, label: 'Research/', localSnapshot: { version: 2, scope: 'recursive', connectionId: ID, snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capturedAt: '2026-10-04T12:00:00.000Z', files: [{ name: RELATIVE_FILE, sizeBytes: 17, snapshot: { text: 'Shared local copy' } }] } }] }], repos: [], connectors: [], attachments: [] },
    } })
    expect(saved.ok()).toBe(true)
    expect((await owner.page.request.post('/api/v1/grants', { data: { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' } })).ok()).toBe(true)
    await nativeFixture(reader.page)
    await reader.page.goto(`/s/${sessionId}`)
    for (const viewport of VIEWPORTS) {
      await reader.page.setViewportSize(viewport)
      await settledAttachmentPreview(reader.page, `[data-workspace-folder="${FOLDER_ID}"]`)
      const fileRow = reader.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`).getByRole('button').filter({ hasText: RELATIVE_FILE }).last()
      if (viewport.width === 844) await revealRowWithinScrollport(fileRow)
      await expect(reader.page.locator('[data-folder-snapshot-preview]').filter({ visible: true })).toContainText('Shared local copy')
      await expect(reader.page.locator(`[data-workspace-folder="${FOLDER_ID}"]`)).toContainText('including subfolders (relative paths shown)')
      await expect(reader.page.getByText(RELATIVE_FILE, { exact: true }).filter({ visible: true }).last()).toBeVisible()
      await expect(reader.page.getByRole('button', { name: 'Refresh Research/', exact: true })).toHaveCount(0)
      await expect(reader.page.locator('[data-served-folder-state="saved"]').filter({ visible: true })).toContainText('Only the conversation owner can refresh this copy.')
      await assertWcag22Aa(reader.page, `Shared local copy ${viewport.width}x${viewport.height}`)
      await mkdir('.data/screenshots', { recursive: true })
      await reader.page.screenshot({ path: `.data/screenshots/local-folder-shared-${viewport.width}x${viewport.height}-${info.workerIndex}.png`, fullPage: true })
    }
    expect(await reader.page.evaluate(() => (window as any).__localFolders.calls.filter((c: any[]) => c[0] === 'snapshot'))).toEqual([])
    expect((await foreign.page.request.get(`/api/v1/sessions/${sessionId}`)).status()).toBe(404)
  } finally { await owner.context.close(); await reader.context.close(); await foreign.context.close() }
})
