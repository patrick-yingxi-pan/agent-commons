import { expect, type Page } from '@playwright/test'

/** Settle the responsive tier before choosing a rail control. The collapse
 * control is always mounted inside the rail, including when its ancestor is
 * inert and width zero; a visible/control-count check therefore describes the
 * stale DOM, not a clickable surface. */
export async function settleArtifactPageRail(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Collapse sidebar"]')
    const expected = window.innerWidth < 640 ? 'absolute' : 'relative'
    let rail = button?.parentElement as HTMLElement | null
    while (rail && !(rail.style.width && getComputedStyle(rail).position === expected)) rail = rail.parentElement
    if (!rail) return false
    return getComputedStyle(rail).position === expected
  })).toBe(true)

  // Allow the tier change's layout effect and paint to settle before reading
  // the restored desktop preference (the DOM tier can update one render first).
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const close = page.locator('button[aria-label="Collapse sidebar"]').first()
  const narrow = await page.evaluate(() => window.innerWidth < 640)
  const state = () => close.evaluate((button) => {
    const expected = window.innerWidth < 640 ? 'absolute' : 'relative'
    let rail = button.parentElement as HTMLElement | null
    while (rail && !(rail.style.width && getComputedStyle(rail).position === expected)) rail = rail.parentElement
    if (!rail) return { inert: false, width: -1 }
    return { inert: rail.hasAttribute('inert'), width: Math.round(rail.getBoundingClientRect().width) }
  })
  if (narrow) {
    // The responsive effect closes a narrow drawer; never click the old
    // control while that effect is reconciling the previous tier.
    await expect.poll(state).toEqual({ inert: true, width: 0 })
    return
  }

  const current = await state()
  if (!current.inert) {
    await close.click()
  }
  await expect.poll(state).toEqual({ inert: true, width: 0 })
}
