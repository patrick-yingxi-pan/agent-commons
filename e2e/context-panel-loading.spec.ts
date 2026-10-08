import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const WORKSPACE_MODULE = /\/src\/components\/WorkspacePanel\.tsx(?:\?.*)?$/u
const CONNECTOR_MODULE = /\/src\/components\/ConnectorPanel\.tsx(?:\?.*)?$/u
const WORKSPACE_SESSION = 'insights-empty-states'
const REPO_CONNECTOR_SESSION = 'auth-refactor'

type PanelFocus = { kind: 'workspace' | 'repo' | 'connector'; id: string }
type FocusedSession = { workspace?: { workspaces?: Array<{ id: string }>; repos?: Array<{ id: string }>; connectors?: Array<{ id: string }> } }

async function setPanelPreference(page: Page, sessionId: string, panelFocus: PanelFocus | null) {
  const response = await page.request.patch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/preferences`, {
    data: { panelFocus },
  })
  expect(response.ok(), `the panel preference for ${sessionId} is set: ${await response.text()}`).toBe(true)
}

async function seededPanelFocus(page: Page, sessionId: string, kind: 'workspace' | 'repo' | 'connector'): Promise<PanelFocus> {
  const response = await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)
  expect(response.ok(), `the seeded session ${sessionId} is readable: ${await response.text()}`).toBe(true)
  const session = await response.json() as FocusedSession
  const candidates = session.workspace?.[kind === 'workspace' ? 'workspaces' : kind === 'repo' ? 'repos' : 'connectors']
  const target = candidates?.[0]
  expect(target, `${sessionId} has a seeded ${kind} panel`).toBeTruthy()
  return { kind, id: target!.id }
}

async function dismissWhileModuleIsCold(page: Page, options: {
  viewport: { width: number; height: number }
  sessionId: string
  focus: PanelFocus
  module: RegExp
  loading: string
  holdUntilAfterDomClose?: boolean
}) {
  const { viewport, sessionId, focus, module, loading, holdUntilAfterDomClose = false } = options
  await page.setViewportSize(viewport)
  // Server-backed preferences survive browser contexts. Reset before each
  // journey, then install the exact target read from that session's workspace.
  await setPanelPreference(page, sessionId, null)
  await setPanelPreference(page, sessionId, focus)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let finished!: () => void
  const routeFinished = new Promise<void>((resolve) => { finished = resolve })
  let requests = 0
  await page.route(module, async (route) => {
    requests++
    await held
    try { await route.continue() } finally { finished() }
  })

  const dock = page.locator('[data-overlay-dock]')
  try {
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await expect(dock.locator(loading), 'the panel is still showing its deferred loading shell').toBeVisible({ timeout: ms(15_000) })
    await expect.poll(() => requests, 'the exact lazy body request is held').toBe(1)
    // The saved preference can replace the seeded default panel during
    // hydration. Let that unrelated old shell exit while this body stays cold.
    await expect(dock.locator(':scope > *'), 'only the requested loading panel remains').toHaveCount(1)
    await dock.getByRole('button', { name: 'Close', exact: true }).click()
    if (holdUntilAfterDomClose) {
      await expect(dock.locator(':scope > *'), 'an unresolved optional module cannot block panel dismissal').toHaveCount(0, { timeout: ms(8_000) })
      release()
    } else {
      // Resolve during the exit animation to exercise the late fallback → body
      // swap while AnimatePresence is still retaining its child.
      release()
    }
    await routeFinished
    await expect(dock.locator(':scope > *'), 'a late body cannot keep the dismissed panel painted or intercepting').toHaveCount(0, { timeout: ms(8_000) })
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('The conversation remains usable after closing a loading panel.')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await setPanelPreference(page, sessionId, null)
  }
}

async function checkColdPanel(page: Page, kind: PanelFocus['kind'], width: 375 | 768) {
  const sessionId = kind === 'workspace' ? WORKSPACE_SESSION : REPO_CONNECTOR_SESSION
  const focus = await seededPanelFocus(page, sessionId, kind)
  await dismissWhileModuleIsCold(page, {
    viewport: { width, height: width === 375 ? 812 : 1024 },
    sessionId,
    focus,
    module: kind === 'connector' ? CONNECTOR_MODULE : WORKSPACE_MODULE,
    loading: kind === 'connector' ? '[data-connector-panel-load="loading"]' : '[data-workspace-panel-load="loading"]',
    // Keep one projection genuinely cold until the old panel DOM is gone.
    holdUntilAfterDomClose: kind === 'connector' && width === 375,
  })
}

test('a closed loading Workspace panel stays closed when its body arrives at 375px', async ({ page }) => { await checkColdPanel(page, 'workspace', 375) })
test('a closed loading Repository panel stays closed when its body arrives at 375px', async ({ page }) => { await checkColdPanel(page, 'repo', 375) })
test('a closed loading Connector panel stays closed when its body arrives at 375px', async ({ page }) => { await checkColdPanel(page, 'connector', 375) })
test('a closed loading Workspace panel stays closed when its body arrives at 768px', async ({ page }) => { await checkColdPanel(page, 'workspace', 768) })
test('a closed loading Repository panel stays closed when its body arrives at 768px', async ({ page }) => { await checkColdPanel(page, 'repo', 768) })
test('a closed loading Connector panel stays closed when its body arrives at 768px', async ({ page }) => { await checkColdPanel(page, 'connector', 768) })
