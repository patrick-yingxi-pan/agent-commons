import { test, expect, type Locator, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers'

const UI_HOST_FS_MODULE = /\/src\/lib\/uiHostFs(?:\.ts)?(?:\?|$)/
const UI_HOST_DROP_ZONE_MODULE = /\/src\/components\/UiHostDropZone(?:\.tsx)?(?:\?|$)/

async function openFilesSource(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  return picker
}

async function readyFileChooser(page: Page, picker: Locator, name: string, body: string) {
  const choosing = page.waitForEvent('filechooser')
  await picker.getByRole('button', { name: /Add files from this computer/ }).click()
  await (await choosing).setFiles([{ name, mimeType: 'text/plain', buffer: Buffer.from(body) }])
}

test('local picker loads lazily, fences a held load on close, then reopens the real chooser', async ({ page }) => {
  test.setTimeout(ms(45_000))
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let routeFinishedResolve: () => void = () => {}
  const routeFinished = new Promise<void>((resolve) => { routeFinishedResolve = resolve })
  let moduleRequests = 0
  let chooserSeen = false
  page.on('filechooser', () => { chooserSeen = true })
  await page.route(UI_HOST_FS_MODULE, async (route) => {
    moduleRequests += 1
    await held
    try { await route.continue() } finally { routeFinishedResolve() }
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  expect(moduleRequests, 'local filesystem module is not loaded by app boot').toBe(0)

  const picker = await openFilesSource(page)
  await expect(picker.getByRole('status')).toContainText('Loading file access')
  await expect(picker.getByRole('button', { name: /Add files from this computer/ })).toHaveCount(0)
  expect(moduleRequests).toBe(1)
  expect(chooserSeen, 'a held module must not activate a native file chooser').toBe(false)

  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add context', exact: true })).toHaveCount(0)
  release()
  await routeFinished
  await expect(page.locator('[data-attachment-preview]')).toHaveCount(0)
  expect(chooserSeen, 'closing the picker must fence a late module resolution').toBe(false)

  const reopened = await openFilesSource(page)
  await expect(reopened.getByRole('button', { name: /Add files from this computer/ })).toBeVisible()
  await readyFileChooser(page, reopened, 'late-ready.txt', 'reopened local picker works')
  await expect(page.locator('[data-attachment-preview]')).toContainText('reopened local picker works')
  await page.keyboard.press('Escape')
})

test('a failed local filesystem module discloses reload consequences and recovers the chooser', async ({ page }) => {
  test.setTimeout(ms(45_000))
  let moduleRequests = 0
  await page.route(UI_HOST_FS_MODULE, async (route) => {
    moduleRequests += 1
    if (moduleRequests === 1) return route.abort()
    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  expect(moduleRequests).toBe(0)
  const picker = await openFilesSource(page)
  await expect(picker.getByRole('alert')).toContainText('Local file access could not be loaded', { timeout: ms(10_000) })
  await expect(picker.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  await expect(picker.getByRole('alert')).toContainText('Copy any unsent text first')
  await expect(picker.locator('[data-local-picker-load="error"]')).toBeVisible()
  expect(moduleRequests).toBe(1)

  for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    await assertWcag22Aa(page, `Local picker load failure ${width}x${height}`)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.data/xlsx-review/loader-${width}x${height}.png` })
  }
  await picker.getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  const recovered = await openFilesSource(page)
  await expect(recovered.getByRole('button', { name: /Add files from this computer/ })).toBeVisible({ timeout: ms(10_000) })
  expect(moduleRequests).toBe(2)
  await readyFileChooser(page, recovered, 'retry-ready.txt', 'retry recovered local picker')
  await expect(page.locator('[data-attachment-preview]')).toContainText('retry recovered local picker')
  await page.keyboard.press('Escape')
})

test('local intake waits for its drop-zone module and explicit reload recovers a failed admission', async ({ page }) => {
  test.setTimeout(ms(45_000))
  let moduleRequests = 0
  let chooserSeen = false
  page.on('filechooser', () => { chooserSeen = true })
  await page.route(UI_HOST_DROP_ZONE_MODULE, async (route) => {
    moduleRequests += 1
    if (moduleRequests === 1) return route.abort()
    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  expect(moduleRequests, 'drop-zone module is not loaded by app boot').toBe(0)

  const picker = await openFilesSource(page)
  await expect(picker.getByRole('alert')).toContainText('Local file access could not be loaded', { timeout: ms(10_000) })
  await expect(picker.getByRole('button', { name: /Add files from this computer/ })).toHaveCount(0)
  expect(moduleRequests).toBe(1)
  expect(chooserSeen, 'incomplete admission must not activate a native file chooser').toBe(false)

  await picker.getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  const recovered = await openFilesSource(page)
  await expect(recovered.getByRole('button', { name: /Add files from this computer/ })).toBeVisible({ timeout: ms(10_000) })
  expect(moduleRequests).toBe(2)
  await readyFileChooser(page, recovered, 'drop-zone-ready.txt', 'drop-zone reload recovered local picker')
  await expect(page.locator('[data-attachment-preview]')).toContainText('drop-zone reload recovered local picker')
  await page.keyboard.press('Escape')
})
