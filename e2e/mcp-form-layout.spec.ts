import { test, expect } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpFixture, startMcpRouterStack } from './mcp-fixture'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function expectDialogContained(page: import('@playwright/test').Page, dialog: import('@playwright/test').Locator, label: string) {
  await expect(dialog).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const box = await dialog.locator(':scope > div.relative').boundingBox()
  expect(box, `${label} dialog has a rendered box`).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(7)
  expect(box!.y).toBeGreaterThanOrEqual(7)
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) - 7)
  expect(box!.y + box!.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) - 7)
  await assertWcag22Aa(page, label)
}

test('MCP create, inspect, and remove dialogs remain usable across the viewport ladder', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const fixture = await startMcpFixture({ description: 'Form-layout catalog fixture.' })
  const stack = await startMcpRouterStack()
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const label = `MCP form ${viewport.width}x${viewport.height}`
      await page.goto('/contexts')
      await page.getByRole('button', { name: 'Add context', exact: true }).click()
      await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
      const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
      await expectDialogContained(page, create, `${label} create`)
      await page.screenshot({ path: `.data/mcp-review/${viewport.width}x${viewport.height}-create.png` })
      await create.getByLabel('Name').fill(`Form fixture ${viewport.width}`)
      await create.getByLabel('Server URL').fill(fixture.url)
      await create.getByRole('button', { name: 'Save server', exact: true }).click()

      const row = page.getByRole('main').getByRole('button', { name: `Form fixture ${viewport.width}`, exact: true })
      await expect(row).toBeVisible({ timeout: ms(20_000) })
      await row.click()
      await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
      const inspect = page.getByRole('dialog', { name: 'Inspect MCP server', exact: true })
      await expectDialogContained(page, inspect, `${label} inspect`)
      await page.screenshot({ path: `.data/mcp-review/${viewport.width}x${viewport.height}-inspect.png` })
      await inspect.getByRole('button', { name: 'Cancel', exact: true }).click()

      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      const remove = page.getByRole('dialog', { name: new RegExp(`Remove Form fixture ${viewport.width}`) })
      await expectDialogContained(page, remove, `${label} remove`)
      await page.screenshot({ path: `.data/mcp-review/${viewport.width}x${viewport.height}-remove.png` })
      await remove.getByRole('button', { name: 'Remove server', exact: true }).click()
      await expect(page).toHaveURL(/\/contexts$/)
    }
  } finally { await disposeProxy(); await fixture.close(); await stack.close() }
})

test('MCP empty catalog is truthful and a failed inspection can be dismissed or retried successfully', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const empty = await startMcpFixture({ empty: true })
  const failureMode = { fail: true }
  const failed = await startMcpFixture(failureMode)
  const stack = await startMcpRouterStack()
  let releaseInspection: (() => void) | undefined
  const disposeProxy = await proxyMcpApi(page, stack)
  try {
    await page.goto('/contexts')
    const add = async (label: string, endpoint: string) => {
      await page.getByRole('button', { name: 'Add context', exact: true }).click()
      await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
      const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
      await create.getByLabel('Name').fill(label)
      await create.getByLabel('Server URL').fill(endpoint)
      await create.getByRole('button', { name: 'Save server', exact: true }).click()
      await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
    }
    await add('Empty fixture', empty.url)
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(page.getByText('The inspected server advertised no tools.', { exact: true })).toBeVisible({ timeout: ms(20_000) })
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('dialog', { name: /Remove Empty fixture/ }).getByRole('button', { name: 'Remove server', exact: true }).click()
    await expect(page).toHaveURL(/\/contexts$/)

    await add('Failure fixture', failed.url)
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="mcp-connection"]')
    await expect(notice).toBeVisible({ timeout: ms(20_000) })
    await expect(notice).toContainText('The MCP server could not provide a supported, valid tool catalog.')
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByText('Not inspected', { exact: true })).toBeVisible()
    const heldInspection = new Promise<void>(resolve => { releaseInspection = resolve })
    await page.route('**/api/v1/mcp-connections/*/inspect', async route => {
      await heldInspection
      await route.fallback()
    }, { times: 1 })
    await page.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await page.getByRole('dialog', { name: 'Inspect MCP server', exact: true }).getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    const retry = notice.getByRole('button', { name: 'Retry', exact: true })
    await expect(notice).toHaveAttribute('data-mutation-status', 'pending')
    await expect(retry).toHaveCount(0)
    releaseInspection!()
    // Visibility alone also matches pending work. Do not heal the peer until
    // this inspection actually fails, or it may succeed without offering Retry.
    await expect(notice).toHaveAttribute('data-mutation-status', 'failed')
    await expect(notice).toContainText('The MCP server could not provide a supported, valid tool catalog.')
    await expect(retry).toBeVisible()
    expect(failed.calls.filter(method => method === 'tools/list')).toHaveLength(0)
    failureMode.fail = false
    await retry.click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByText('Catalog inspected', { exact: true })).toBeVisible()
    expect(failed.calls.filter(method => method === 'tools/list')).toHaveLength(1)
  } finally { releaseInspection?.(); await disposeProxy(); await empty.close(); await failed.close(); await stack.close() }
})
