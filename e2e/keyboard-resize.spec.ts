/** Keyboard operability of the ONE resize primitive (WCAG 2.1.1, invariant UI-11,
 *  docs/ui-invariants.md): every drag divider is a focusable separator that axis
 *  arrow keys step and that announces its value (aria-valuenow, WCAG 4.1.2). Wired
 *  proofs: the vertical rail-width handle, a horizontal rail-view split, and the panel
 *  handle — the one strip that rides a width-ANIMATED container, where rapid
 *  presses once swallowed steps; the source lock (src/components/resize-handle.test.ts)
 *  enumerates the one remaining call site through the same funnel. Also locks that
 *  a keyboard gesture PERSISTS the size it produced (move → end runs in one tick;
 *  an at-render-only ref stored the previous size, so a reload snapped it back). */
import { test, expect, type Locator, type Page } from '@playwright/test'

/** The rail width animates (200ms transition), so measure only once the box has
 *  stopped moving — two consecutive samples within half a pixel. */
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

test('arrow keys resize the rail and a focused rail split through shared separators, and the result persists', async ({ page }) => {
  // Tall enough that the split rail has headroom above its clamp — a short rail
  // would pin the lower pane's ceiling near its default and the coarse step would
  // read as "keyboard broken" when it's the clamp.
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')

  // ── Vertical separator (rail width): Left/Right arrows step it. ──
  const rail = page.locator('aside')
  const railHandle = page.getByRole('separator', { name: 'Resize sidebar' })
  await expect(railHandle).toBeVisible()
  const w0 = await settled(page, rail, 'width')
  await railHandle.focus()
  await page.keyboard.press('ArrowRight')
  const w1 = await settled(page, rail, 'width')
  expect(w1, 'first press steps right (16px ± the half-strip bias)').toBeGreaterThanOrEqual(w0 + 8)
  await page.keyboard.press('ArrowRight')
  const w2 = await settled(page, rail, 'width')
  expect(w2, 'steady-state step is a full 16px').toBeGreaterThanOrEqual(w1 + 12)
  await page.keyboard.press('ArrowLeft')
  const w3 = await settled(page, rail, 'width')
  expect(w3, 'the step inverts').toBeLessThanOrEqual(w2 - 12)

  // ── Focus-aware rail split: pick any navigation entry, then the shared Split
  // down action creates a lower view anchored to it. Its generic split-tree
  // separator uses the same Up/Down keyboard pipeline.
  await page.locator('[data-rail-pane="root"]').getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: 'Split down', exact: true }).click()
  const lower = page.locator('[data-rail-pane="b"]')
  const paneHandle = page.getByRole('separator', { name: 'Resize sidebar views (root)' })
  await expect(paneHandle).toBeVisible()
  const h0 = await settled(page, lower, 'height')
  await paneHandle.focus()
  await page.keyboard.press('Shift+ArrowUp')
  const h1 = await settled(page, lower, 'height')
  expect(h1, 'Shift steps coarse (64px ± the half-gutter bias)').toBeGreaterThanOrEqual(h0 + 48)

  // ── The keyboard gesture persisted what it rendered (not one step stale). ──
  // Both preference stores are scoped PER ACCOUNT — resolve the active account
  // the way App.tsx does.
  const stored = await page.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()) as { user: { id: string } }
    const layoutRaw = localStorage.getItem(`claude-ui.layout.v1.${me.user.id}`)
    const railRaw = localStorage.getItem(`claude-ui.railsplit.v1.${me.user.id}`)
    const layout = layoutRaw ? (JSON.parse(layoutRaw) as { leftW?: number }) : {}
    const railTree = railRaw ? (JSON.parse(railRaw) as { kind?: string; ratio?: number }) : {}
    return { leftW: layout.leftW, railRatio: railTree.ratio }
  })
  expect(Math.abs((stored.leftW ?? 0) - w3), 'stored rail width matches the rendered one').toBeLessThanOrEqual(1)
  expect(stored.railRatio).toBeDefined()
  expect(
    Math.abs((1 - (stored.railRatio ?? 0)) * 100 - Number(await paneHandle.getAttribute('aria-valuenow'))),
    'stored rail ratio matches the separator value',
  ).toBeLessThanOrEqual(1)
})

test('the overlay panel separator takes RAPID keyboard steps, announces its value, and persists', async ({ page }) => {
  // The width-animated docked PanelShell — the one divider whose strip rides a
  // width-animated motion.div — now renders only on the MEDIUM overlay tier (the
  // wide tier folds the panel into the universal tree as a context pane whose
  // split node owns geometry, ADAPT-16→ADAPT-17; narrow is a takeover). So the
  // swallowed-step regression lives here now.
  await page.setViewportSize({ width: 768, height: 1000 })
  await page.goto('/')

  // The seeded repo session restores its panel on select (same door responsive.spec uses).
  await page.getByRole('button', { name: 'Expand Sessions' }).click()
  await page.locator('aside').getByText('Refactor auth middleware').first().click()
  const panelHandle = page.getByRole('separator', { name: 'Resize panel' })
  await expect(panelHandle).toBeVisible()
  const panel = page.locator('div.border-l.bg-panel').first()
  const w0 = await settled(page, panel, 'width')
  const v0 = Number(await panelHandle.getAttribute('aria-valuenow'))
  expect(v0, 'the separator announces a plausible current width').toBeGreaterThanOrEqual(300)

  // Two presses back-to-back, NO settle between them — the regression lock for the
  // swallowed-step bug: the panel is the one divider whose strip rides the width-
  // animated motion.div, so if a keyboard gesture ever animates again (the dragging
  // flag dropping inside the batched commit), the second press re-snaps to the
  // mid-flight rect and this total comes up short.
  await panelHandle.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  const w1 = await settled(page, panel, 'width')
  expect(w1, 'two rapid presses land two full steps').toBeGreaterThanOrEqual(w0 + 24)

  // The value tracks (WCAG 4.1.2) and the gesture persisted what it rendered.
  const v1 = Number(await panelHandle.getAttribute('aria-valuenow'))
  expect(v1, 'aria-valuenow follows the steps').toBeGreaterThanOrEqual(v0 + 24)
  const storedRight = await page.evaluate(async () => {
    const me = (await (await fetch('/api/v1/me')).json()) as { user: { id: string } }
    return (JSON.parse(localStorage.getItem(`claude-ui.layout.v1.${me.user.id}`) ?? '{}') as { rightW?: number }).rightW
  })
  expect(Math.abs((storedRight ?? 0) - w1), 'stored panel width matches the rendered one').toBeLessThanOrEqual(1)
})
