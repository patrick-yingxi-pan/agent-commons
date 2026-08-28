import { expect, type Locator, type Page } from '@playwright/test'
import { ms } from './budget.ts'

/** A repo/workspace session can briefly auto-tile its context pane before the
 * durable explicit-close preference reconciles. Focus and close it when still
 * present; if it disappears between probes, cleanup has already succeeded. */
export async function clearAutoPanel(page: Page): Promise<void> {
  const ctx = page.locator('[data-context-pane]')
  // Capture existence + identity in one browser evaluation. A locator count
  // followed by getAttribute has a race: preference reconciliation can remove
  // the transient pane between those calls and Playwright then waits for an
  // element whose disappearance already completed this cleanup.
  const panePath = await page.locator('[data-main-pane]').evaluateAll((panes) => {
    const contextPane = panes.find((candidate) => candidate.querySelector('[data-context-pane]'))
    return contextPane?.getAttribute('data-main-pane') ?? null
  })
  if (panePath === null) return
  const contextPane = page.locator(`[data-main-pane="${panePath}"]`)
  // Target is part of the action contract. If preference reconciliation removes
  // this pane between focus and click, this locator stops matching; it can never
  // fall through to a newly retargeted Close button and delete the conversation.
  const closeThisPane = page.locator(
    `[data-close-view][data-close-target="main:${panePath}"]`,
  )
  let ownsClose = false
  try {
    await contextPane.dispatchEvent('pointerdown', undefined, { timeout: ms(1_000) })
    await expect(contextPane).toHaveAttribute('data-focused', 'true', { timeout: ms(1_000) })
    ownsClose = true
  } catch {
    // Durable panel-preference reconciliation may remove this transient pane
    // between probes. Never let an unproven focus act close the conversation.
  }
  if (ownsClose && (await contextPane.count()) > 0) {
    await closeThisPane.click({ timeout: ms(1_000) }).catch(() => {})
  }
  await expect(ctx).toHaveCount(0)
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
}

/** The expanded rail adapts the two split directions to one compact menu so
 * Close pane can remain a direct, unclipped action at the minimum rail width.
 * E2E callers go through the same visible menu instead of reaching for the
 * MiniRail's direct data-stamped buttons. */
export async function openSplitPaneMenu(page: Page): Promise<Locator> {
  const toolbar = page.locator('[data-rail-toolbar-group="view"]')
  await toolbar.getByRole('button', { name: 'Split pane', exact: true }).click()
  return page.getByRole('menu', { name: 'Split pane', exact: true })
}

export async function splitPane(page: Page, direction: 'right' | 'down'): Promise<void> {
  const menu = await openSplitPaneMenu(page)
  await menu.getByRole('menuitem', { name: `Split ${direction}`, exact: true }).click()
}

/** Bulk disclosure shares the pane-action cluster. Focus selects the command
 * scope: main page, selected rail subtree, or the whole rail background. */
export async function openOrganizePaneMenu(page: Page): Promise<Locator> {
  const toolbar = page.locator('[data-rail-toolbar-group="view"]')
  await toolbar.getByRole('button', { name: 'Organize pane', exact: true }).click()
  return page.getByRole('menu', { name: 'Organize pane', exact: true })
}

export async function organizePane(
  page: Page,
  command: 'Fold all' | 'Unfold all',
): Promise<void> {
  const menu = await openOrganizePaneMenu(page)
  await menu.getByRole('menuitem', { name: command, exact: true }).click()
}
