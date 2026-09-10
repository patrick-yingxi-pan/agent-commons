import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const FILE_MODULE = /\/src\/lib\/uiHostFs(?:\.ts)?(?:\?|$)/
const ARTIFACT_FORM_MODULE = /\/src\/components\/NewArtifactDialog(?:\.tsx)?(?:\?|$)/
const VIEWPORTS = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function installHeldNativePicker(page: Page) {
  await page.addInitScript(() => {
    const pending: Array<(value: unknown) => void> = []
    Object.assign(window, {
      __importPicks: pending,
      agentCommonsDesktop: { context: {
        pickFiles: () => new Promise((resolve) => { pending.push(resolve) }),
        pickFolder: async () => ({ status: 'cancelled' }),
      } },
    })
  })
}

async function finishPick(page: Page, index: number, text: string | null) {
  await page.evaluate(({ index, text }) => {
    ;(window as any).__importPicks[index](text === null ? { status: 'cancelled' } : {
      status: 'selected', files: [{ name: 'native-notes.txt', kind: 'file', sizeBytes: text.length, text }],
    })
  }, { index, text })
}

async function captureArtifactFormState(page: Page, state: 'loading' | 'error') {
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  const marker = dialog.locator(`[data-artifact-form-load="${state === 'error' ? 'failed' : 'loading'}"]`)
  await expect(marker).toBeVisible()
  await expect.poll(async () => {
    const panel = dialog.locator('[data-bounded-dialog="resource-form"]')
    const box = await panel.boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await assertWcag22Aa(page, `Artifact form ${state} ${page.viewportSize()!.width}x${page.viewportSize()!.height}`)
  await page.screenshot({ path: `.data/artifact-import-review/form-${state}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`, fullPage: false })
}

test('deferred artifact form stays inert while loading, fences late rejection, and recovers by full reload', async ({ page }) => {
  test.setTimeout(ms(90_000))
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let requestCount = 0
  let routeFinished!: () => void
  const routeComplete = new Promise<void>((resolve) => { routeFinished = resolve })
  await page.route(ARTIFACT_FORM_MODULE, async (route) => {
    requestCount++
    if (requestCount === 1) {
      await held
      try { await route.abort() } finally { routeFinished() }
      return
    }
    await route.continue()
  })

  await page.goto('/artifacts')
  await expect(page.getByRole('button', { name: 'New artifact', exact: true })).toBeVisible()
  expect(requestCount, 'artifact form chunk is absent from section boot').toBe(0)
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const loading = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(loading.locator('[data-artifact-form-load="loading"]')).toBeVisible()
  await expect(loading.getByRole('status')).toContainText('Loading artifact form')
  await expect(loading.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
  await expect(loading.getByLabel('Name', { exact: true })).toHaveCount(0)
  await expect(loading.getByLabel('Content', { exact: true })).toHaveCount(0)
  const close = loading.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await captureArtifactFormState(page, 'loading')
  }
  await loading.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(loading).toHaveCount(0)
  release()
  await routeComplete
  await expect(loading).toHaveCount(0)

  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const failed = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(failed.locator('[data-artifact-form-load="failed"]')).toBeVisible()
  await expect(failed.getByRole('alert')).toContainText('Copy any unsent workspace text before reloading')
  await expect(failed.getByLabel('Name', { exact: true })).toHaveCount(0)
  await expect(failed.getByLabel('Content', { exact: true })).toHaveCount(0)
  await expect(failed.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(failed.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(failed.getByRole('button', { name: 'Reload app', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(failed.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await captureArtifactFormState(page, 'error')
  }

  await failed.getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New artifact', exact: true })).toBeVisible()
  const recovered = await openDialog(page)
  await expect(recovered.getByLabel('Name', { exact: true })).toBeVisible()
  expect(requestCount).toBe(2)
  const stamp = Date.now().toString(36)
  const name = `deferred-recovered-${stamp}.md`
  const content = `Recovered artifact ${stamp}.`
  await recovered.getByLabel('Name', { exact: true }).fill(name)
  await recovered.getByLabel('Content', { exact: true }).fill(content)
  await recovered.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(recovered).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  await expect(page.locator('[data-artifact-page]').getByText(content, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-artifact-page]').getByText(content, { exact: true })).toBeVisible()
})

test('artifact import loads before activation and a real chunk failure recovers only through explicit reload', async ({ page }) => {
  test.setTimeout(ms(90_000))
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let requests = 0
  await page.route(FILE_MODULE, async (route) => {
    requests++
    if (requests === 1) { await held; await route.abort(); return }
    await route.continue()
  })
  await page.goto('/artifacts')
  await expect(page.getByRole('button', { name: 'New artifact', exact: true })).toBeVisible()
  expect(requests, 'file access is absent from the section boot').toBe(0)
  let dialog = await openDialog(page)
  await expect(dialog.getByRole('status')).toContainText('Loading file access')
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toHaveCount(0)
  await dialog.getByLabel('Name', { exact: true }).fill('manual-draft.md')
  await dialog.getByLabel('Content', { exact: true }).fill('Typing remains available without local file access.')
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()
  release()
  await expect(dialog.getByRole('alert')).toContainText('Local file access could not be loaded')
  await expect(dialog.getByRole('alert')).toContainText('Copy any unsent text first')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const reload = dialog.getByRole('button', { name: 'Reload app', exact: true })
    await reload.scrollIntoViewIfNeeded()
    await assertWcag22Aa(page, `Document import module failure ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/artifact-import-review/loader-error-${viewport.width}x${viewport.height}.png` })
  }
  await dialog.getByRole('button', { name: 'Reload app', exact: true }).click()
  dialog = await openDialog(page)
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  expect(requests).toBe(2)
  const choosing = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await (await choosing).setFiles({ name: 'recovered.txt', mimeType: 'text/plain', buffer: Buffer.from('Recovered import text.') })
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveValue('Recovered import text.')
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('')
})

test('native-shaped cancellation, supersession, format change and close fence late imports without saving', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installHeldNativePicker(page)
  let creates = 0
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/artifacts') creates++ })
  await page.goto('/artifacts')
  let dialog = await openDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill('Keep this name.md')
  await dialog.getByLabel('Content', { exact: true }).fill('Keep this content.')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Reading selected file')
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  await dialog.getByLabel('Content', { exact: true }).fill('Typed while reading.')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const cancel = dialog.getByRole('button', { name: 'Cancel import', exact: true })
    await cancel.focus()
    // Resizing also updates the bounded dialog's scrollport. Use Playwright's
    // layout-stable scrolling rather than sampling that resize in raw DOM code.
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport({ ratio: 1 })
    await expect.poll(() => dialog.locator('[data-form-fields]').evaluate((fields) => {
      const boxes = Array.from(fields.children).map((field) => field.getBoundingClientRect())
      return boxes.length >= 4 && boxes.slice(1).every((box, index) => box.top - boxes[index].bottom >= 15.9)
    })).toBe(true)
    await assertWcag22Aa(page, `Document import reading ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/artifact-import-review/reading-${viewport.width}x${viewport.height}.png` })
  }
  await dialog.getByRole('button', { name: 'Cancel import', exact: true }).click()
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await finishPick(page, 1, 'New reviewed import.')
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveValue('New reviewed import.')
  await finishPick(page, 0, 'Late cancelled import.')
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveValue('New reviewed import.')
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('Typed while reading.')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()

  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await finishPick(page, 2, null)
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('Typed while reading.')

  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('sheet')
  await finishPick(page, 3, 'Late other-format import.')
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('doc')
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('Typed while reading.')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  dialog = await openDialog(page)
  await finishPick(page, 4, 'Late closed import.')
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('')
  expect(creates).toBe(0)
})

test('an account switch cannot carry a late native import into the next account draft', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await installHeldNativePicker(page)
  for (const name of ['grace', 'ada']) {
    const signed = await page.request.post('/api/v1/auth/login', { data: { email: `${name}@acme.example`, password: `${name}-demo-password` } })
    expect(signed.ok()).toBe(true)
  }
  await page.goto('/artifacts')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  let dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Reading selected file')
  await page.keyboard.press('Escape')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  // Navigate within the mounted document: reloading here would erase the late
  // native promise and make the account-isolation assertion vacuous.
  await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
  dialog = await openDialog(page)
  await dialog.getByLabel('Content', { exact: true }).fill('Grace draft.')
  await finishPick(page, 0, 'Ada private imported body.')
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue('Grace draft.')
  await expect(dialog.getByLabel('Imported text', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Ada private imported body.', { exact: true })).toHaveCount(0)
})
