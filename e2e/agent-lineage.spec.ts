import { test, expect, type Browser, type Page } from '@playwright/test'
import { agentBindings } from './agent-bindings.ts'
import { ms } from './budget.ts'

/** Surface-audit S7 — a fork is a lineage relationship (this definition descends from
 *  that one, at version N), not a bare label. Locks, through the rendered UI, that a
 *  forked agent's canonical page reveals the PINNED source version (the "am I
 *  behind?" baseline), while its hub entry stays a synopsis (UI-36). */

const STAMP = Date.now().toString(36)

async function openApp(page: Page) {
  await page.goto('/')
}
async function newUser(browser: Browser, headers?: Record<string, string>) {
  const context = await browser.newContext(headers ? { extraHTTPHeaders: headers } : {})
  return { context, page: await context.newPage() }
}

test('a forked agent reveals the pinned source version on its lineage line (S7)', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const forker = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const AGENT = `Lineage guide ${STAMP}`

  // Owner: create + publish (v1) via the API seam.
  const created = await owner.page.request.post('/api/v1/agents', {
    data: { label: AGENT, ...(await agentBindings(owner.page)), tools: [], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await owner.page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  // Forker (another tenant): fork the definition → a copy with forkedFrom {label, version:1}.
  const forked = await forker.page.request.post(`/api/v1/agents/${agentId}/fork`)
  expect(forked.ok()).toBeTruthy()
  const fork = (await forked.json()) as { id: string; label: string }

  // The hub identifies the fork; lineage begins on its canonical page.
  await openApp(forker.page)
  await forker.page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  await forker.page
    .locator('[data-resource-section="Ready agents"] [data-resource-synopsis-row]')
    .filter({ hasText: fork.label })
    .getByRole('button', { name: fork.label, exact: true })
    .click()
  await expect(forker.page).toHaveURL(new RegExp(`/agents/${encodeURIComponent(fork.id)}$`))
  await expect(forker.page.getByText(new RegExp(`Forked from ${AGENT} · v1`))).toBeVisible()

  await owner.context.close()
  await forker.context.close()
})
