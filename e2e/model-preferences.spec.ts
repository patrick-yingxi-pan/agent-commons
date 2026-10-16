/** Durable personal model intent: one acknowledged preference shared by the
 * fresh composer, Customize, and first-run setup without inferring registry
 * defaults or trusting origin-local storage. */
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import type { ModelProvider, ViewerModelPreferences } from '../contract/index.ts'
import { newUser, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const MODEL_PORT = 8830 + Number(process.env.E2E_SHARD ?? 0)
const LEGACY_MODEL_PREF_KEY = 'claude-ui.composer.modelEffort.v2'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

function testIdentity(stamp: string, suffix: string) {
  return {
    'x-user-id': `user-model-preferences-${suffix}-${stamp}`,
    'x-tenant-id': `tenant-model-preferences-${suffix}-${stamp}`,
  }
}

async function createEndpointProvider(page: Page, label: string, isDefault = false): Promise<ModelProvider> {
  const response = await page.request.post(`${API}/providers`, {
    data: {
      label,
      modelFamily: 'claude',
      effortLevels: ['Low', 'Medium', 'High'],
      config: { baseURL: `http://127.0.0.1:${MODEL_PORT}` },
      ...(isDefault ? { isDefault: true } : {}),
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json() as Promise<ModelProvider>
}

async function readPreference(page: Page): Promise<ViewerModelPreferences> {
  const response = await page.request.get(`${API}/viewer-preferences/model`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json() as Promise<ViewerModelPreferences>
}

async function defaultModelSurface(page: Page) {
  await page.goto('/customize')
  await openSection(page, 'Default model')
  const section = page.locator('section.group\\/section').filter({
    has: page.locator('[data-section-title]', { hasText: /^Default model$/ }),
  })
  const trigger = section.locator('button[aria-haspopup="dialog"]')
  await expect(trigger).toBeVisible()
  return { section, trigger }
}

async function pickProvider(page: Page, label: string) {
  const { trigger } = await defaultModelSurface(page)
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Default model and effort' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button').filter({ hasText: label }).click()
  return dialog
}

async function expectPopoverContained(page: Page, dialog: Locator, label: string) {
  const viewport = page.viewportSize()
  if (viewport && viewport.width < 640) {
    const main = page.locator('#main-workspace')
    const rail = main.locator('xpath=preceding-sibling::div[1]')
    await expect.poll(async () => ({
      mainInert: await main.evaluate((element) => element.hasAttribute('inert')),
      railInert: await rail.evaluate((element) => element.hasAttribute('inert')),
      railWidth: (await rail.boundingBox())?.width ?? Infinity,
    }), { message: `${label} waits for the narrow rail to finish collapsing` }).toEqual({
      mainInert: false,
      railInert: true,
      railWidth: 0,
    })
  }
  await expect(dialog, `${label} is visible`).toBeVisible()
  await expect.poll(async () => {
    const box = await dialog.boundingBox()
    if (!box) return false
    const currentViewport = page.viewportSize()
    if (currentViewport === null || box.x < 7 || box.y < 7 ||
      box.x + box.width > currentViewport.width - 7 || box.y + box.height > currentViewport.height - 7) return false
    const notice = page.locator('[data-revisioned-mutation="model-preferences"]:visible')
    if (await notice.count() === 0) return true
    const noticeBox = await notice.boundingBox()
    return noticeBox !== null && box.y >= noticeBox.y + noticeBox.height + 7
  }, { message: `${label} stays below recovery notices and inside the viewport` }).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    `${label} does not widen the page`).toBe(true)
}

async function capturePreferenceSurface(page: Page, suffix: string) {
  const viewport = page.viewportSize()!
  await page.screenshot({ path: `.data/model-preferences-review/${viewport.width}x${viewport.height}-${suffix}.png` })
}

test('Customize preference survives storage-free reload and remains scoped without registry guessing', async ({ browser }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  const adaHeaders = testIdentity(stamp, 'ada')
  const graceHeaders = testIdentity(stamp, 'grace')
  const ada = await newUser(browser, adaHeaders)
  const grace = await newUser(browser, graceHeaders)
  const adaLabel = `Ada durable model ${stamp}`
  const adaComposerLabel = `Ada composer model ${stamp}`
  const graceLabel = `Grace registry default ${stamp}`

  try {
    const adaProvider = await createEndpointProvider(ada.page, adaLabel)
    const adaComposerProvider = await createEndpointProvider(ada.page, adaComposerLabel)
    const graceProvider = await createEndpointProvider(grace.page, graceLabel, true)

    const customizeDialog = await pickProvider(ada.page, adaLabel)
    await expect.poll(async () => (await readPreference(ada.page)).preferences.providerId).toBe(adaProvider.id)
    await expect(customizeDialog.getByRole('button', { name: 'Low', exact: true })).toBeEnabled()
    await customizeDialog.getByRole('button', { name: 'Low', exact: true }).click()
    await expect.poll(async () => (await readPreference(ada.page)).preferences.effort).toBe('Low')

    // A changed packaged-desktop loopback origin has none of this storage.
    // Reconstruct both the current page and a second browser context from the
    // server-owned viewer preference alone.
    await ada.page.evaluate(() => localStorage.clear())
    await ada.page.reload()
    await openSection(ada.page, 'Default model')
    const reloadedDefault = ada.page.locator('section.group\\/section').filter({
      has: ada.page.locator('[data-section-title]', { hasText: /^Default model$/ }),
    })
    await expect(reloadedDefault.locator('button[aria-haspopup="dialog"]')).toContainText(adaLabel)

    const secondAda = await newUser(browser, adaHeaders)
    try {
      await secondAda.page.goto('/')
      await expect(secondAda.page.getByRole('button', { name: 'Model and effort' })).toContainText(adaLabel)
      await expect(secondAda.page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
      await secondAda.page.getByRole('button', { name: 'Model and effort' }).click()
      const composerPicker = secondAda.page.getByRole('dialog', { name: 'Model and effort' })
      await composerPicker.getByRole('button').filter({ hasText: adaComposerLabel }).click()
      await expect.poll(async () => (await readPreference(secondAda.page)).preferences.providerId).toBe(adaComposerProvider.id)
    } finally {
      await secondAda.context.close()
    }

    const thirdAda = await newUser(browser, adaHeaders)
    try {
      await thirdAda.page.goto('/')
      await expect(thirdAda.page.getByRole('button', { name: 'Model and effort' })).toContainText(adaComposerLabel)
      expect((await readPreference(thirdAda.page)).preferences.effort).toBe('Low')
    } finally {
      await thirdAda.context.close()
    }

    // A legacy unscoped browser blob and a tenant registry `isDefault` are not
    // personal composer intent. With no saved Grace preference, the built-in
    // provider remains selected and unavailable instead of guessing either row.
    await grace.page.addInitScript(({ key, providerId }) => {
      localStorage.setItem(key, JSON.stringify({ providerId, effort: 'Low', ultracode: true, fast: true }))
    }, { key: LEGACY_MODEL_PREF_KEY, providerId: adaProvider.id })
    await grace.page.route('**/api/v1/providers', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const providers = await response.json() as ModelProvider[]
      await route.fulfill({
        response,
        json: providers.map((provider) => provider.id === graceProvider.id
          ? provider
          : provider.kind === 'session'
            ? { ...provider, online: false }
            : { ...provider, execution: 'unconfigured' }),
      })
    })
    await grace.page.goto('/')
    expect((await readPreference(grace.page)).preferences.providerId).toBeUndefined()
    const graceModel = grace.page.getByRole('button', { name: 'Model and effort' })
    await expect(graceModel).not.toContainText(adaLabel)
    await expect(graceModel).not.toContainText(graceLabel)
    await expect(grace.page.getByPlaceholder('Connect a model provider to begin…')).toBeDisabled()
    expect(graceProvider.isDefault).toBe(true)
  } finally {
    await Promise.allSettled([ada.context.close(), grace.context.close()])
  }
})

test('pre-commit failure holds every model control and Retry preserves one exact intent', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'held'))
  const label = `Held model ${stamp}`
  await createEndpointProvider(page, label)
  const baseline = await readPreference(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const requests: Array<{ key: string; body: Record<string, unknown> }> = []
  let attempt = 0
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempt += 1
    requests.push({
      key: route.request().headers()['idempotency-key'] ?? '',
      body: route.request().postDataJSON() as Record<string, unknown>,
    })
    if (attempt === 1) {
      await gate
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Preference service unavailable.' } }) })
      return
    }
    await route.continue()
  })

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const { trigger } = await defaultModelSurface(page)
    await trigger.click()
    const customizeDialog = page.getByRole('dialog', { name: 'Default model and effort' })
    await expectPopoverContained(page, customizeDialog, `${viewport.width}x${viewport.height} Customize model picker`)
    await expect(customizeDialog.getByRole('button').filter({ hasText: label })).toBeEnabled()
    await expect(customizeDialog.getByRole('button', { name: 'Low', exact: true })).toBeEnabled()
    await capturePreferenceSurface(page, 'customize-picker')
    await page.keyboard.press('Escape')
    await expect(customizeDialog).toHaveCount(0)
  }

  await page.setViewportSize(VIEWPORTS.at(-1)!)
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await page.getByRole('button', { name: 'Model and effort' }).click()
  const dialog = page.getByRole('dialog', { name: 'Model and effort' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Low', exact: true }).click()
  const pending = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="pending"]')
  try {
    await expect(pending).toContainText('Saving model preference…')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectPopoverContained(page, dialog, `${viewport.width}x${viewport.height} held composer picker`)
      await expect(dialog.getByRole('button').filter({ hasText: label })).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'Low', exact: true })).toBeDisabled()
      await expect(dialog.getByRole('button').filter({ hasText: /^Ultracode/ })).toBeDisabled()
      await expect(dialog.getByRole('button').filter({ hasText: /^Fast output/ })).toBeDisabled()
      await capturePreferenceSurface(page, 'composer-held')
    }
    expect((await readPreference(page)).revision).toBe(baseline.revision)
  } finally {
    release()
  }

  const failed = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="failed"]')
  await expect(failed).toContainText('Couldn’t save your model preference')
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectPopoverContained(page, dialog, `${viewport.width}x${viewport.height} failed composer picker`)
    await expect(dialog.getByRole('button').filter({ hasText: label })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Low', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button').filter({ hasText: /^Ultracode/ })).toBeDisabled()
    await expect(dialog.getByRole('button').filter({ hasText: /^Fast output/ })).toBeDisabled()
    await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await capturePreferenceSurface(page, 'composer-error')
  }

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect.poll(async () => (await readPreference(page)).preferences.effort).toBe('Low')
  // Retry lives outside the popover, so the ordinary dismiss boundary closes
  // it. Reopen the now-settled control before capturing the recovered state.
  await page.getByRole('button', { name: 'Model and effort' }).click()
  await expect(dialog).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectPopoverContained(page, dialog, `${viewport.width}x${viewport.height} recovered composer picker`)
    await expect(dialog.getByRole('button').filter({ hasText: label })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Low', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('button').filter({ hasText: /^Ultracode/ })).toBeEnabled()
    await capturePreferenceSurface(page, 'composer-recovered')
  }
  expect(requests).toHaveLength(2)
  expect(requests[0]!.key).not.toBe('')
  expect(requests[1]!.key).toBe(requests[0]!.key)
  expect(requests[1]!.body).toEqual(requests[0]!.body)
})

