/** Multi-account regression (design docs/design/multi-account-ui.md, P4):
 *  ONE browser, switching accounts IN PLACE via the sidebar chip — no page
 *  reload, no per-context identity headers (that's the co-author spec's device;
 *  here the client's own account layer carries identity). Locks the crux the
 *  design exists for (§1, invariant I1): a generation that is mid-stream when
 *  its viewer switches away CONTINUES server-side, routes to the right tenant,
 *  and is complete and coherent when the viewer switches back — plus tenant
 *  isolation across the switch (the other account sees none of it) and the
 *  chip's label being the SERVER's word for who it heard (/v1/me), not an
 *  optimistic client label.
 *
 *  Runs on the standard self-contained harness (playwright.config.ts): UI 5183 /
 *  API 5184, BACKEND=remote (identitySwitch advertised — the chip is a plain
 *  label on the mock backend), isolated store, pinned local mock model. The
 *  message contains "paced" → the mock model streams slowly (~150 ms/word), so
 *  switching mid-generation is deterministic, not a race. */
import { test, expect, type Page } from '@playwright/test'

const STAMP = Date.now().toString(36)
const PACED_MESSAGE = `paced hello please ${STAMP}`
// The mock model's default plain reply — what the completed turn must contain.
const REPLY_MARKER = 'static prototype'

async function dismissIntro(page: Page, timeout = 2_500) {
  await page.getByRole('button', { name: 'Explore on my own' }).click({ timeout }).catch(() => {})
}

/** Switch accounts via the chip; assert the switch by the chip's own label —
 *  which is /v1/me refetched under the new identity, i.e. server truth. */
async function switchTo(page: Page, optionText: string | RegExp, expectChip: string | RegExp) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expectChip, { timeout: 5_000 })
}

test('a mid-generation account switch: the turn survives, the other tenant sees nothing, switch-back finds the reply', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await dismissIntro(page)

  // The default identity on the remote backend — server truth on the chip.
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await expect(page.getByTestId('account-chip')).toContainText('Acme')

  // A FRESH draft — the app opens on the demo session, and a send there would
  // land in the demo thread instead of materializing a new session.
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()

  // Send the paced turn from the fresh thread; wait until the reply is
  // demonstrably MID-STREAM (some text arrived, the marker's tail hasn't).
  await page.getByPlaceholder('Reply to Claude…').fill(PACED_MESSAGE)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/This is a static/).first()).toBeVisible({ timeout: 15_000 })
  // The draft materialized into a real, persisted session (server-minted id,
  // titled from the message) — visible in Ada's sidebar before we switch away.
  await expect(page.locator('aside').getByText(new RegExp(PACED_MESSAGE.slice(0, 20))).first()).toBeVisible({
    timeout: 10_000,
  })

  // Switch to the other tenant WHILE the turn streams (invariant I1: this only
  // detaches the view — the turn runs on server-side).
  await switchTo(page, 'tenant-beta', 'tenant-beta')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')

  // Tenant isolation across the switch: Bo's world holds none of Ada's session —
  // not in the sidebar, not as thread content.
  await expect(page.getByText(PACED_MESSAGE)).toHaveCount(0)

  // Give the paced turn time to finish server-side with NOBODY watching, then
  // come back as Ada.
  await page.waitForTimeout(4_000)
  await switchTo(page, 'Ada Lovelace', 'Ada Lovelace')

  // Ada's world is intact: the session is in her sidebar; opening it shows the
  // COMPLETED reply (persisted while detached — or still streaming, in which
  // case the reattach path renders the tail live; either way the full reply
  // must materialize).
  // The sidebar is an <aside> (role: complementary), so scope by element.
  const row = page.locator('aside').getByText(new RegExp(PACED_MESSAGE.slice(0, 20)))
  await expect(row.first()).toBeVisible({ timeout: 5_000 })
  await row.first().click()
  await expect(page.getByText(new RegExp(REPLY_MARKER)).first()).toBeVisible({ timeout: 20_000 })

  // And the RECORD is coherent (server truth, not pixels): exactly one user
  // turn and one complete assistant turn — idempotency + replay-dedupe held
  // across the detach/reattach, nothing double-appended.
  const list = await (await page.request.get('/api/v1/sessions')).json()
  const session = list.find((s: { title: string }) => s.title.startsWith(PACED_MESSAGE.slice(0, 20)))
  expect(session, 'the paced session exists in the tenant’s list').toBeTruthy()
  // The reply marker shows early in the (paced) stream, so the visible check
  // above can pass while the reattached turn is still running — poll the record
  // until the turn completes and persists.
  await expect
    .poll(
      async () => {
        const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
        return { roles: (full.messages ?? []).map((m: { role: string }) => m.role), live: full.activeTurnId ?? null }
      },
      { timeout: 20_000 },
    )
    .toEqual({ roles: ['user', 'assistant'], live: null })
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(full.messages[1].content).toContain(REPLY_MARKER)
})

test('the menu splits real memberships from the seed directory; an active-workspace pick is a no-op', async ({ page }) => {
  await page.goto('/')
  await dismissIntro(page)
  await page.getByTestId('account-chip').click()
  // Your workspaces (P7): Ada's REAL memberships — acme only, marked Active.
  const workspaces = page.getByTestId('workspace-option')
  await expect(workspaces).toHaveCount(1)
  await expect(workspaces.filter({ hasText: 'Acme' })).toContainText('Active')
  // The dev seed directory shows OTHER principals only (no duplicate of self).
  const seeds = page.getByTestId('account-option')
  await expect(seeds).toHaveCount(2) // grace@acme, grace@tenant-beta
  await expect(seeds.filter({ hasText: 'Ada' })).toHaveCount(0)
  // Picking the already-active workspace closes the menu and changes nothing.
  await workspaces.first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
})
