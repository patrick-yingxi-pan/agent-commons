import { test, expect, type Page } from '@playwright/test'
import { agentBindings } from './agent-bindings.ts'
import { ms } from './budget.ts'

/** The A2A Agent Card is a machine-readable document, not a page to navigate to.
 *  Clicking "A2A card" used to open the raw JSON endpoint in a new browser tab; it
 *  now opens a presented, in-app viewer (the card laid out + Copy affordances). This
 *  locks, through the rendered UI, that on the canonical Agent page — reached
 *  from either an owner synopsis or Discover — the trigger:
 *    1. opens NO new browser tab (the reported raw-JSON jump is gone), and
 *    2. mounts a dialog presenting the endpoint URL, a Copy control, and the card's
 *       fielded sections (Skills, Authentication, Raw card). */

const STAMP = Date.now().toString(36)
const AGENT = `Card subject ${STAMP}`

test('the "A2A card" trigger opens a presented viewer, not a raw-JSON tab', async ({ page, context }) => {
  test.setTimeout(ms(60_000))

  // Create + publish an agent through the API seam (publishing is locked elsewhere) —
  // the "A2A card" affordance shows only on a published definition.
  const created = await page.request.post('/api/v1/agents', {
    data: { label: AGENT, ...(await agentBindings(page)), tools: ['save_artifact', 'attach_context'], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  await page.goto('/')

  // The index remains a synopsis (UI-36): A2A presentation begins only after
  // opening the canonical Agent page.
  await page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  await page
    .locator('[data-resource-section="Ready agents"] [data-resource-synopsis-row]')
    .filter({ hasText: AGENT })
    .getByRole('button', { name: AGENT, exact: true })
    .click()
  await expect(page.getByRole('heading', { name: AGENT, exact: true })).toBeVisible()
  const pagesBefore = context.pages().length
  await page.getByRole('button', { name: 'Open A2A card' }).click()

  const dialog = page.getByRole('dialog', { name: new RegExp(`A2A card — ${AGENT}`) })
  await expect(dialog).toBeVisible()
  // The regression guard: no new tab jumped to the raw endpoint.
  expect(context.pages().length).toBe(pagesBefore)
  // The endpoint URL — the hand-off artifact — is presented, with a Copy control.
  await expect(dialog.getByText(new RegExp(`/a2a/agents/${agentId}/card`))).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Copy card URL' })).toBeVisible()
  // Fielded, not dumped: the card's sections are rendered.
  await expect(dialog.getByText(/Skills \(\d+\)/)).toBeVisible()
  await expect(dialog.getByText('Authentication', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Raw card/)).toBeVisible()
  // Copying swaps the label (the shared CopyButton confirmation).
  await dialog.getByRole('button', { name: 'Copy card URL' }).click()
  await expect(dialog.getByRole('button', { name: 'Copy card URL' })).toHaveText('Copied')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
})
