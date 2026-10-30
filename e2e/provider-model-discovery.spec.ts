/** Explicit, transient model listing in the shared New provider dialog.
 * HTTP and the desktop vault face are authored fixtures, not live-provider acceptance. */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { ModelInfo } from '../contract/providers.ts'
import { providerCreationId } from '../server/providerCreationIdentity.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa, settledOpaquePaint } from './accessibility-helpers.ts'

const DISCOVERY = '**/api/v1/providers/models/discover'
const FAILURE = 'Could not load models. Check the connection and try again, or enter a model manually.'
const MODELS: ModelInfo[] = [
  { id: 'fixture-model-first', label: 'First model returned by the fixture' },
  { id: 'fixture-model-explicit', label: `A deliberately long provider model label ${'with optional metadata '.repeat(12)}` },
]
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function openDialog(page: Page, preset = 'openai') {
  await page.getByRole('button', { name: 'New provider', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New provider' })
  await dialog.getByLabel('Provider preset').selectOption(preset)
  return dialog
}

function observePosts(page: Page) {
  const posts: Array<{ url: string; body: string }> = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/v1/')) {
      posts.push({ url: new URL(request.url()).pathname, body: request.postData() ?? '' })
    }
  })
  return posts
}

async function expectContained(page: Page, dialog: Locator,
  control = dialog.getByRole('combobox', { name: 'Available models', exact: true })) {
  const panel = dialog.locator('[data-bounded-dialog]')
  const footer = panel.locator(':scope > div').last()
  await expect.poll(async () => {
    const viewport = page.viewportSize()!
    const workspace = await page.locator('[data-popover-viewport]').boundingBox()
    const boxes = await Promise.all([panel.boundingBox(), footer.boundingBox()])
    return boxes.every(box => box !== null && box.x >= 7 && box.y >= (workspace?.y ?? 0) + 7
      && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7)
  }, 'provider dialog and footer settle inside the current workspace').toBe(true)
  await control.scrollIntoViewIfNeeded()
  await expect(control).toBeVisible()
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(7)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 7)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeVisible()
  await settledOpaquePaint(panel)
}

async function mockCreate(page: Page) {
  const me = await page.request.get('/api/v1/me')
  expect(me.ok()).toBe(true)
  const tenant = (await me.json()).tenant.id as string
  const submitted: Array<Record<string, any>> = []
  const ids: string[] = []
  await page.route('**/api/v1/providers', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON()
    const key = route.request().headers()['idempotency-key']
    expect(key).toBeTruthy()
    submitted.push(body)
    const id = await providerCreationId(tenant, key!)
    ids.push(id)
    await route.fulfill({ status: 201, json: {
      id, tenantId: tenant, label: body.label, modelFamily: body.modelFamily,
      effortLevels: [], kind: 'endpoint', protocol: body.config.protocol,
      execution: 'configured', connectionRevision: 1, definitionRevision: 1,
    } })
  })
  return { submitted, ids }
}

async function installVault(page: Page, reference: string | string[]) {
  await page.addInitScript(credentialReferences => {
    ;(window as any).__discoveryVaultCalls = []
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { credentials: {
        provision: async (secret: string) => {
          ;(window as any).__discoveryVaultCalls.push(['provision', secret])
          const provisions = (window as any).__discoveryVaultCalls.filter((call: string[]) => call[0] === 'provision').length
          return credentialReferences[provisions - 1] ?? credentialReferences[0]
        },
        bind: async (boundReference: string, providerId: string) => {
          ;(window as any).__discoveryVaultCalls.push(['bind', boundReference, providerId])
        },
        discard: async (discardedReference: string) => {
          ;(window as any).__discoveryVaultCalls.push(['discard', discardedReference])
        },
        removeProvider: async () => undefined,
      } },
    })
  }, Array.isArray(reference) ? reference : [reference])
}

