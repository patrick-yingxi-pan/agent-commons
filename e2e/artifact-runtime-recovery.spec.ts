/** Browser proof for pre-form Artifact mutation-runtime admission and recovery. */
import { mkdirSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const API = '/api/v1'
const ARTIFACT_RUNTIME_MODULE = /\/src\/controller\/artifactCreationMutationRuntime(?:\.ts)?(?:\?|$)/
const REVIEW_DIR = '.data/artifact-runtime-recovery-review'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

mkdirSync(REVIEW_DIR, { recursive: true })

async function expectDialogContained(page: Page, dialog: Locator) {
  await expect.poll(async () => {
    const panel = dialog.locator('[data-bounded-dialog="resource-form"]')
    const footer = panel.locator(':scope > div').last()
    const [panelBox, footerBox] = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    const viewport = page.viewportSize()
    const contained = (box: NonNullable<typeof panelBox>) => box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport!.width - 7 && box.y + box.height <= viewport!.height - 7
    return !!panelBox && !!footerBox && !!viewport && contained(panelBox) && contained(footerBox)
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function captureState(page: Page, dialog: Locator, state: 'loading' | 'failed' | 'recovered') {
  const marker = state === 'failed' ? 'failed' : state === 'loading' ? 'loading' : null
  if (marker) await expect(dialog.locator(`[data-artifact-form-load="${marker}"]`)).toBeVisible()
  if (state === 'loading') await expect(dialog.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
  if (state === 'failed') await expect(dialog.getByRole('alert')).toContainText('Copy any unsent workspace text before reloading')
  if (state === 'recovered') {
    await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Content', { exact: true })).toBeVisible()
  }
  await expectDialogContained(page, dialog)
  await assertWcag22Aa(page, `Artifact runtime ${state} ${page.viewportSize()!.width}x${page.viewportSize()!.height}`)
  await page.screenshot({ path: `${REVIEW_DIR}/form-${state}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`, fullPage: false })
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

test('Artifact creation runtime admission fails closed and recovers only after reload', async ({ page }) => {
  test.setTimeout(ms(120_000))
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let runtimeRequests = 0
  let firstRouteFinished!: () => void
  const firstRouteComplete = new Promise<void>((resolve) => { firstRouteFinished = resolve })
  await page.on('request', (request) => {
    if (ARTIFACT_RUNTIME_MODULE.test(new URL(request.url()).pathname + new URL(request.url()).search)) runtimeRequests++
  })
  await page.route(ARTIFACT_RUNTIME_MODULE, async (route) => {
    await held
    try { await route.abort() } finally { firstRouteFinished() }
  })

  let creates = 0
  await page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts`) creates++
  })

  try {
    await page.goto('/artifacts')
    await expect(page.getByRole('button', { name: 'New artifact', exact: true })).toBeVisible()
    expect(runtimeRequests, 'the mutation runtime is not loaded during section boot').toBe(0)

    const loading = await openDialog(page)
    await expect(loading.locator('[data-artifact-form-load="loading"]')).toBeVisible()
    await expect(loading.getByRole('status')).toContainText('Loading artifact form')
    await expect(loading.getByLabel('Name', { exact: true })).toHaveCount(0)
    await expect(loading.getByLabel('Content', { exact: true })).toHaveCount(0)
    await expect.poll(() => runtimeRequests, {
      message: 'opening New artifact must admit the mutation runtime before editable fields',
    }).toBe(1)
    await expect(loading.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(loading.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await captureState(page, loading, 'loading')
    }

    await page.keyboard.press('Escape')
    await expect(loading).toHaveCount(0)
    release()
    await firstRouteComplete
    expect(creates).toBe(0)

    const failed = await openDialog(page)
    await expect(failed.locator('[data-artifact-form-load="failed"]')).toBeVisible()
    await expect(failed.getByRole('alert')).toContainText('The artifact form could not be loaded')
    await expect(failed.getByLabel('Name', { exact: true })).toHaveCount(0)
    await expect(failed.getByLabel('Content', { exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await captureState(page, failed, 'failed')
    }

    await failed.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(failed).toHaveCount(0)
    await page.unroute(ARTIFACT_RUNTIME_MODULE)
    const stillFailed = await openDialog(page)
    await expect(stillFailed.locator('[data-artifact-form-load="failed"]')).toBeVisible()
    expect(runtimeRequests).toBe(1)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      stillFailed.getByRole('button', { name: 'Reload app', exact: true }).click(),
    ])
    await expect(page.getByRole('button', { name: 'New artifact', exact: true })).toBeVisible()
    const recovered = await openDialog(page)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await captureState(page, recovered, 'recovered')
    }
    expect(runtimeRequests).toBe(2)

    const stamp = Date.now().toString(36)
    const name = `runtime-recovered-${stamp}.md`
    const body = `Recovered runtime artifact ${stamp}.`
    await recovered.getByLabel('Name', { exact: true }).fill(name)
    await recovered.getByLabel('Content', { exact: true }).fill(body)
    await recovered.getByRole('button', { name: 'Create document', exact: true }).click()
    await expect(recovered).toHaveCount(0)
    await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
    await expect(page.locator('[data-artifact-page] p').filter({ hasText: body })).toBeVisible()
    expect(creates).toBe(1)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
