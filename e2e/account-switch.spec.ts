/** Multi-account regression (design docs/design/multi-account-ui.md, P4; P9:
 *  migrated off the retired dev directory onto the REAL account stack — the
 *  seeds sign in with their demo credentials like any account, then switch via
 *  the remembered-accounts rows, credential-less):
 *  ONE browser, switching accounts IN PLACE via the sidebar chip — no page
 *  reload, no per-context identity headers (that's the co-author spec's device;
 *  here the session cookie carries identity). Locks the crux the design exists
 *  for (§1, invariant I1): a generation that is mid-stream when its viewer
 *  switches away CONTINUES server-side, routes to the right tenant, and is
 *  complete and coherent when the viewer switches back — plus tenant isolation
 *  across the switch (the other account sees none of it) and the chip's label
 *  being the SERVER's word for who it heard (/v1/me), not an optimistic label.
 *
 *  Runs on the standard self-contained harness (playwright.config.ts): UI 5183 /
 *  API 5184, BACKEND=remote, isolated store, pinned local mock model. The
 *  message contains "paced" → the mock model streams slowly (~150 ms/word), so
 *  switching mid-generation is deterministic, not a race. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const STAMP = Date.now().toString(36)
const PACED_MESSAGE = `paced hello please ${STAMP}`
// The mock model's default plain reply — what the completed turn must contain.
const REPLY_MARKER = 'free-form chat is canned'

/** Sign the browser context in through the REAL endpoints (page.request shares
 *  the context's cookie jar, so the Set-Cookie lands where the page reads it).
 *  Ada and Grace are seeds with DOCUMENTED demo credentials (P9); since FWD-5
 *  Phase 2 each lands directly in their ONE namespace — Grace's is tenant-beta,
 *  the isolation counterpart to Ada's acme. */
async function stackSeedAccounts(page: Page) {
  const ada = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(ada.ok()).toBeTruthy()
  const grace = await page.request.post('/api/v1/auth/login', {
    data: { email: 'grace@acme.example', password: 'grace-demo-password' },
  })
  expect(grace.ok()).toBeTruthy()
}

/** Switch accounts via the chip's remembered-accounts rows (the stack —
 *  credential-less); assert the switch by the chip's own label, which is
 *  /v1/me refetched under the new identity, i.e. server truth. */
async function switchTo(page: Page, optionText: string | RegExp, expectChip: string | RegExp) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expectChip, { timeout: ms(5_000) })
}

test('a mid-generation account switch: the turn survives, the other tenant sees nothing, switch-back finds the reply', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')

  // The default identity on the remote backend — server truth on the chip.
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  // The chip's second line is the account funnel's answer (src/lib/accountFace.ts):
  // the EMAIL, because the namespace is simply this person and saying so twice
  // is not a second fact.
  await expect(page.getByTestId('account-chip')).toContainText('ada@acme.example')

  // Sign both seeds in for real (they stack); land as Grace-in-beta, then hop
  // to Ada through the stack — the surface under test from here on.
  await stackSeedAccounts(page)
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await expect(page.getByTestId('account-chip')).toContainText('grace@acme.example')
  await switchTo(page, 'Ada Lovelace', 'Ada Lovelace')

  // A FRESH draft, so the send below materializes a new session.
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()

  // Send the paced turn from the fresh thread; wait until the reply is
  // demonstrably MID-STREAM (some text arrived, the marker's tail hasn't).
  await page.getByPlaceholder('Reply to Claude…').fill(PACED_MESSAGE)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: ms(15_000) })
  // The draft materialized into a real, persisted session (server-minted id,
  // titled from the message) — visible in Ada's sidebar before we switch away.
  await page.getByRole('button', { name: 'Expand Recents' }).click()
  await expect(page.locator('aside').getByText(new RegExp(PACED_MESSAGE.slice(0, 20))).first()).toBeVisible({
    timeout: ms(10_000),
  })

  // Switch to the other account WHILE the turn streams (invariant I1: this only
  // detaches the view — the turn runs on server-side). Grace's one namespace is
  // tenant-beta, so the hop lands there.
  await switchTo(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.getByTestId('account-chip')).toContainText('grace@acme.example')

  // Tenant isolation across the switch: Grace's world holds none of Ada's
  // session — not in the sidebar, not as thread content.
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
  await expect(row.first()).toBeVisible({ timeout: ms(5_000) })
  await row.first().click()
  await expect(page.getByText(new RegExp(REPLY_MARKER)).first()).toBeVisible({ timeout: ms(20_000) })

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
      { timeout: ms(20_000) },
    )
    .toEqual({ roles: ['user', 'assistant'], live: null })
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(full.messages[1].content).toContain(REPLY_MARKER)
})

test('the menu lists remembered accounts only (no dev directory, no workspace rows); an active pick is a no-op', async ({ page }) => {
  await page.goto('/')
  await stackSeedAccounts(page)
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')

  await page.getByTestId('account-chip').click()
  // Accounts (P9): the two credentialed sign-ins, newest active.
  const stack = page.getByTestId('account-stack-option')
  await expect(stack).toHaveCount(2)
  await expect(stack.filter({ hasText: 'Grace' })).toContainText('Active')
  // FWD-5 Phase 2: no workspace section — an account IS its one namespace.
  await expect(page.getByTestId('workspace-option')).toHaveCount(0)
  await expect(page.getByTestId('workspace-new')).toHaveCount(0)
  // The old "Switch identity (dev)" section is gone with the directory.
  await expect(page.getByTestId('account-option')).toHaveCount(0)
  // Picking the already-active account closes the menu and changes nothing.
  await stack.filter({ hasText: 'Grace' }).click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await expect(page.getByTestId('account-chip')).toContainText('grace@acme.example')
})

test('per-account view memory: each account is restored to where it was left — section page and open thread alike', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')
  await stackSeedAccounts(page)
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')

  // ── Grace parks on the Projects SECTION page, and explicitly expands a
  //    tree section (chevron state persists per account too) ──
  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand Artifacts' }).click()
  await expect(page.getByRole('button', { name: 'Collapse Artifacts' })).toBeVisible()

  // ── Switch to Ada; she has no memory yet → the fresh draft; open a THREAD ──
  await switchTo(page, 'Ada Lovelace', 'Ada Lovelace')
  await expect(page.getByText('What should we work on?')).toBeVisible({ timeout: ms(5_000) })
  await page.getByRole('button', { name: 'Expand Recents' }).click()
  await page.getByRole('button', { name: 'Refactor auth middleware' }).first().click()
  await expect(page.getByText('What should we work on?')).toHaveCount(0)

  // ── Back to Grace: her Projects page is RESTORED (not the draft), and her
  //    tree still shows Artifacts expanded ──
  await switchTo(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: ms(5_000) })
  await expect(page.getByText('What should we work on?')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Collapse Artifacts' })).toBeVisible()

  // ── Back to Ada: her THREAD is restored, mid-conversation, not a draft ──
  await switchTo(page, 'Ada Lovelace', 'Ada Lovelace')
  await expect(page.getByText('What should we work on?')).toHaveCount(0, { timeout: ms(5_000) })
  await expect(page.locator('aside').getByText('Refactor auth middleware').first()).toBeVisible()

  // ── The memory also survives a RELOAD (same account, same place) ──
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await expect(page.getByText('What should we work on?')).toHaveCount(0, { timeout: ms(5_000) })
})
