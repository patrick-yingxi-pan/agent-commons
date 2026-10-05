import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { tierFor } from '../src/lib/viewport.ts'

const MODULE = '**/src/components/ContextBrowseDialog.tsx*'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function openBrowser(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Repository/ }).click()
  await picker.getByRole('button', { name: 'Browse repositories…', exact: true }).click()
  return picker
}

async function review(page: Page, testInfo: TestInfo, phase: 'loading' | 'load-error') {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(page.locator(`[data-context-browse-${phase}]`)).toBeVisible()
    await expect.poll(() => page.evaluate((narrow) => {
      const panel = document.querySelector('[data-popover]')?.getBoundingClientRect()
      const rail = document.querySelector('[aria-label="Collapse sidebar"]')?.closest('[inert]')
      return !!panel && panel.left >= 7 && panel.right <= innerWidth - 7
        && panel.top >= 7 && panel.bottom <= innerHeight - 7
        && document.documentElement.scrollWidth <= innerWidth
        && (!narrow || !!rail && rail.getBoundingClientRect().width === 0)
    }, tierFor(viewport.width) === 'narrow')).toBe(true)
    const notice = page.locator(`[data-context-browse-${phase}]`)
    await expect(notice.getByRole('button')).toHaveCount(phase === 'loading' ? 1 : 2)
    await expect.poll(() => notice.evaluate((element) => {
      const panel = element.closest('[data-popover]')!.getBoundingClientRect()
      return [element, ...element.querySelectorAll('button')].every((item) => {
        const box = item.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.top >= panel.top
          && box.bottom <= panel.bottom && box.left >= panel.left && box.right <= panel.right
      })
    }), 'the complete recovery notice and actions remain visible without scrolling').toBe(true)
    await assertWcag22Aa(page, `Context browser ${phase} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`context-browser-${phase}-${viewport.width}x${viewport.height}.png`) })
  }
}

test('context browser waits for explicit Browse and cancellation fences a late load', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let finished!: () => void
  const routeFinished = new Promise<void>((resolve) => { finished = resolve })
  let requests = 0
  await page.route(MODULE, async (route) => {
    requests++
    await held
    try { await route.continue() } finally { finished() }
  })
  try {
    await page.goto('/')
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('preserve this unsent context-browser draft')
    expect(requests, 'boot does not request the optional browser').toBe(0)
    const picker = await openBrowser(page)
    await expect(picker.getByRole('status')).toContainText('Loading context browser…')
    expect(requests).toBe(1)
    await review(page, testInfo, 'loading')
    await picker.getByRole('button', { name: 'Cancel browsing', exact: true }).click()
    await expect(page.locator('[data-context-browse-loading]')).toHaveCount(0)
    release()
    await routeFinished
    await expect(page.getByRole('dialog', { name: 'Open Repository — browse', exact: true })).toHaveCount(0)
    await expect(composer).toHaveValue('preserve this unsent context-browser draft')
    await picker.getByRole('button', { name: 'Browse repositories…', exact: true }).click()
    const browser = page.getByRole('dialog', { name: 'Open Repository — browse', exact: true })
    await expect(browser).toBeVisible()
    await expect(browser.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(browser).toHaveCount(0)
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(composer).toHaveValue('preserve this unsent context-browser draft')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('context browser failure is local and explicit reload recovers browsing', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  let blocked = true
  await page.route(MODULE, async (route) => blocked ? route.abort() : route.continue())
  await page.goto('/')
  const picker = await openBrowser(page)
  await expect(picker.getByRole('alert')).toContainText('Copy any unsent text before reloading.')
  await review(page, testInfo, 'load-error')
  await picker.getByRole('button', { name: 'Cancel browsing', exact: true }).click()
  await expect(page.locator('[data-context-browse-load-error]')).toHaveCount(0)
  await picker.getByRole('button', { name: 'Browse repositories…', exact: true }).click()
  await expect(picker.getByRole('alert')).toBeVisible()
  blocked = false
  await picker.getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  await openBrowser(page)
  const browser = page.getByRole('dialog', { name: 'Open Repository — browse', exact: true })
  await expect(browser).toBeVisible()
  await expect(browser.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await browser.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(browser).toHaveCount(0)
})
