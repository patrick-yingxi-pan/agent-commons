import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { startMcpFixture, startMcpRouterStack, proxyMcpApi } from './mcp-fixture'
import { ms } from './budget.ts'
import { tierFor } from '../src/lib/viewport.ts'

const CLEAN_CATALOG = {
  developmentFixtures: false,
  connectors: [],
  mcp: [],
  repos: [],
  setups: [],
}

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

const FIXTURE_CHOICES = [
  'Google Drive', 'Slack', 'Notion', 'Linear', 'Jira', 'Google Calendar', 'Figma', 'Sentry', 'Asana', 'Intercom',
  'HubSpot', 'Dropbox', 'Zoom', 'Airtable', 'Stripe',
  'filesystem', 'github', 'postgres', 'puppeteer', 'sqlite', 'fetch', 'brave-search', 'memory', 'time', 'gitlab',
  'patrick-yingxi-pan/web-app', 'patrick-yingxi-pan/agent-commons', 'acme/dashboard', 'acme/api-gateway',
  'insights-dashboard', 'data-scripts', 'marketing-site',
]

async function useCleanTenant(page: Page) {
  // Each walk gets an empty tenant so saved connections and prior E2E writes
  // cannot accidentally make a clean-catalog assertion pass or fail.
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-context-catalog-${randomUUID()}`,
  })
  await page.route('**/api/v1/context-catalog**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(CLEAN_CATALOG),
  }))
}

async function assertNoFixtureChoices(surface: ReturnType<Page['locator']>) {
  for (const choice of FIXTURE_CHOICES) {
    const escaped = choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await expect(surface.getByRole('button', { name: new RegExp(`^${escaped}(?:$|\\s)`) }), `fixture choice ${choice} is absent`).toHaveCount(0)
  }
}

async function assertPopoverFits(page: Page, popover: ReturnType<Page['getByRole']>) {
  await expect(popover).toBeVisible()
  const viewport = page.viewportSize()!
  const narrow = tierFor(viewport.width) === 'narrow'
  await expect.poll(() => popover.evaluate((element, isNarrow) => {
    const panel = element.getBoundingClientRect()
    const rail = document.querySelector('[aria-label="Collapse sidebar"]')?.closest('[inert]')
    const controls = [...element.querySelectorAll('button, [role="status"], [role="alert"]')]
    return panel.left >= 7 && panel.right <= innerWidth - 7 && panel.top >= 7 && panel.bottom <= innerHeight - 7
      && document.documentElement.scrollWidth <= innerWidth
      && (!isNarrow || !!rail && rail.getBoundingClientRect().width === 0)
      && controls.every(control => {
        const box = control.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.left >= panel.left && box.right <= panel.right
          && box.top >= panel.top && box.bottom <= panel.bottom
      })
  }, narrow), 'the popover stays 7px inside the viewport, the narrow rail is inert and collapsed, and important controls stay inside the popover').toBe(true)
}

async function assertDemoDisclosure(dialog: ReturnType<Page['getByRole']>) {
  const note = dialog.locator('[data-context-catalog-state="demo"]')
  await expect(note).toHaveText('Demo contexts — sample data only.')
  await expect(note).toBeVisible()
}

async function assertBrowseDialogFits(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const viewport = page.viewportSize()!
  const narrow = tierFor(viewport.width) === 'narrow'
  const frame = dialog.locator(':scope > div').nth(1)
  await expect.poll(() => frame.evaluate((element, isNarrow) => {
    const box = element.getBoundingClientRect()
    const rail = document.querySelector('[aria-label="Collapse sidebar"]')?.closest('[inert]')
    const note = element.querySelector('[data-context-catalog-state="demo"]')?.getBoundingClientRect()
    const footer = element.lastElementChild
    const controls = footer ? [...footer.querySelectorAll('button')] : []
    return box.left >= 7 && box.right <= innerWidth - 7 && box.top >= 7 && box.bottom <= innerHeight - 7
      && document.documentElement.scrollWidth <= innerWidth
      && (!isNarrow || !!rail && rail.getBoundingClientRect().width === 0)
      && !!note && note.width > 0 && note.height > 0 && note.left >= box.left && note.right <= box.right
      && note.top >= box.top && note.bottom <= box.bottom
      && controls.length >= 2 && controls.every(control => {
        const item = control.getBoundingClientRect()
        return item.width > 0 && item.height > 0 && item.left >= box.left && item.right <= box.right
          && item.top >= box.top && item.bottom <= box.bottom
      })
  }, narrow), 'the browser frame and its controls stay 7px inside the viewport after narrow-rail settling').toBe(true)
}

test('clean context catalog keeps Contexts and composer entry points truthful across the viewport ladder', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(90_000))
  await useCleanTenant(page)
  await page.goto('/contexts')
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Add context', exact: true }).click()
  const contextsPopover = page.getByRole('dialog', { name: 'Add context', exact: true })
  await expect(contextsPopover).toContainText('Add a local folder or an MCP server. Other integrations are not available yet.')
  await expect(contextsPopover.getByRole('button', { name: 'Add an MCP server', exact: true })).toBeVisible()
  await assertNoFixtureChoices(contextsPopover)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertPopoverFits(page, contextsPopover)
    await page.screenshot({ path: testInfo.outputPath(`contexts-add-clean-${viewport.width}x${viewport.height}.png`) })
  }
  await page.keyboard.press('Escape')

  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const composerPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await composerPicker.getByRole('button', { name: /^Repository/ }).click()
  await expect(composerPicker).toContainText('Repository connections are not available yet. Add files or a folder instead.')
  await assertNoFixtureChoices(composerPicker)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertPopoverFits(page, composerPicker)
    await page.screenshot({ path: testInfo.outputPath(`composer-repository-clean-${viewport.width}x${viewport.height}.png`) })
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await composerPicker.getByRole('button', { name: /^Connector/ }).click()
  await expect(composerPicker).toContainText('No connector adapters are configured. You can add an MCP server from Contexts.')
  await assertNoFixtureChoices(composerPicker)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertPopoverFits(page, composerPicker)
    await page.screenshot({ path: testInfo.outputPath(`composer-connector-clean-${viewport.width}x${viewport.height}.png`) })
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await composerPicker.getByRole('button', { name: /^MCP server/ }).click()
  await expect(composerPicker.getByRole('button', { name: 'Add an MCP server…', exact: true })).toBeVisible()
  await assertNoFixtureChoices(composerPicker)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertPopoverFits(page, composerPicker)
    await page.screenshot({ path: testInfo.outputPath(`composer-mcp-clean-${viewport.width}x${viewport.height}.png`) })
  }
})

test('pending, failed, and retried catalog reads never expose demo choices', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-context-catalog-retry-${randomUUID()}`,
  })
  let releaseFirst!: () => void
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve })
  let requestCount = 0
  await page.route('**/api/v1/context-catalog**', async route => {
    requestCount++
    if (requestCount === 1) {
      await firstResponse
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'catalog unavailable' } }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLEAN_CATALOG) })
    }
  })
  await page.goto('/contexts')
  await page.getByRole('main').getByRole('button', { name: 'Add context', exact: true }).click()
  const popover = page.getByRole('dialog', { name: 'Add context', exact: true })
  const loading = popover.locator('[data-context-catalog-state="loading"]')
  await expect(loading).toContainText('Loading context options…')
  await expect(loading.getByRole('button')).toHaveCount(0)
  await assertNoFixtureChoices(popover)
  releaseFirst()
  const failure = popover.locator('[data-context-catalog-state="error"]')
  await expect(failure).toContainText('Could not load context options.')
  await expect(failure.getByRole('button', { name: 'Retry context options', exact: true })).toBeVisible()
  await assertNoFixtureChoices(popover)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertPopoverFits(page, popover)
    await page.screenshot({ path: testInfo.outputPath(`contexts-catalog-error-${viewport.width}x${viewport.height}.png`) })
  }

  await failure.getByRole('button', { name: 'Retry context options', exact: true }).click()
  await expect(popover.locator('[data-context-catalog-state="demo"]')).toHaveCount(0)
  await expect(popover.locator('[data-context-catalog-state="error"]')).toHaveCount(0)
  await expect(popover).toContainText('Add a local folder or an MCP server. Other integrations are not available yet.')
  await assertNoFixtureChoices(popover)
  expect(requestCount).toBeGreaterThanOrEqual(2)
})

