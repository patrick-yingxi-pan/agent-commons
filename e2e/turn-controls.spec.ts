/** The live-turn affordances (multi-account design §6.5, built in P6c): the
 *  STOP button cancels the SERVER-owned turn mid-stream — the partial persists
 *  as the record and the streaming state stands down. (The cancel route's
 *  semantics are node-locked in tests/routes-turns.test.ts; this locks the UI
 *  wiring: button → cancelTurn → stream end → coherent thread.) */
import { test, expect, type Page } from '@playwright/test'

const STAMP = Date.now().toString(36)
const PACED_MESSAGE = `paced stop me please ${STAMP}`

test('Stop mid-stream: the partial persists, the streaming state stands down', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session' }).click()

  await page.getByPlaceholder('Reply to Claude…').fill(PACED_MESSAGE)
  await page.keyboard.press('Enter')

  // Mid-stream: the stop affordance is up and some text has arrived.
  await expect(page.getByText('Claude is writing…')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/free-form chat is canned/).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  // The affordance stands down (the stream's own message.end cleared it).
  await expect(page.getByText('Claude is writing…')).toHaveCount(0, { timeout: 10_000 })

  // The RECORD holds the cancelled partial: one user turn + one (truncated)
  // assistant turn — shorter than the full canned reply, which ends "…digest.".
  const list = await (await page.request.get('/api/v1/sessions')).json()
  const session = list.find((s: { title: string }) => s.title.startsWith(PACED_MESSAGE.slice(0, 20)))
  expect(session, 'the session exists').toBeTruthy()
  await expect
    .poll(async () => {
      const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
      return {
        roles: (full.messages ?? []).map((m: { role: string }) => m.role),
        live: full.activeTurnId ?? null,
      }
    })
    .toEqual({ roles: ['user', 'assistant'], live: null })
  const full = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(full.messages[1].content.length).toBeGreaterThan(0)
  // `toContain` takes ONE argument — a second string is silently discarded, so
  // this explanation never reached a failure report. Carried as a soft assertion
  // message instead, which is where Playwright actually shows it.
  expect(full.messages[1].content, 'the reply was cut short — a partial, not the full text').not.toContain('digest')
})