test('a preference choice writes directly without a second runtime chunk request', async ({ page }) => {
  const stamp = Date.now().toString(36)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'eager-write'))
  let runtimeRequests = 0
  let writes = 0
  await page.route('**/src/controller/modelPreferenceMutationRuntime.ts*', async (route) => {
    runtimeRequests += 1
    await route.continue()
  })
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() === 'PATCH') writes += 1
    await route.continue()
  })

  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Model and effort' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Model and effort' })
  await dialog.getByRole('button', { name: 'Low', exact: true }).click()
  await expect.poll(async () => (await readPreference(page)).preferences.effort).toBe('Low')
  await expect(trigger).toContainText('Low')
  expect(runtimeRequests).toBe(0)
  expect(writes).toBe(1)
})

test('the deferred model menu stays contained while its catalog chunk loads', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'menu-loading'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/components/ModelPickerMenuBody.tsx*', async (route) => {
    await gate
    await route.continue()
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Model and effort' }).click()
  const dialog = page.getByRole('dialog', { name: 'Model and effort' })
  const loading = dialog.getByRole('status').and(dialog.locator('[data-model-picker-loading]'))
  try {
    await expect(loading).toHaveText('Loading model choices…')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectPopoverContained(page, dialog, `${viewport.width}x${viewport.height} loading model menu`)
      await expect(loading).toBeVisible()
      await capturePreferenceSurface(page, 'menu-loading')
    }
  } finally {
    release()
  }
  await expect(dialog.getByRole('button', { name: 'Low', exact: true })).toBeVisible()
})