test('a clean catalog discloses demo fixtures when they are explicitly returned', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-context-catalog-demo-${randomUUID()}`,
  })
  const demoCatalog = {
    developmentFixtures: true,
    connectors: [{ id: 'catalog-demo-option', label: 'Catalog demo fixture', kind: 'connector' }],
    mcp: [],
    repos: [],
    setups: [{ id: 'catalog-demo-option', label: 'Catalog demo fixture', kind: 'connector', connectorKind: 'connector', status: 'connected', detail: 'Demo only', lastUsedAt: 0, sessions: 0 }],
  }
  await page.route('**/api/v1/context-catalog**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(demoCatalog),
  }))
  await page.goto('/contexts')
  await page.getByRole('main').getByRole('button', { name: 'Add context', exact: true }).click()
  const popover = page.getByRole('dialog', { name: 'Add context', exact: true })
  await expect(popover.locator('[data-context-catalog-state="demo"]')).toHaveText('Demo contexts — sample data only.')
  await expect(popover.getByRole('button', { name: /^Catalog demo fixture(?:$|\s)/ })).toBeVisible()
})

test('a real available external MCP connection remains attachable with an empty context catalog', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-context-catalog-mcp-${randomUUID()}`,
  })
  const fixture = await startMcpFixture({ label: 'Catalog bridge fixture' })
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  await page.route('**/api/v1/context-catalog**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(CLEAN_CATALOG),
  }))
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const composerPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await composerPicker.getByRole('button', { name: /^MCP server/ }).click()
    await composerPicker.getByRole('button', { name: 'Add an MCP server…', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name').fill('Catalog bridge fixture')
    await create.getByLabel('Server URL').fill(fixture.url)
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/mcp-connections')
    await create.getByRole('button', { name: 'Save server', exact: true }).click()
    expect((await saved).ok()).toBe(true)

    await page.goto('/contexts')
    const row = page.getByRole('main').getByRole('button', { name: 'Catalog bridge fixture', exact: true })
    await expect(row).toBeVisible({ timeout: ms(20_000) })
    await row.click()
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.calls).toEqual(['server/discover', 'tools/list'])

    await page.getByRole('button', { name: 'New session', exact: true }).click()
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await picker.getByRole('button', { name: /^MCP server/ }).click()
    const available = picker.getByRole('button', { name: /^Connected Catalog bridge fixture(?:$|\s)/ })
    await expect(available).toBeVisible()
    await expect(available).toContainText('Approval required for every call')
    await available.click()
    await expect(available).toContainText('Added')
    expect(fixture.calls).toEqual(['server/discover', 'tools/list'])
  } finally {
    await disposeProxy()
    await fixture.close()
    await stack.close()
  }
})

