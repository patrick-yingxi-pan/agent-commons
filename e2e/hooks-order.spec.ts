/** Regression guard — the MAIN Workspace shell keeps a STABLE hook order.
 *
 *  `Workspace` (src/App.tsx) flattens 140+ hooks from useSessionWorkspace +
 *  useMainSplit + useLayout + useViewport + the api read hooks. A single
 *  conditionally-called hook ANYWHERE in that chain — a hook inside an
 *  if/ternary/&&, after a conditional early-return, or in a variable-length
 *  loop — reorders the list between two renders, which React reports as
 *  "React has detected a change in the order of Hooks called by Workspace"
 *  (dev, console.error) and which corrupts state in prod. The class is
 *  invisible to `node --test` (no DOM), so it lives here: drive the exact
 *  transitions that flip the shell's state hardest and FAIL on any
 *  hook-order console error (or thrown "Rendered more/fewer hooks") from any
 *  component in the tree.
 *
 *  The trigger the class correlates with is `focus` going non-null when a
 *  repo/workspace session opens (its context panel tiles into the universal
 *  split on the wide tier), so the drive covers: mount → boot-restore the
 *  auth-refactor repo session (focus null → set + a context pane) → switch to a
 *  different thread and back (focus churn) → split a pane (tree churn). React
 *  warns only ONCE per component per page load, so the listener is armed before
 *  the very first navigation. Selectors mirror e2e/main-split.spec.ts. */
import { test, expect, type ConsoleMessage } from '@playwright/test'

/** React's dev warning for a reordered hook list, plus the hard errors a count
 *  change throws in React 19 — any of these means a Rules-of-Hooks violation. */
const HOOK_VIOLATION = /change in the order of Hooks|Rendered (more|fewer) hooks than|Rules of Hooks/i

test('the Workspace shell keeps a stable hook order across focus / panel / split transitions', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && HOOK_VIOLATION.test(msg.text())) violations.push(msg.text())
  })
  // React 19 can THROW "Rendered more hooks than during the previous render"
  // when the count grows mid-render — that surfaces as a pageerror, not a log.
  page.on('pageerror', (err) => {
    if (HOOK_VIOLATION.test(err.message)) violations.push(err.message)
  })

  await page.setViewportSize({ width: 1280, height: 1000 })

  // Mount on the fresh draft (focus null), then boot-restore a repo session:
  // `focus` goes non-null and its context panel auto-tiles as a pane in the
  // universal split (wide tier) — the exact null → set transition the class
  // correlates with, on the real boot-restore path.
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await expect(page.locator('[data-context-pane]')).toBeVisible()

  // Close the auto-tiled context pane (focus set → closed): focus the pane,
  // then the rail cluster's close clears it — the split tree dissolves back to a
  // lone primary. (dispatchEvent: focus rides pointer-down; the thread's
  // continuous animations would defeat actionability. Mirrors main-split.spec.)
  await page.locator('[data-context-pane]').first().dispatchEvent('pointerdown')
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-context-pane]')).toHaveCount(0)

  // Switch to a different thread and back — the singleton controller re-renders
  // with a different `focus` each time.
  await page.getByRole('button', { name: 'Expand Sessions' }).click()
  await page.locator('aside').getByText('Dashboard query performance').first().click()
  await expect(page.getByText('token refresh logic')).toHaveCount(0)
  await page.locator('aside').getByText('Refactor auth middleware').first().click()
  await expect(page.getByText('token refresh logic').first()).toBeVisible()

  // Split the focused (now lone-primary) pane — the main split tree changes
  // shape: another whole family of re-renders driven by useMainSplit state. The
  // duplicate 'b' pane appears (paths a | b), as in main-split.spec. The last
  // click was rail navigation, so explicitly return focus to main: the shared
  // command cluster must follow focus rather than remember an old target.
  await page.locator('main').dispatchEvent('pointerdown')
  await page.locator('[data-split-view="row"]').click()
  await expect(page.locator('[data-main-split]')).toBeVisible()
  await expect(page.locator('[data-main-pane="b"]')).toBeVisible()

  expect(violations, `React reported a Rules-of-Hooks violation:\n${violations.join('\n\n')}`).toEqual([])
})