test('a failed deferred model menu preserves selection and Reload fetches a fresh chunk', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'menu-reload'))
  let chunkRequests = 0
  await page.route('**/src/components/ModelPickerMenuBody.tsx*', async (route) => {
    chunkRequests += 1
    if (chunkRequests === 1) {
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Model and effort' })
  await expect(trigger).not.toHaveText('Model')
  const originalSelection = await trigger.innerText()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Model and effort' })
  const failure = dialog.getByRole('alert').and(dialog.locator('[data-model-picker-load-error]'))
  await expect(failure).toContainText('Couldn’t load model choices. Your selection hasn’t changed.')
  await expect(failure).toContainText('Copy any unsent text before reloading.')
  await expect(trigger).toHaveText(originalSelection)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectPopoverContained(page, dialog, `${viewport.width}x${viewport.height} failed model menu`)
    await expect(failure.getByRole('button', { name: 'Reload model choices', exact: true })).toBeVisible()
    await capturePreferenceSurface(page, 'menu-error')
  }

  await page.setViewportSize(VIEWPORTS.at(-1)!)
  await failure.getByRole('button', { name: 'Reload model choices', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  const reloadedTrigger = page.getByRole('button', { name: 'Model and effort' })
  await expect(reloadedTrigger).toHaveText(originalSelection)
  await reloadedTrigger.click()
  const reloadedDialog = page.getByRole('dialog', { name: 'Model and effort' })
  await expect(reloadedDialog.getByRole('button', { name: 'Low', exact: true })).toBeVisible()
  await expectPopoverContained(page, reloadedDialog, '1280x800 reloaded model menu')
  await capturePreferenceSurface(page, 'menu-reloaded')
  expect(chunkRequests).toBe(2)
})

test('lost acknowledgement reconciles without replay and stale Retry preserves an untouched remote mode', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'recovery'))
  const first = await createEndpointProvider(page, `Lost preference ${stamp}`)
  const secondLabel = `Rebased preference ${stamp}`
  const second = await createEndpointProvider(page, secondLabel)
  let patchCount = 0
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patchCount += 1
    const committed = await route.fetch()
    expect(committed.ok()).toBeTruthy()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }) })
  })
  await pickProvider(page, first.label)
  await expect.poll(async () => (await readPreference(page)).preferences.providerId).toBe(first.id)
  await expect(page.locator('[data-revisioned-mutation="model-preferences"]')).toHaveCount(0)
  expect(patchCount).toBe(1)
  await page.unrouteAll({ behavior: 'wait' })

  const beforeConflict = await readPreference(page)
  const bodies: Array<{ expectedRevision: number; preferences: Record<string, unknown> }> = []
  let conflictAttempts = 0
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    conflictAttempts += 1
    bodies.push(route.request().postDataJSON() as typeof bodies[number])
    if (conflictAttempts === 1) {
      const remote = await page.request.patch(`${API}/viewer-preferences/model`, {
        data: {
          expectedUserId: beforeConflict.userId,
          expectedTenantId: beforeConflict.tenantId,
          expectedRevision: beforeConflict.revision,
          preferences: { ...beforeConflict.preferences, ultracode: true },
        },
        headers: { 'Idempotency-Key': `remote-model-preference-${stamp}` },
      })
      expect(remote.ok(), await remote.text()).toBeTruthy()
    }
    await route.continue()
  })

  await pickProvider(page, secondLabel)
  const failed = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  const settled = await readPreference(page)
  expect(settled.preferences.providerId).toBe(second.id)
  expect(settled.preferences.ultracode).toBe(true)
  expect(bodies).toHaveLength(2)
  expect(bodies[0]!.expectedRevision).toBe(beforeConflict.revision)
  expect(bodies[1]!.expectedRevision).toBe(beforeConflict.revision + 1)
  expect(bodies[1]!.preferences.ultracode).toBe(true)
})

