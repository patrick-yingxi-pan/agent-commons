import { test, expect, type Page } from '@playwright/test'

/** The A2A Agent Card is a machine-readable document, not a page to navigate to.
 *  Clicking "A2A card" used to open the raw JSON endpoint in a new browser tab; it
 *  now opens a presented, in-app viewer (the card laid out + Copy affordances). This
 *  locks, through the rendered UI, that on BOTH native surfaces — the owner's Agents
 *  hub card and the Discover detail — the trigger:
 *    1. opens NO new browser tab (the reported raw-JSON jump is gone), and
 *    2. mounts a dialog presenting the endpoint URL, a Copy control, and the card's
 *       fielded sections (Skills, Authentication, Raw card). */

const STAMP = Date.now().toString(36)
const AGENT = `Card subject ${STAMP}`

test('the "A2A card" trigger opens a presented viewer, not a raw-JSON tab', async ({ page, context }) => {
  test.setTimeout(60_000)

  // Create + publish an agent through the API seam (publishing is locked elsewhere) —
  // the "A2A card" affordance shows only on a published definition.
  const created = await page.request.post('/api/v1/agents', {
    data: { label: AGENT, tools: ['save_artifact', 'attach_context'], instructions: '' },
  })
  const agentId = ((await created.json()) as { id: string }).id
  await page.request.patch(`/api/v1/agents/${agentId}`, { data: { published: true } })

  await page.goto('/')

  // ── Site 1: the owner's Agents-hub card ────────────────────────────────────
  await page.getByRole('navigation').getByRole('button', { name: 'Agents', exact: true }).click()
  const hubCard = page.locator('div').filter({ hasText: AGENT })
  const pagesBefore = context.pages().length
  await hubCard.getByRole('button', { name: 'A2A card' }).last().click()

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

  // ── Site 2: the Discover detail (visitor-facing published-agent surface) ────
  await page.getByRole('button', { name: 'Discover' }).click()
  await expect(page.getByText(AGENT).first()).toBeVisible()
  await page.locator('div').filter({ hasText: AGENT }).getByRole('button', { name: 'View definition' }).last().click()
  const detail = page.getByRole('dialog').filter({ hasText: 'Fork this definition' })
  await expect(detail).toBeVisible()
  const pagesBefore2 = context.pages().length
  await detail.getByRole('button', { name: 'A2A card' }).click()
  const cardDialog = page.getByRole('dialog', { name: new RegExp(`A2A card — ${AGENT}`) })
  await expect(cardDialog).toBeVisible()
  expect(context.pages().length).toBe(pagesBefore2)
  await expect(cardDialog.getByRole('button', { name: 'Copy card URL' })).toBeVisible()
})
