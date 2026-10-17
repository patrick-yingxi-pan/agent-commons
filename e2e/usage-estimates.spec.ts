/** Context figures are partial estimates, never invented workspace inventory. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa, settledNarrowRail } from './accessibility-helpers.ts'
import { formatTokens, type UsageSnapshot } from '../contract/usage.ts'
import { API, newUser } from './social-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function signInSeed(page: Page, email: string, password: string, accountName: string) {
  const response = await page.request.post(`${API}/auth/login`, { data: { email, password } })
  expect(response.ok(), await response.text()).toBeTruthy()
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText(accountName)
}

async function expectUsageDialogContained(page: Page, viewport: { width: number; height: number }, label: string) {
  if (viewport.width < 640) await settledNarrowRail(page)
  const dialog = page.getByRole('dialog', { name: 'Usage details', exact: true })
  await expect.poll(async () => {
    const box = await dialog.boundingBox()
    return !!box && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7
      && await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)
  }, { message: `${label}: usage details remain inside the viewport` }).toBe(true)
}

test('usage explains partial estimates and unknown capacity at every layout tier', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const providerResponse = await page.request.post('/api/v1/providers', {
    data: { label: `Usage review ${Date.now()}`, modelFamily: 'claude', effortLevels: ['Default'], kind: 'session' },
  })
  expect(providerResponse.ok()).toBe(true)
  const provider = await providerResponse.json()
  expect(provider.id).toBeTruthy()
  const sessionResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: 'Usage estimate review', providerId: provider.id },
  })
  expect(sessionResponse.ok()).toBe(true)
  const session = await sessionResponse.json()
  expect(session.id).toBeTruthy()
  const knownResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: 'Known context estimate review', persistFirstMessage: true, providerId: 'provider-anthropic' },
  })
  expect(knownResponse.ok()).toBe(true)
  const known = await knownResponse.json()
  expect(known.id).toBeTruthy()

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    for (const state of ['known', 'unknown'] as const) {
      // Address each owned row explicitly; '/' may restore the previous pane.
      const usageResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/v1/usage' && url.searchParams.has('session')
      })
      await page.goto(`/s/${state === 'known' ? known.id : session.id}`)
      const snapshot = await (await usageResponsePromise).json()
      const trigger = page.getByRole('button', { name: /^Usage — estimated context/ })
      await expect(trigger).toBeVisible()
      const title = await trigger.getAttribute('title')
      expect(title).toMatch(/^Usage — estimated context/)
      expect(title).not.toMatch(/5-hour|weekly/i)
      if (state === 'known') expect(title).toMatch(/(?:<0\.1%|\d+(?:\.\d)?%)/)
      else expect(title).toMatch(/window unknown/i)
      await trigger.click()
      const popover = page.getByRole('dialog', { name: 'Usage details' })
      await expect(popover).toBeVisible()
      await expect(popover).toHaveAttribute('data-usage-view', 'summary')
      const context = popover.getByRole('button', { name: /^Context breakdown/ })
      await expect(context).toBeVisible()
      await expect(context).toHaveAttribute('aria-expanded', 'false')
      await expect(popover.getByText('Local usage limits', { exact: true })).toBeVisible()
      await expect(popover.getByText('Across all models in this account', { exact: true })).toBeVisible()
      await expect(popover.getByText(/Sonnet only/i)).toHaveCount(0)
      await expect(popover.getByRole('region', { name: 'Provider usage & quota' })).toBeVisible()
      await expect(popover.getByText('Billing history and subscription allowance are unavailable here.', { exact: true })).toBeVisible()
      for (const limit of snapshot.limits as Array<{ label: string; usedTokens: number; limitTokens: number }>) {
        await expect(popover.getByText(limit.label, { exact: true })).toBeVisible()
        await expect(popover).toContainText(`${formatTokens(limit.usedTokens)} / ${formatTokens(limit.limitTokens)}`)
      }
      await expectUsageDialogContained(page, viewport, `${state} usage summary`)
      await page.screenshot({ path: `.data/usage-review/${viewport.width}x${viewport.height}-${state}-summary.png` })
      await context.focus()
      await page.keyboard.press('Enter')
      await expect(popover).toHaveAttribute('data-usage-view', 'context')
      const back = popover.getByRole('button', { name: 'Back to usage', exact: true })
      await expect(back).toHaveAttribute('aria-expanded', 'true')
      await expect(back).toBeFocused()
      await expect(popover.getByRole('heading', { name: 'Context breakdown', exact: true })).toBeVisible()
      await expect(popover.getByText('Local usage limits', { exact: true })).toHaveCount(0)
      await expect(popover.getByRole('region', { name: 'Provider usage & quota' })).toHaveCount(0)
      for (const limit of snapshot.limits as Array<{ label: string }>) {
        await expect(popover.getByText(limit.label, { exact: true })).toHaveCount(0)
      }
      await expect(popover.getByText(/About 4 characters per token/)).toBeVisible()
      await expect(popover.getByText(/Excludes attachments, runtime tools/)).toBeVisible()
      await expect(popover.getByText(/per-turn prompt additions and provider-managed context/)).toBeVisible()
      await expect(popover.getByRole('button', { name: 'Plan usage' })).toHaveCount(0)
      await expect(popover.getByText(/^(Skills|Memory files|Custom agents|MCP tools)$/)).toHaveCount(0)
      await expect(popover.getByText('Messages', { exact: true })).toHaveCount(1)
      await expect(popover).toContainText(state === 'known' ? 'Anthropic' : provider.label)
      if (state === 'unknown') {
        await expect(trigger).toHaveAccessibleName(/window unknown/)
        await expect(popover.getByText('Free space', { exact: true })).toHaveCount(0)
        await expect(popover.getByText('No context-window value is available for this model. Fill percentages are unavailable.', { exact: true })).toBeVisible()
      } else {
        await expect(trigger).not.toHaveAccessibleName(/window unknown/)
        await expect(popover.getByText('Free space', { exact: true })).toHaveCount(1)
      }
      await expect.poll(async () => {
        const box = await popover.boundingBox()
        return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7
      }).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(page, `${viewport.width}×${viewport.height} ${state} usage`)
      await page.screenshot({ path: `.data/usage-review/${viewport.width}x${viewport.height}-${state}.png` })
      await page.keyboard.press('Enter')
      await expect(popover).toHaveAttribute('data-usage-view', 'summary')
      await expect(context).toBeFocused()
      await expect(popover.getByText('Messages', { exact: true })).toHaveCount(0)
      await expect(popover.getByText('Local usage limits', { exact: true })).toBeVisible()
      await expectUsageDialogContained(page, viewport, `${state} returned usage summary`)
      if (viewport.height === 390) {
        const lastWindow = popover.getByText('Weekly · all models', { exact: true })
        await lastWindow.scrollIntoViewIfNeeded()
        await expect.poll(async () => {
          const panel = await popover.boundingBox(), row = await lastWindow.boundingBox()
          return !!panel && !!row && row.y >= panel.y && row.y + row.height <= panel.y + panel.height
        }).toBe(true)
        await page.screenshot({ path: `.data/usage-review/${viewport.width}x${viewport.height}-${state}-scrolled.png` })
      }
      await page.keyboard.press('Escape')
      await expect(popover).toHaveCount(0)
      // Closing from the nested view must also reset the next inspection.
      await trigger.click()
      await popover.getByRole('button', { name: /^Context breakdown/ }).click()
      await expect(back).toBeVisible()
      await page.keyboard.press('Escape')
      await trigger.click()
      await expect(popover).toHaveAttribute('data-usage-view', 'summary')
      await expect(popover.getByRole('button', { name: 'Back to usage', exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape')
    }
  }
})

test('usage context follows shared conversation visibility while local limits stay viewer-relative', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser)
  const foreign = await newUser(browser)
  const privateText = `Viewer-relative usage context ${crypto.randomUUID()}`
  try {
    await signInSeed(owner.page, 'ada@acme.example', 'ada-demo-password', 'Ada Lovelace')
    await signInSeed(reader.page, 'grace@acme.example', 'grace-demo-password', 'Grace Hopper')
    await signInSeed(foreign.page, 'maya@growthworks.example', 'maya-demo-password', 'Maya Chen')

    const created = await owner.page.request.post(`${API}/sessions`, {
      data: { firstMessage: privateText, persistFirstMessage: true, providerId: 'provider-anthropic' },
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const session = await created.json() as { id: string }
    expect(session.id).toBeTruthy()
    const grant = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBeTruthy()

    const usageUrl = `${API}/usage?session=${encodeURIComponent(session.id)}`
    const [ownerUsageResponse, readerUsageResponse] = await Promise.all([
      owner.page.request.get(usageUrl),
      reader.page.request.get(usageUrl),
    ])
    expect(ownerUsageResponse.status()).toBe(200)
    expect(readerUsageResponse.status()).toBe(200)
    const ownerUsage = await ownerUsageResponse.json() as UsageSnapshot
    const readerUsage = await readerUsageResponse.json() as UsageSnapshot
    expect(readerUsage.context.used).toBe(ownerUsage.context.used)
    expect(readerUsage.model).toEqual(ownerUsage.model)
    expect(ownerUsage.limits.some((limit) => limit.usedTokens !== readerUsage.limits.find((row) => row.key === limit.key)?.usedTokens),
      'the seeded owner meter and Grace’s tenant meter are distinct').toBe(true)

    await owner.page.goto(`/s/${encodeURIComponent(session.id)}`)
    await reader.page.goto(`/s/${encodeURIComponent(session.id)}`)
    await expect(owner.page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    const readerComposer = reader.page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(readerComposer).toBeDisabled()
    await expect(readerComposer).toHaveAttribute('placeholder', 'Only the conversation owner can send messages.')

    for (const viewport of VIEWPORTS) {
      for (const [label, page, expectedUsage] of [
        ['owner', owner.page, ownerUsage],
        ['reader', reader.page, readerUsage],
      ] as const) {
        await page.setViewportSize(viewport)
        const trigger = page.getByRole('button', { name: /^Usage — estimated context/ })
        await expect(trigger).toBeVisible()
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: 'Usage details', exact: true })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('button', { name: /^Context breakdown/ })).toBeVisible()
        await expect(dialog).toContainText('Anthropic')
        await expect(dialog.getByText('Local usage limits', { exact: true })).toBeVisible()
        await expect(dialog.getByText('Across all models in this account', { exact: true })).toBeVisible()
        for (const limit of expectedUsage.limits) {
          await expect(dialog.getByText(limit.label, { exact: true })).toBeVisible()
          await expect(dialog).toContainText(`${formatTokens(limit.usedTokens)} / ${formatTokens(limit.limitTokens)}`)
        }
        await expectUsageDialogContained(page, viewport, `${label} ${viewport.width}x${viewport.height}`)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
      }
    }

    const foreignUsage = await foreign.page.request.get(usageUrl)
    expect(foreignUsage.status()).toBe(404)
    const foreignSessionRead = foreign.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === `${API}/sessions/${encodeURIComponent(session.id)}`
        && response.request().method() === 'GET'
    })
    await foreign.page.goto(`/s/${encodeURIComponent(session.id)}`)
    expect((await foreignSessionRead).status()).toBe(404)
    await expect(foreign.page.locator('[data-conversation-pane="draft"]')
      .getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
    await expect(foreign.page.locator('body')).not.toContainText(privateText)
    await expect(foreign.page.locator('[data-turn]')).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