test('an obsolete account preference read cannot hold the newly selected account bootstrap', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')

  for (const credentials of [
    { email: 'ada@acme.example', password: 'ada-demo-password' },
    { email: 'grace@acme.example', password: 'grace-demo-password' },
  ]) {
    const response = await page.request.post(`${API}/auth/login`, { data: credentials })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')

  let releaseObsolete!: () => void
  const obsoleteGate = new Promise<void>((resolve) => { releaseObsolete = resolve })
  let readsAfterSwitch = 0
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    readsAfterSwitch += 1
    if (readsAfterSwitch === 1) await obsoleteGate
    await route.continue()
  })

  try {
    await page.getByTestId('account-chip').click()
    await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
    await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
    await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    expect(readsAfterSwitch).toBeGreaterThanOrEqual(2)
  } finally {
    releaseObsolete()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('a failed initial preference read offers Retry and then opens one fresh draft', async ({ page }) => {
  const stamp = Date.now().toString(36)
  await page.context().setExtraHTTPHeaders(testIdentity(stamp, 'bootstrap-retry'))
  let reads = 0
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    reads += 1
    if (reads === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Preference read unavailable.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  const bootstrap = page.getByTestId('app-bootstrap')
  await expect(bootstrap).toHaveAttribute('data-bootstrap-state', 'error')
  await expect(bootstrap.getByRole('heading', { name: 'Couldn’t open Agent Commons' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toHaveCount(0)
  await bootstrap.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await expect(bootstrap).toHaveCount(0)
  expect(reads).toBe(2)
})

test('a valid preference for another user requires a full account Reload', async ({ page }) => {
  const stamp = Date.now().toString(36)
  const identity = testIdentity(stamp, 'scope-mismatch')
  await page.context().setExtraHTTPHeaders(identity)
  let reads = 0
  await page.route('**/api/v1/viewer-preferences/model', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    reads += 1
    const response = await route.fetch()
    if (reads === 1) {
      const record = await response.json() as ViewerModelPreferences
      await route.fulfill({ response, json: { ...record, userId: `${identity['x-user-id']}-other` } })
      return
    }
    await route.fulfill({ response })
  })

  await page.goto('/')
  const bootstrap = page.getByTestId('app-bootstrap')
  await expect(bootstrap).toHaveAttribute('data-bootstrap-state', 'account-changed')
  await expect(bootstrap.getByRole('heading', { name: 'Your signed-in account changed' })).toBeVisible()
  await expect(bootstrap.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  await bootstrap.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
  await expect(bootstrap).toHaveCount(0)
  expect(reads).toBe(2)
})
