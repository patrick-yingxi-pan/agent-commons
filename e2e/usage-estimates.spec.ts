/** Context figures are partial estimates, never invented workspace inventory. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

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
      await page.goto(`/s/${state === 'known' ? known.id : session.id}`)
      const trigger = page.getByRole('button', { name: /^Usage — estimated context/ })
      await expect(trigger).toBeVisible()
      await trigger.click()
      const popover = page.getByRole('dialog', { name: 'Usage details' })
      await expect(popover).toBeVisible()
      await expect(popover.getByRole('button', { name: /^Context estimate/ })).toBeVisible()
      await expect(popover.getByText(/About 4 characters per token/)).toBeVisible()
      await expect(popover.getByText(/Excludes attachments, runtime tools/)).toBeVisible()
      await expect(popover.getByText(/per-turn prompt additions and provider-managed context/)).toBeVisible()
      await expect(popover.getByText('Local usage limits', { exact: true })).toBeVisible()
      await expect(popover.getByRole('button', { name: 'Plan usage' })).toHaveCount(0)
      await expect(popover.getByText(/^(Skills|Memory files|Custom agents|MCP tools)$/)).toHaveCount(0)
      await expect(popover.getByText('Messages', { exact: true })).toHaveCount(1)
      if (state === 'unknown') {
        await expect(trigger).toHaveAccessibleName(/window unknown/)
        await expect(popover.getByText('Free space', { exact: true })).toHaveCount(0)
        await expect(popover.getByText(/doesn’t expose its context window/)).toBeVisible()
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
      await page.keyboard.press('Escape')
      await expect(popover).toHaveCount(0)
    }
  }
})
