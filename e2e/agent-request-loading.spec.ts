/** Real deferred modules keep Agent setup and private request doors recoverable. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { ms } from './budget.ts'
import { settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'

const viewports = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const cases = [
  { name: 'request history', module: 'AgentRequestsSummaryRuntime', url: '/agents/coordination',
    loading: 'Loading requests…', failure: 'Couldn’t load request history.', ready: (page: Page) => page.getByRole('main').getByRole('status').filter({ hasText: /^Loading requests…$/ }) },
  { name: 'request controls', module: 'AgentRequestsPageRuntime', url: '/agents/requests',
    loading: 'Loading request controls…', failure: 'Couldn’t load request controls.', ready: (page: Page) => page.getByRole('heading', { name: 'Ask another Agent', exact: true }) },
  { name: 'Agent form', module: 'AgentDialog', url: '/agents',
    loading: 'Loading Agent options…', failure: 'The Agent form couldn’t be loaded.', ready: (page: Page) => page.getByRole('dialog', { name: 'New agent', exact: true }).getByLabel('Name', { exact: true }) },
] as const

async function open(page: Page, entry: typeof cases[number]) {
  await page.goto(entry.url)
  if (entry.module === 'AgentDialog') await page.getByRole('button', { name: 'New agent', exact: true }).click()
}

async function announceDelayedModule(page: Page, info: TestInfo, entry: typeof cases[number]) {
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/v1\/(agents|agent-requests)(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url())
  })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let intercepted = false
  await page.route(`**/src/components/${entry.module}.tsx*`, async route => {
    intercepted = true
    await gate
    await route.continue()
  })
  const navigation = open(page, entry)
  try {
    const loading = page.getByRole('status').filter({ hasText: entry.loading }).first()
    await expect(loading).toBeVisible({ timeout: ms(20_000) })
    expect(intercepted).toBe(true)
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      if (entry.module !== 'AgentDialog') await settledNarrowRail(page)
      await loading.scrollIntoViewIfNeeded()
      await settledOpaquePaint(loading)
      await expect(loading).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`loading-${viewport.width}.png`) })
    }
    expect(writes).toEqual([])
  } finally { release() }
  await navigation
  if (entry.module === 'AgentRequestsSummaryRuntime') await expect(entry.ready(page)).toHaveCount(0)
  else await expect(entry.ready(page)).toBeVisible()
  expect(writes).toEqual([])
}

async function containModuleFailure(page: Page, info: TestInfo, entry: typeof cases[number]) {
  let blocked = true, intercepted = false
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/v1\/(agents|agent-requests)(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url())
  })
  await page.route(`**/src/components/${entry.module}.tsx*`, async route => {
    if (!blocked) return route.continue()
    intercepted = true
    await route.abort('failed')
  })
  await open(page, entry)
  const failed = page.getByRole('alert').filter({ hasText: entry.failure })
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  expect(intercepted).toBe(true)
  await expect(failed).toContainText(/unsent/)
  const reload = entry.module === 'AgentDialog'
    ? page.getByRole('dialog', { name: 'New agent', exact: true }).getByRole('button', { name: 'Reload app', exact: true })
    : failed.getByRole('button', { name: 'Reload app', exact: true })
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    if (entry.module !== 'AgentDialog') await settledNarrowRail(page)
    await reload.scrollIntoViewIfNeeded()
    await settledOpaquePaint(reload)
    await expect(reload).toBeInViewport()
    await page.screenshot({ path: info.outputPath(`failed-${viewport.width}.png`) })
  }
  expect(writes).toEqual([])
  blocked = false
  await reload.click()
  await expect(failed).toHaveCount(0)
  if (entry.module === 'AgentDialog') await page.getByRole('button', { name: 'New agent', exact: true }).click()
  if (entry.module === 'AgentRequestsSummaryRuntime') await expect(entry.ready(page)).toHaveCount(0)
  else await expect(entry.ready(page)).toBeVisible()
  expect(writes).toEqual([])
}

test('request history announces a delayed module at five viewports without writing', async ({ page }, info) => {
  test.setTimeout(ms(75_000))
  await announceDelayedModule(page, info, cases[0])
})

test('request history contains module failure and explicitly reloads without writing', async ({ page }, info) => {
  test.setTimeout(ms(75_000))
  await containModuleFailure(page, info, cases[0])
})

test('request controls announces a delayed module at five viewports without writing', async ({ page }, info) => {
  test.setTimeout(ms(75_000))
  await announceDelayedModule(page, info, cases[1])
})

test('request controls contains module failure and explicitly reloads without writing', async ({ page }, info) => {
  test.setTimeout(ms(75_000))
  await containModuleFailure(page, info, cases[1])
})

test('Agent form announces a delayed module at five viewports without writing', async ({ page }, info) => {
  test.setTimeout(ms(75_000))
  await announceDelayedModule(page, info, cases[2])
})

test('Agent form contains module failure and explicitly reloads without writing', async ({ page }, info) => {
  test.setTimeout(ms(75_000))
  await containModuleFailure(page, info, cases[2])
})