test('demo repository, connector, and MCP browsers disclose sample data at every viewport', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(150_000))
  // A fresh tenant has no recents promoted by other specs, while the demo
  // catalog remains the real world-wide server projection (not intercepted).
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-context-catalog-demo-browse-${randomUUID()}`,
  })
  const response = await page.request.get('/api/v1/context-catalog')
  expect(response.ok()).toBe(true)
  const catalog = await response.json() as { developmentFixtures?: boolean }
  expect(catalog.developmentFixtures, 'this walk uses the real demo server catalog').toBe(true)

  await page.goto('/')
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()

  const openPicker = async (typeName: RegExp, browseName: string) => {
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await picker.getByRole('button', { name: typeName }).click()
    await picker.getByRole('button', { name: browseName, exact: true }).click()
    return { picker, browse: page.getByRole('dialog', { name: / — browse$/, exact: false }) }
  }

  const repository = await openPicker(/^Repository/, 'Browse repositories…')
  const githubRepo = repository.browse.getByRole('button', { name: /^patrick-yingxi-pan\/web-app(?:$|\s)/ })
  await expect(githubRepo).toBeVisible()
  await githubRepo.click()
  await repository.browse.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(repository.picker).toContainText('Sample data only; no code is pushed and no PR is opened.')
  await repository.picker.getByRole('button', { name: 'Cancel', exact: true }).click()
  await repository.picker.getByRole('button', { name: 'Browse repositories…', exact: true }).click()

  const captureBrowser = async (kind: string, picker: ReturnType<Page['getByRole']>, browse: ReturnType<Page['getByRole']>) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await assertDemoDisclosure(browse)
      await assertBrowseDialogFits(page, browse)
      await page.screenshot({ path: testInfo.outputPath(`context-browser-demo-${kind}-${viewport.width}x${viewport.height}.png`) })
      if (viewport !== VIEWPORTS.at(-1)) {
        await browse.getByRole('button', { name: 'Cancel', exact: true }).click()
        const browseButton = kind === 'repository' ? 'Browse repositories…'
          : kind === 'connector' ? 'Connect a new account…' : 'Add an MCP server…'
        await picker.getByRole('button', { name: browseButton, exact: true }).click()
        browse = page.getByRole('dialog', { name: / — browse$/, exact: false })
      }
    }
    await browse.getByRole('button', { name: 'Cancel', exact: true }).click()
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
  }

  await captureBrowser('repository', repository.picker, repository.browse)
  const connector = await openPicker(/^Connector/, 'Connect a new account…')
  await captureBrowser('connector', connector.picker, connector.browse)
  const mcp = await openPicker(/^MCP server/, 'Add an MCP server…')
  await captureBrowser('mcp', mcp.picker, mcp.browse)
})

test('rejected repository picker module keeps a fresh draft safe and recovers after explicit reload', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await useCleanTenant(page)
  let rejectModule = true
  let moduleRequests = 0
  await page.route('**/src/components/RepoContextPicker.tsx*', async route => {
    moduleRequests++
    if (rejectModule) await route.abort('failed')
    else await route.fallback()
  })

  await page.goto('/')
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  const draft = 'Keep this unsent note while repository options recover.'
  await composer.fill(draft)

  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Repository/ }).click()
  const failed = picker.locator('[data-context-repo-load="error"]')
  await expect(failed).toContainText('Couldn’t load repository options. Copy unsent text before reloading.')
  await expect(failed.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  expect(moduleRequests).toBeGreaterThan(0)
  await expect(composer).toHaveValue(draft)

  await failed.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(composer).toHaveValue(draft)

  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: /^Repository/ }).click()
  const reopenedFailure = page.locator('[data-context-repo-load="error"]')
  await expect(reopenedFailure.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  await expect(composer).toHaveValue(draft)

  rejectModule = false
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  await reopenedFailure.getByRole('button', { name: 'Reload app', exact: true }).click()
  await navigation

  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const recoveredPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await recoveredPicker.getByRole('button', { name: /^Repository/ }).click()
  await expect(recoveredPicker).toContainText('Repository connections are not available yet. Add files or a folder instead.')
  await expect(recoveredPicker.locator('[data-context-repo-load="error"]')).toHaveCount(0)
  await assertNoFixtureChoices(recoveredPicker)
})