test('model listing is explicit for all three presets, selects nothing and stays bounded with long options', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const requests: unknown[] = []
  await page.route(DISCOVERY, async route => {
    expect(route.request().method()).toBe('POST')
    requests.push(route.request().postDataJSON())
    await route.fulfill({ json: { models: MODELS } })
  })
  const posts = observePosts(page)
  await page.goto('/models')
  const presets = [
    { key: 'openai', protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1' },
    { key: 'anthropic', protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com' },
    { key: 'deepseek', protocol: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic' },
  ]
  for (const [index, preset] of presets.entries()) {
    const dialog = await openDialog(page, preset.key)
    await dialog.getByLabel('Name', { exact: true }).fill(`Discovery ${preset.key}`)
    await dialog.getByLabel('Model ID', { exact: true }).fill('')
    const load = dialog.getByRole('button', { name: 'Load models', exact: true })
    await expect(load).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    expect(requests).toHaveLength(index)
    await load.click()
    const choices = dialog.getByRole('combobox', { name: 'Available models', exact: true })
    await expect(choices).toBeVisible()
    await expect(choices.locator('option', { hasText: MODELS[0]!.label })).toHaveCount(1)
    await expect(choices.locator(`option[value="${MODELS[1]!.id}"]`)).toHaveCount(1)
    await expect(choices).toHaveValue('')
    await expect(dialog.getByLabel('Model ID', { exact: true })).toHaveValue('')
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    expect(requests[index]).toEqual({ protocol: preset.protocol, baseURL: preset.baseURL })
    expect(posts.map(post => post.url)).toEqual(Array(index + 1).fill('/api/v1/providers/models/discover'))
    await choices.selectOption(MODELS[1]!.id)
    await expect(dialog.getByLabel('Model ID', { exact: true })).toHaveValue(MODELS[1]!.id)
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
    if (index === 0) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await expectContained(page, dialog)
        if (viewport.width === 320 || viewport.width === 1280) await assertWcag22Aa(page, `loaded model discovery ${viewport.width}`)
        await page.screenshot({ path: join(process.cwd(), '.data', 'provider-onboarding-review', `discovered-models-${viewport.width}x${viewport.height}.png`), fullPage: false })
      }
    }
    expect(posts).toHaveLength(index + 1)
    await dialog.getByLabel('Endpoint URL').fill(`${preset.baseURL}/changed`)
    await expect(choices).toHaveCount(0)
    expect(requests).toHaveLength(index + 1)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
})

test('listing failure shows safe manual-entry guidance and Create remains a separate explicit action', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const upstreamDetail = 'upstream-secret-and-private-endpoint-diagnostic'
  await page.route(DISCOVERY, route => route.fulfill({ status: 502, json: { error: { code: 'provider_error', message: upstreamDetail } } }))
  const posts = observePosts(page)
  const created = await mockCreate(page)
  await page.goto('/models')
  const dialog = await openDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill('Manual after listing failure')
  await dialog.getByRole('button', { name: 'Load models', exact: true }).click()
  await expect(dialog.getByText(FAILURE, { exact: true })).toBeVisible()
  await expect(dialog).not.toContainText(upstreamDetail)
  await expect(dialog.getByRole('combobox', { name: 'Available models', exact: true })).toHaveCount(0)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectContained(page, dialog, dialog.getByRole('alert'))
    if (viewport.width === 320 || viewport.width === 1280) await assertWcag22Aa(page, `failed model discovery ${viewport.width}`)
    await page.screenshot({ path: join(process.cwd(), '.data', 'provider-onboarding-review', `discovery-failed-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await dialog.getByLabel('Model ID', { exact: true }).fill('manual-model-after-failure')
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
  expect(created.submitted).toHaveLength(0)
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover'])
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(created.submitted).toHaveLength(1)
  expect(created.submitted[0]!.config).toMatchObject({ protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1', model: 'manual-model-after-failure' })
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover', '/api/v1/providers'])
})

test('Cancel fences a pending model read from a newly opened provider draft', async ({ page }) => {
  test.setTimeout(ms(45_000))
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started = false
  let settled = false
  await page.route(DISCOVERY, async route => {
    started = true
    await held
    try { await route.fulfill({ json: { models: [{ id: 'stale-model', label: 'Stale canceled model' }] } }) }
    catch { /* Cancel may already have aborted this exact read. */ }
    finally { settled = true }
  })
  const posts = observePosts(page)
  await page.goto('/models')
  const first = await openDialog(page)
  await first.getByRole('button', { name: 'Load models', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await expect(first.getByLabel('Endpoint URL')).toBeDisabled()
  await expect(first.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectContained(page, first, first.getByRole('status'))
    await expect(first.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    await page.screenshot({ path: join(process.cwd(), '.data', 'provider-onboarding-review', `discovery-loading-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await first.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(first).toHaveCount(0)
  const next = await openDialog(page, 'anthropic')
  release()
  await expect.poll(() => settled).toBe(true)
  await expect(next.getByLabel('Endpoint URL')).toHaveValue('https://api.anthropic.com')
  await expect(next.getByLabel('Model ID', { exact: true })).toHaveValue('')
  await expect(next.getByRole('combobox', { name: 'Available models', exact: true })).toHaveCount(0)
  await expect(next).not.toContainText('Stale canceled model')
  await expect(next.getByRole('button', { name: 'Load models', exact: true })).toBeEnabled()
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover'])
})

test('desktop discovery hands the same provisional reference to Create without exposing the key over HTTP', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const reference = `PROVIDER_DESKTOP_${'D'.repeat(32)}`
  const secret = 'discovery-device-key-must-stay-out-of-http'
  await installVault(page, reference)
  const discovery: unknown[] = []
  await page.route(DISCOVERY, async route => {
    discovery.push(route.request().postDataJSON())
    await route.fulfill({ json: { models: MODELS } })
  })
  const posts = observePosts(page)
  const created = await mockCreate(page)
  await page.goto('/models')
  const dialog = await openDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill('Desktop discovered provider')
  const key = dialog.getByPlaceholder('Paste API key', { exact: true })
  await expect(key).toHaveAttribute('type', 'password')
  await key.fill(secret)
  await dialog.getByRole('button', { name: 'Load models', exact: true }).click()
  const choices = dialog.getByRole('combobox', { name: 'Available models', exact: true })
  await expect(choices).toBeVisible()
  await expect(choices).toHaveValue('')
  expect(discovery).toEqual([{ protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1', apiKeyEnv: reference }])
  await expect(key).toHaveValue('')
  expect(await page.evaluate(() => (window as any).__discoveryVaultCalls)).toEqual([['provision', secret]])
  expect(created.submitted).toHaveLength(0)
  await choices.selectOption(MODELS[1]!.id)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(created.submitted).toHaveLength(1)
  expect(created.submitted[0]!.config).toMatchObject({ model: MODELS[1]!.id, apiKeyEnv: reference })
  await expect.poll(() => page.evaluate(() => (window as any).__discoveryVaultCalls)).toEqual([
    ['provision', secret], ['bind', reference, created.ids[0]],
  ])
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover', '/api/v1/providers'])
  expect(JSON.stringify(posts)).not.toContain(secret)
})

test('Cancel discards a desktop discovery key and never binds or creates a provider', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const reference = `PROVIDER_DESKTOP_${'B'.repeat(32)}`
  const secret = 'discarded-device-discovery-key'
  await installVault(page, reference)
  await page.route(DISCOVERY, route => route.fulfill({ json: { models: MODELS } }))
  const posts = observePosts(page)
  await page.goto('/models')
  const dialog = await openDialog(page)
  await dialog.getByPlaceholder('Paste API key', { exact: true }).fill(secret)
  await dialog.getByRole('button', { name: 'Load models', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Available models', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__discoveryVaultCalls)).toEqual([
    ['provision', secret], ['discard', reference],
  ])
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover'])
  expect(JSON.stringify(posts)).not.toContain(secret)
})

test('desktop discovery requires a new key after a definitive Create rejection is dismissed', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const oldReference = `PROVIDER_DESKTOP_${'C'.repeat(32)}`
  const newReference = `PROVIDER_DESKTOP_${'E'.repeat(32)}`
  const oldSecret = 'rejected-discovery-device-key'
  const newSecret = 'corrected-provider-device-key'
  await installVault(page, [oldReference, newReference])
  await page.route(DISCOVERY, route => route.fulfill({ json: { models: MODELS } }))
  const created = await mockCreate(page)
  let rejected = false
  await page.route('**/api/v1/providers', async route => {
    if (route.request().method() !== 'POST' || rejected) return route.fallback()
    rejected = true
    await route.fulfill({ status: 400, json: { error: { code: 'invalid_request', message: 'This fixture model cannot be used. Correct the model ID.' } } })
  })
  const posts = observePosts(page)
  await page.goto('/models')
  const dialog = await openDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill('Corrected desktop discovered provider')
  const key = dialog.getByPlaceholder('Paste API key', { exact: true })
  await key.fill(oldSecret)
  await dialog.getByRole('button', { name: 'Load models', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Available models', exact: true }).selectOption(MODELS[1]!.id)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const failed = page.locator('[data-provider-creation="failed"]')
  await expect(failed).toContainText('This fixture model cannot be used')
  await expect(dialog.getByLabel('Model ID', { exact: true })).toBeDisabled()
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog.getByLabel('Model ID', { exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => (window as any).__discoveryVaultCalls)).toEqual([
    ['provision', oldSecret], ['discard', oldReference],
  ])
  await dialog.getByLabel('Model ID', { exact: true }).fill('corrected-manual-model')
  await expect(key).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  await expect(dialog.getByText(/Re-enter the API key/)).toBeVisible()
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover', '/api/v1/providers'])
  expect(JSON.parse(posts[1]!.body).config.apiKeyEnv).toBe(oldReference)
  expect(created.submitted).toHaveLength(0)
  await key.fill(newSecret)
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
  expect(posts).toHaveLength(2)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(created.submitted).toHaveLength(1)
  expect(created.submitted[0]!.config).toMatchObject({ model: 'corrected-manual-model', apiKeyEnv: newReference })
  await expect.poll(() => page.evaluate(() => (window as any).__discoveryVaultCalls)).toEqual([
    ['provision', oldSecret], ['discard', oldReference], ['provision', newSecret], ['bind', newReference, created.ids[0]],
  ])
  expect(posts.map(post => post.url)).toEqual(['/api/v1/providers/models/discover', '/api/v1/providers', '/api/v1/providers'])
  expect(JSON.stringify(posts)).not.toContain(oldSecret)
  expect(JSON.stringify(posts)).not.toContain(newSecret)
})
