/** Explicit server preconditions for specs whose subject requires the seeded
 * auth-refactor context panel. Panel posture is durable across tests/devices,
 * so those specs may never rely on whichever preference an earlier walk left. */
import { expect, type Page } from '@playwright/test'

export async function ensureAuthRefactorPanelOpen(page: Page): Promise<void> {
  const response = await page.request.patch('/api/v1/sessions/auth-refactor/preferences', {
    data: { panelFocus: { kind: 'repo', id: 'repo-auth-refactor' } },
  })
  expect(response.ok(), 'auth-refactor panel precondition persisted').toBe(true)
}
