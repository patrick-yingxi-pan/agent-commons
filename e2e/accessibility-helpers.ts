import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { tierFor } from '../src/lib/viewport.ts'

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
]

/** A resize can leave the old, opaque phone preview mounted briefly before the
 * tablet drawer's JS-driven entrance starts. Presence alone cannot identify the
 * requested tier, and document.getAnimations() does not own Framer's springs. */
export async function settledAttachmentPreview(page: Page, selector = '[data-attachment-preview]') {
  const tier = tierFor(page.viewportSize()!.width)
  const dock = page.locator('[data-overlay-dock]')
  if (tier === 'wide') await expect(dock).toHaveCount(0)
  else await expect(dock).toHaveAttribute('data-overlay-dock', tier)
  await expect.poll(() => page.locator(selector).filter({ visible: true }).evaluate(async (element) => {
    const paint = () => {
      if (!element.isConnected) return null
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).opacity !== '1') return null
      }
      const { x, y, width, height } = element.getBoundingClientRect()
      return JSON.stringify([x, y, width, height])
    }
    const before = paint()
    if (!before) return false
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return before === paint()
  })).toBe(true)
}

/** Run the standards-based browser audit and keep failures compact enough to
 * diagnose in CI. Deliberately no exclusions: shared chrome is part of every
 * page's accessible surface, even when a test is interested in a dialog. */
export async function assertWcag22Aa(page: Page, surface: string) {
  // Contrast must be judged at rest. Conversation rows and panels enter with a
  // short opacity transition; scanning mid-flight measures the blended paint,
  // not the UI a reader receives. Await the browser's finite animation set—an
  // explicit condition rather than a timing guess—before asking axe to inspect.
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return typeof endTime === 'number' && Number.isFinite(endTime)
    })
    await Promise.allSettled(animations.map((animation) => animation.finished))
  })
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA_TAGS)
    .analyze()

  if (results.violations.length === 0) return

  const details = results.violations.map((violation) => {
    const nodes = violation.nodes.slice(0, 5).map((node) => {
      const target = node.target.join(' ')
      const summary = node.failureSummary?.replace(/\s+/g, ' ').trim() ?? 'failed'
      const html = node.html.replace(/\s+/g, ' ').trim().slice(0, 240)
      return `    - ${target} (${html}): ${summary}`
    })
    const omitted = violation.nodes.length - nodes.length
    if (omitted > 0) nodes.push(`    - …and ${omitted} more node${omitted === 1 ? '' : 's'}`)
    return `  ${violation.id} [${violation.impact ?? 'unknown'}]: ${violation.help}\n${nodes.join('\n')}`
  })

  throw new Error(`${surface} has ${results.violations.length} WCAG 2.2 AA violation${results.violations.length === 1 ? '' : 's'}:\n${details.join('\n')}`)
}
