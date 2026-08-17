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
