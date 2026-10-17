/** Rendering fixtures prove the usage surface; provider traffic stays loopback.
 * Observation ingestion and provider balance transport have server-owned locks. */
import { test, expect, type Page, type Locator } from '@playwright/test'
import type { ProviderUsageSnapshot } from '../contract/providerUsage.ts'
import { startProviderRoutinePeer, type ProviderRoutinePreset } from './provider-routine-peer.ts'
import { settledNarrowRail } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function ownConnection(page: Page, preset: ProviderRoutinePreset) {
  const signedIn = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(signedIn.ok(), await signedIn.text()).toBe(true)
  const peer = await startProviderRoutinePeer(preset, crypto.randomUUID().slice(0, 8))
  try {
    const created = await page.request.post('/api/v1/providers', { data: {
      label: `${preset} usage rendering fixture ${crypto.randomUUID()}`,
      modelFamily: preset === 'anthropic' ? 'claude' : preset === 'openai' ? 'gpt' : 'deepseek',
      effortLevels: ['Default'], kind: 'endpoint',
      config: { baseURL: peer.baseURL, model: peer.modelId,
        protocol: preset === 'openai' ? 'openai-responses' : 'anthropic-messages' },
    } })
    expect(created.ok(), await created.text()).toBe(true)
    const provider = await created.json() as { id: string }
    const sessionCreated = await page.request.post('/api/v1/sessions', { data: {
      firstMessage: `${preset} provider usage fixture`, persistFirstMessage: true,
      providerId: provider.id, modelId: peer.modelId,
    } })
    expect(sessionCreated.ok(), await sessionCreated.text()).toBe(true)
    const session = await sessionCreated.json() as { id: string }
    return { peer, providerId: provider.id, sessionId: session.id,
      path: `/api/v1/providers/${encodeURIComponent(provider.id)}/usage`,
      snapshot: { providerId: provider.id, modelId: peer.modelId, provider: preset,
        availability: 'available', rateLimits: [], balance: { status: preset === 'deepseek' ? 'not-requested' : 'unsupported' },
      } as ProviderUsageSnapshot }
  } catch (error) {
    await peer.close()
    throw error
  }
}

async function openUsage(page: Page, sessionId: string) {
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await page.getByRole('button', { name: /^Usage — estimated context/ }).click()
  return page.getByRole('dialog', { name: 'Usage details', exact: true })
}

async function contained(page: Page, dialog: Locator) {
  if (page.viewportSize()!.width < 640) await settledNarrowRail(page)
  await expect.poll(async () => dialog.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.hasAttribute('data-popover') && box.left >= 7 && box.top >= 7
      && box.right <= window.innerWidth - 7 && box.bottom <= window.innerHeight - 7
      && element.scrollWidth <= element.clientWidth
  })).toBe(true)
}

test('DeepSeek balance is explicit, preserves provider decimals, and yields to context breakdown at every tier', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const fixture = await ownConnection(page, 'deepseek')
  let balanceReads = 0
  let turns = 0
  let snapshot = fixture.snapshot
  page.on('request', request => {
    if (request.method() === 'POST' && /\/sessions\/[^/]+\/messages(?:\?|$)/u.test(request.url())) turns += 1
  })
  await page.route(`**${fixture.path}?*`, async route => {
    expect(new URL(route.request().url()).searchParams.get('model')).toBe(fixture.peer.modelId)
    await route.fulfill({ json: snapshot })
  })
  await page.route(`**${fixture.path}/balance?*`, async route => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('model')).toBe(fixture.peer.modelId)
    balanceReads += 1
    snapshot = { ...snapshot, balance: balanceReads === 2
      ? { status: 'error', checkedAt: Date.now(), reason: 'authentication' }
      : { status: 'available', observedAt: Date.now(), isAvailable: balanceReads === 1,
        amounts: [{ currency: 'CNY', total: '12.340000000000000001', granted: '2.340000000000000001', toppedUp: '10.00' }] } }
    await route.fulfill({ json: snapshot })
  })
  try {
    const dialog = await openUsage(page, fixture.sessionId)
    const provider = dialog.getByRole('region', { name: 'Provider usage & quota', exact: true })
    await expect(provider).toHaveAttribute('data-provider-usage', 'available')
    await expect(provider).toContainText('No completed request observed for this model.')
    await expect(provider).toContainText('No rate-limit headers observed for this model.')
    await expect(provider).toContainText('Balance has not been checked.')
    expect(balanceReads).toBe(0)
    await provider.getByRole('button', { name: 'Check balance', exact: true }).click()
    await expect(provider).toContainText('CNY 12.340000000000000001')
    await expect(provider).toContainText('Granted 2.340000000000000001 · topped up 10.00')
    await expect(provider).toContainText('Billing history and subscription allowance are unavailable here.')
    await expect(dialog.getByText('Local usage limits', { exact: true })).toBeVisible()

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await contained(page, dialog)
      await provider.getByRole('button', { name: 'Refresh balance', exact: true }).scrollIntoViewIfNeeded()
      await expect(provider.getByRole('button', { name: 'Refresh balance', exact: true })).toBeInViewport()
      await page.screenshot({ path: `.data/provider-usage-review/deepseek-${viewport.width}x${viewport.height}.png` })
      const context = dialog.getByRole('button', { name: /^Context breakdown/ })
      await context.scrollIntoViewIfNeeded()
      await context.click()
      await expect(dialog).toHaveAttribute('data-usage-view', 'context')
      await expect(provider).toHaveCount(0)
      await expect(dialog.getByText('Local usage limits', { exact: true })).toHaveCount(0)
      await contained(page, dialog)
      await dialog.getByRole('button', { name: 'Back to usage', exact: true }).click()
      await expect(provider).toContainText('CNY 12.340000000000000001')
      expect(balanceReads, 'returning to usage cannot automatically recheck a balance').toBe(1)
    }
    await provider.getByRole('button', { name: 'Refresh balance', exact: true }).click()
    await expect(provider.getByRole('alert')).toContainText('check this connection’s API credentials in Models')
    await expect(provider).not.toContainText('12.340000000000000001')
    await provider.getByRole('button', { name: 'Refresh balance', exact: true }).click()
    await expect(provider).toContainText('The provider reports insufficient balance.')
    expect(balanceReads).toBe(3)
    expect(turns).toBe(0)
    expect(fixture.peer.generationRequests()).toHaveLength(0)
  } finally {
    await fixture.peer.close()
  }
})

