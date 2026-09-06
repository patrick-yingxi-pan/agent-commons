import { expect, type Page } from '@playwright/test'

/** Sessions must already be expanded. Earlier walks may have pushed an older
 * conversation past the rail's density cap; use its real disclosure door. */
export async function revealSessionRow(page: Page, title: string) {
  const tree = page.locator('aside [data-section-tree="sessions"]')
  const row = tree.getByRole('button', { name: title, exact: true })
  const showAll = tree.getByRole('button', { name: /^Show all —/ })
  await expect(row.or(showAll).first()).toBeVisible()
  if (await row.count() === 0) await showAll.click()
  await expect(row).toBeVisible()
  return row
}
