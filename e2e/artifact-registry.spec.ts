/** Authored artifacts have one canonical list identity across UI and sharing. */
import { test, expect } from '@playwright/test'
import type { ArtifactItem, Grant } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

test('authored document stays unique and a live grant opens and closes its canonical page', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  for (const user of [owner, reader, foreign]) user.page.setDefaultTimeout(ms(15_000))
  const name = `registry-${Date.now().toString(36)}.md`
  const body = 'An authored document shared from the canonical artifact registry.'
  try {
    await owner.page.goto('/artifacts')
    await owner.page.getByRole('button', { name: 'New document' }).click()
    const dialog = owner.page.getByRole('dialog', { name: 'New document' })
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Content').fill(body)
    await dialog.getByRole('button', { name: 'Create document' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(owner.page).toHaveURL(/\/artifacts\/[^/]+$/)
    const id = owner.page.url().split('/').at(-1)!
    const rows = await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
    expect(rows.filter(row => row.id === id)).toHaveLength(1)
    const artifactPage = `[data-artifact-page="${id}"]`
    await expect(owner.page.locator(artifactPage).getByRole('button', { name: 'Edit block 1' })).toBeVisible()

    // Read the missing target before sharing. SSE must heal this already-open
    // page; reloading it would mask an omitted grant invalidation.
    await reader.page.goto(`/artifacts/${id}`)
    await expect(reader.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    const granted = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(granted.ok()).toBeTruthy()
    const grant = await granted.json() as Grant
    await expect(reader.page.locator(artifactPage).locator('p', { hasText: body })).toBeVisible()

    for (const viewport of [
      { width: 320, height: 700 }, { width: 375, height: 812 },
      { width: 768, height: 1024 }, { width: 844, height: 390 },
      { width: 1280, height: 800 },
    ]) {
      for (const [role, user] of [['owner', owner], ['reader', reader]] as const) {
        await user.page.setViewportSize(viewport)
        await user.page.goto('/artifacts')
        const synopsis = user.page.locator('[data-artifact-preview-row]').filter({ has: user.page.getByRole('button', { name, exact: true }) })
        await expect(synopsis).toHaveCount(1)
        if (viewport.width === 1280) {
          const reopen = user.page.getByRole('button', { name: 'Expand sidebar', exact: true })
          if (await reopen.count()) await reopen.click()
          const root = user.page.locator('nav[aria-label="Sections"] [data-rail-node-key="section/artifacts"]')
          const expand = root.getByRole('button', { name: 'Expand Artifacts', exact: true })
          if (await expand.count()) await expand.click()
          const unfiled = root.getByRole('button', { name: 'Expand Unfiled', exact: true })
          if (await unfiled.count()) await unfiled.click()
          await expect(root.getByRole('button', { name, exact: true })).toHaveCount(1)
        }
        await synopsis.scrollIntoViewIfNeeded()
        await user.page.screenshot({ path: testInfo.outputPath(`artifact-index-${role}-${viewport.width}x${viewport.height}.png`) })
        await synopsis.getByRole('button', { name, exact: true }).click()
        await expect(user.page).toHaveURL(new RegExp(`/artifacts/${id}$`))
        const detail = user.page.locator(artifactPage)
        await expect(detail.locator('p', { hasText: body })).toBeVisible()
        await expect(detail.getByRole('button', { name: 'Edit block 1' })).toHaveCount(role === 'owner' ? 1 : 0)
        await user.page.screenshot({ path: testInfo.outputPath(`artifact-${role}-${viewport.width}x${viewport.height}.png`) })
      }
      await foreign.page.setViewportSize(viewport)
      await foreign.page.goto(`/artifacts/${id}`)
      await expect(foreign.page.locator(artifactPage)).toHaveCount(0)
      await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    }

    await reader.page.reload()
    await expect(reader.page.locator(artifactPage).locator('p', { hasText: body })).toBeVisible()
    const revoked = await owner.page.request.delete(`${API}/grants/${grant.id}`)
    expect(revoked.ok()).toBeTruthy()
    await expect(reader.page.locator(artifactPage)).toHaveCount(0)
    await expect(reader.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(owner.page.locator(artifactPage).locator('p', { hasText: body })).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
