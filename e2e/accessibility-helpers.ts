import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
]

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
