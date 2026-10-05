import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers'

test('every filesystem picker keeps long source choices contained and clickable at every viewport', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sources = [
    { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
    { id: 'runner-a', kind: 'runner', label: 'Design workstation with a deliberately long identifying name' },
    { id: 'runner-b', kind: 'runner', label: 'Build server' },
  ]
  await page.route('**/api/v1/fs/sources', route => route.fulfill({ json: sources }))
  await page.route('**/api/v1/fs/catalog?*', route => {
    const source = sources.find(source => source.id === new URL(route.request().url()).searchParams.get('source'))
    expect(source).toBeTruthy()
    return route.fulfill({ json: { source, files: [], photos: [], folders: [] } })
  })
  await page.goto('/')
  for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    for (const type of ['Files', 'Photos', 'Folder']) {
      await page.getByRole('button', { name: 'Add context', exact: true }).click()
      const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
      await picker.getByRole('button', { name: new RegExp(`^${type}`) }).click()
      const group = picker.getByRole('button', { name: 'This computer', exact: true }).locator('..')
      await expect(group.getByRole('button')).toHaveCount(sources.length + 1)
      await expect.poll(() => group.evaluate(element => element.scrollWidth <= element.clientWidth),
        { message: `${type} source choices cannot require horizontal scrolling at ${width}` }).toBe(true)
      await expect(group).toHaveAttribute('data-fs-source-switcher', '')
      for (const source of [...sources, { id: 'ui-host', label: 'This computer' }]) {
        const button = group.getByRole('button', { name: source.label, exact: true })
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        const contained = await button.evaluate(element => {
          const outer = element.parentElement!.getBoundingClientRect()
          const inner = element.getBoundingClientRect()
          return inner.left >= outer.left && inner.right <= outer.right
        })
        expect(contained, `${type}: ${source.label} stays inside its source group`).toBe(true)
      }
      await expect(picker.getByRole('button', {
        name: type === 'Folder' ? /^Choose a folder from this computer/ : new RegExp(`^Add ${type.toLowerCase()} from this computer`),
      })).toBeEnabled()
      await expect(picker.locator('[data-fs-picker-body]')).toHaveCount(1)
      await expect.poll(() => picker.getByRole('button', { name: 'Done', exact: true }).evaluate(element => {
        const box = element.getBoundingClientRect()
        return box.top >= 0 && box.bottom <= innerHeight
      }), { message: `${type} completion stays visible without scrolling the whole picker at ${width}x${height}` }).toBe(true)
      await assertWcag22Aa(page, `${type} source choices ${width}x${height}`)
      await page.screenshot({ path: `.data/fs-source-layout/${type}-${width}x${height}.png`, fullPage: true })
      // Only the shared intake body scrolls; Done remains outside it.
      await picker.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(picker).toHaveCount(0)
    }
  }
})
