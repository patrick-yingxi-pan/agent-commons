/** The split frame (spec ADAPT-16): the docked panel splits into a tiled frame,
 *  the new pane picks its content, the divider is keyboard-operable (UI-11), and
 *  closing back to one pane dissolves the frame into the legacy single panel.
 *  DOM-level wiring — the tree math itself is locked by tests/split-frame.test.ts. */
import { test, expect, type Locator, type Page } from '@playwright/test'

/** Measure once the box has stopped moving (the frame renders inside a flex
 *  layout that can settle a beat after a click). */
async function settled(page: Page, target: Locator, dim: 'width' | 'height'): Promise<number> {
  let prev = -1
  await expect
    .poll(
      async () => {
        const v = (await target.boundingBox())![dim]
        const stable = Math.abs(v - prev) < 0.5
        prev = v
        return stable
      },
      { intervals: Array(20).fill(120), message: `${dim} settles` },
    )
    .toBe(true)
  return prev
}

test('split → picker → two panes; the divider steps by keyboard; closing dissolves the frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')

  // The seeded repo session restores its panel on select (the responsive.spec door).
  await page.locator('aside').getByText('Refactor auth middleware').first().click()
  // [data-split] is the PANEL header's split button (the rail's main-split
  // cluster carries the same title — [data-split-view] — so scope by attr).
  const splitRight = page.locator('[data-split="row"]')
  await expect(splitRight, 'the docked panel offers Split right on the wide tier').toBeVisible()
  await splitRight.click()

  // The frame is up: the old content keeps pane a; pane b is the picker.
  await expect(page.locator('[data-split-frame]')).toBeVisible()
  await expect(page.locator('[data-split-pane]')).toHaveCount(2)
  const picker = page.locator('[data-split-picker]')
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: /Repository/ }).click()
  await expect(page.locator('[data-split-picker]'), 'the picker fills in').toHaveCount(0)

  // Two panes of the SAME repo — duplicates are the point (files beside diff).
  await expect(page.locator('[data-split-pane="a"]').getByText('Repository')).toBeVisible()
  await expect(page.locator('[data-split-pane="b"]').getByText('Repository')).toBeVisible()

  // The pane divider is a focusable, named separator that arrow keys step (UI-11).
  const divider = page.getByRole('separator', { name: 'Resize split panes (root)' })
  await expect(divider).toBeVisible()
  const paneA = page.locator('[data-split-pane="a"]')
  const w0 = await settled(page, paneA, 'width')
  await divider.focus()
  await page.keyboard.press('ArrowRight')
  const w1 = await settled(page, paneA, 'width')
  expect(w1, 'the divider steps the split (16px ± the half-strip bias)').toBeGreaterThanOrEqual(w0 + 8)
  const now = Number(await divider.getAttribute('aria-valuenow'))
  expect(now, 'the separator announces the trailing pane share, off the 50% default').toBeLessThan(50)

  // The absolute pane floor (rulebook judgment finding, 2026-07-15): the 15%
  // ratio clamp alone let a deep drag crush a pane to a sliver — flexbox min
  // sizes now floor a row pane at ~200px regardless of ratio.
  for (let i = 0; i < 15; i += 1) await page.keyboard.press('Shift+ArrowRight')
  const paneB = page.locator('[data-split-pane="b"]')
  const squeezed = await settled(page, paneB, 'width')
  expect(squeezed, 'a deep drag cannot crush a pane below its usable floor').toBeGreaterThanOrEqual(190)

  // Closing pane b dissolves the frame back to the legacy single panel (which
  // still shows the repo and offers the split buttons again).
  await page.locator('[data-split-pane="b"] button[title="Close"]').click()
  await expect(page.locator('[data-split-frame]')).toHaveCount(0)
  await expect(page.locator('[data-split="row"]')).toBeVisible()
})
