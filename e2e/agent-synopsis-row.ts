import type { Locator, Page } from '@playwright/test'

/** Find one Agent synopsis by the row's exact title door, never by ancestor text.
 * Persistent E2E stores may contain many older Agents and review controls. */
export function agentSynopsisRow(page: Page, label: string): Locator {
  return page.locator('main [data-resource-section="Ready agents"] [data-resource-synopsis-row]').filter({
    has: page.getByRole('button', { name: label, exact: true }),
  })
}
