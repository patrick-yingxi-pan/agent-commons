/** Context acknowledgements can collapse the split tree. Unsent text must
 * belong to its conversation, not the lifetime of the rendered textarea. */
import { test, expect } from '@playwright/test'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

test('multiline drafts survive context-pane collapse at every viewport and send exactly once', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  let release: (() => void) | undefined
  let held = false
  let sends = 0
  await page.route('**/api/v1/sessions/*/context-state', async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    held = true
    await new Promise<void>(resolve => { release = resolve })
    await route.continue()
  })
  page.on('request', request => {
    if (request.method() === 'POST' && /\/sessions\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) sends++
  })
  try {
    for (const [width, height] of [[320, 700], [375, 812], [768, 1024], [844, 390], [1280, 800]]) {
      await page.setViewportSize({ width, height })
      const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: `Composer recovery ${width}` } })
      expect(created.ok()).toBe(true)
      const { id } = await created.json() as { id: string }
      const attached = await page.request.patch(`/api/v1/sessions/${id}/context-state`, { data: {
        operations: [],
        workspace: {
          workspaces: [{ id: `ws-recovery-${width}`, label: 'recovery/', artifacts: [{
            id: `note-${width}`, name: 'recovery.md', kind: 'doc', meta: 'fixture',
            source: { id: `ui-host::recovery-${width}`, label: 'recovery/' },
            localSnapshot: { text: 'Explicit context fixture for the acknowledged detach.' },
          }] }], repos: [], connectors: [], attachments: [],
        },
      } })
      expect(attached.ok()).toBe(true)
      // An open phone preview makes the composer inert. Start closed so
      // typing exercises an actual user-accessible field, not DOM injection.
      const preference = await page.request.patch(`/api/v1/sessions/${id}/preferences`, { data: { panelFocus: null } })
      expect(preference.ok()).toBe(true)
      await page.goto(`/s/${id}`)
      const composer = page.getByRole('textbox', { name: 'Message', exact: true })
      await composer.click()
      const draft = `Draft across detach ${width}\nSecond line · café 世界\n${'Long continuation '.repeat(12)}`
      await composer.fill(draft)
      await expect(composer).toHaveValue(draft)
      await page.getByRole('button', { name: 'recovery/', exact: true }).click()
      held = false
      await page.getByRole('button', { name: /Remove .*workspace/ }).first().click()
      await page.getByText('Remove this folder from the workspace?', { exact: true }).locator('..')
        .getByRole('button', { name: 'Remove', exact: true }).click()
      await expect.poll(() => held).toBe(true)
      release!()
      await expect(page.getByRole('button', { name: /Remove .*workspace/ })).toHaveCount(0)
      await composer.click()
      await expect(composer).toHaveValue(draft)
      if (width === 1280) {
        // Actual SPA navigation: memory-only drafts make no reload claim.
        const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true })
        if (await expandSidebar.isVisible()) await expandSidebar.click()
        await page.getByRole('navigation', { name: 'Sections', exact: true })
          .getByRole('button', { name: 'Projects', exact: true }).click()
        await expect(page).toHaveURL(/\/projects$/)
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`/s/${id}$`))
        await expect(composer).toHaveValue(draft)
      }
      await composer.fill(`${draft}\nContinued after acknowledgement`)
      const sentText = await composer.inputValue()
      await assertWcag22Aa(page, `Recovered multiline draft ${width}×${height}`)
      await page.screenshot({ path: testInfo.outputPath(`composer-recovered-${width}.png`), fullPage: true })
      const before = sends
      await composer.press('Enter')
      await expect.poll(() => sends).toBe(before + 1)
      await expect(composer).toHaveValue('')
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
      await expect.poll(async () => {
        const session = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
        return session.messages.filter((message: { role: string }) => message.role === 'user').map((message: { content: string }) => message.content)
      }).toEqual([sentText])
      expect(sends).toBe(before + 1)
    }
  } finally { release?.() }
  expect(sends).toBe(5)
})
