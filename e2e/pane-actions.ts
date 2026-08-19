import type { Locator, Page } from '@playwright/test'

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

/** Bulk disclosure shares the pane-action cluster. The focused command targets
 * a main page or selected rail subtree; explicit panel commands reach the full rail. */
export async function openOrganizePaneMenu(page: Page): Promise<Locator> {
  const toolbar = page.locator('[data-rail-toolbar-group="view"]')
  await toolbar.getByRole('button', { name: 'Organize pane', exact: true }).click()
  return page.getByRole('menu', { name: 'Organize pane', exact: true })
}

export async function organizePane(
  page: Page,
  command: 'Fold all' | 'Unfold all' | 'Fold entire panel' | 'Unfold entire panel',
): Promise<void> {
  const menu = await openOrganizePaneMenu(page)
  await menu.getByRole('menuitem', { name: command, exact: true }).click()
}