test('provider reads announce loading and failure, retry only observations, and mark expired rate headers', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await ownConnection(page, 'openai')
  let reads = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const observedAt = Date.now() - 120_000
  const snapshot: ProviderUsageSnapshot = { ...fixture.snapshot,
    lastRequest: { inputTokens: 1234, outputTokens: 56, observedAt },
    rateLimits: [{ key: 'requests', remaining: 17, limit: 20, observedAt, resetAt: Date.now() - 60_000 },
      { key: 'tokens', remaining: 4567, limit: 10000, observedAt, resetAt: Date.now() + 3_600_000 }],
  }
  await page.route(`**${fixture.path}?*`, async route => {
    expect(new URL(route.request().url()).searchParams.get('model')).toBe(fixture.peer.modelId)
    reads += 1
    if (reads === 1) {
      await gate
      await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Fixture unavailable' } } })
    } else await route.fulfill({ json: snapshot })
  })
  try {
    const dialog = await openUsage(page, fixture.sessionId)
    const provider = dialog.getByRole('region', { name: 'Provider usage & quota', exact: true })
    const draft = page.getByRole('textbox', { name: 'Message', exact: true })
    await page.keyboard.press('Escape')
    await draft.fill('Keep this unsent provider usage draft')
    await page.getByRole('button', { name: /^Usage — estimated context/ }).click()
    await expect(provider).toHaveAttribute('data-provider-usage', 'loading')
    await expect(provider.getByRole('status')).toHaveText('Loading provider usage…')
    await expect(provider).not.toContainText('1,234')
    release()
    await expect(provider).toHaveAttribute('data-provider-usage', 'error')
    await expect(provider.getByRole('alert')).toHaveText('Couldn’t load provider usage.')
    await provider.getByRole('button', { name: 'Retry provider usage', exact: true }).click()
    await expect(provider).toHaveAttribute('data-provider-usage', 'available')
    await expect(provider).toContainText('1,234 input · 56 output tokens')
    await expect(provider).toContainText('not an account total')
    await expect(provider.getByText('Last observed rates', { exact: true })).toBeVisible()
    await expect(provider.locator('[data-provider-rate="requests"]')).toContainText('17 / 20 remaining observed')
    await expect(provider.locator('[data-provider-rate="requests"]')).toContainText('Expired observation')
    await expect(provider.locator('[data-provider-rate="tokens"]')).toContainText('4,567 / 10,000 remaining observed')
    await expect(provider.getByRole('button', { name: /balance/i })).toHaveCount(0)
    await expect(draft).toHaveValue('Keep this unsent provider usage draft')
    expect(reads).toBe(2)
    expect(fixture.peer.generationRequests()).toHaveLength(0)
  } finally {
    release()
    await fixture.peer.close()
  }
})

test('Claude observations and unavailable provider states stay distinct from account limits', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const fixture = await ownConnection(page, 'anthropic')
  let snapshot: ProviderUsageSnapshot = { ...fixture.snapshot,
    lastRequest: { inputTokens: 77, outputTokens: 9, observedAt: Date.now() },
    rateLimits: [{ key: 'input-tokens', remaining: 234, limit: 500, observedAt: Date.now() },
      { key: 'output-tokens', remaining: 12, limit: 100, observedAt: Date.now() }],
  }
  await page.route(`**${fixture.path}?*`, route => route.fulfill({ json: snapshot }))
  try {
    let dialog = await openUsage(page, fixture.sessionId)
    let provider = dialog.getByRole('region', { name: 'Provider usage & quota', exact: true })
    await expect(provider).toContainText('77 input · 9 output tokens')
    await expect(provider.locator('[data-provider-rate="input-tokens"]')).toContainText('234 / 500 remaining observed')
    await expect(provider.locator('[data-provider-rate="output-tokens"]')).toContainText('12 / 100 remaining observed')
    await expect(dialog.getByText('Local usage limits', { exact: true })).toBeVisible()
    for (const availability of ['shared', 'unconfigured', 'unsupported'] as const) {
      snapshot = { ...fixture.snapshot, availability }
      dialog = await openUsage(page, fixture.sessionId)
      provider = dialog.getByRole('region', { name: 'Provider usage & quota', exact: true })
      await expect(provider).toHaveAttribute('data-provider-usage', availability)
      await expect(provider.getByText('Last observed rates', { exact: true })).toHaveCount(0)
      await expect(provider.getByRole('button', { name: /balance/i })).toHaveCount(0)
      if (availability === 'shared') await expect(provider).toContainText('private to the connection owner')
      if (availability === 'unconfigured') await expect(provider).toContainText('Configure this connection in Models')
      if (availability === 'unsupported') await expect(provider).toContainText('readings are unavailable for this connection')
    }
    expect(fixture.peer.generationRequests()).toHaveLength(0)
  } finally {
    await fixture.peer.close()
  }
})
