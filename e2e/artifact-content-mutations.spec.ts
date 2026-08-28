/** Rendered cross-device recovery for durable artifact body edits. */
import { test, expect } from '@playwright/test'
import { docBlockText, type ArtifactContentLibrary, type ArtifactItem } from '../contract/index.ts'
import { ms } from './budget.ts'

test('a stale body edit loads the other device change and retries one held draft', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const artifacts = await (await page.request.get('/api/v1/artifacts')).json() as ArtifactItem[]
  const library = await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const target = artifacts.find((artifact) => {
    const body = library[artifact.id] ?? library[artifact.name]
    return artifact.own !== false && body?.type === 'doc' && body.blocks.filter((block) => docBlockText(block) !== undefined).length >= 2
  })
  expect(target).toBeTruthy()
  const artifact = target!
  const body = library[artifact.id] ?? library[artifact.name]
  expect(body?.type).toBe('doc')
  if (!body || body.type !== 'doc') throw new Error('fixture must expose an editable document')
  const patchable = body.blocks
    .map((block, index) => ({ index, text: docBlockText(block) }))
    .filter((entry): entry is { index: number; text: string } => entry.text !== undefined)
  const remote = patchable[0]!
  const local = patchable[1]!
  const revision = body.revision ?? 0
  const stamp = Date.now().toString(36)
  const remoteText = `${remote.text} Remote ${stamp}.`
  const localText = `${local.text} Local ${stamp}.`

  let attempts = 0
  const keys: string[] = []
  await page.route(`**/api/v1/artifacts/${artifact.id}/content`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/artifacts/${artifact.id}/content`, {
        data: { block: remote.index, text: remoteText, expectedRevision: revision },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/artifacts/${artifact.id}`)
  const artifactPage = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await expect(artifactPage).toBeVisible({ timeout: ms(20_000) })
  await artifactPage.getByRole('button', { name: `Edit block ${local.index + 1}` }).click()
  const editor = artifactPage.getByRole('textbox', { name: `Rewrite block ${local.index + 1}` })
  await editor.fill(localText)
  await artifactPage.getByRole('button', { name: 'Save', exact: true }).click()

  const failed = page.locator('[data-artifact-content-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(artifactPage.getByText(remoteText)).toBeVisible()
  await expect(editor).toBeDisabled()
  await expect(artifactPage.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(artifactPage.getByText(remoteText)).toBeVisible()
  await expect(artifactPage.getByText(localText)).toBeVisible()
  await expect(editor).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])

  const stored = await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const landed = stored[artifact.id] ?? stored[artifact.name]
  expect(landed?.revision).toBe(revision + 2)
  if (!landed || landed.type !== 'doc') throw new Error('stored artifact body must remain a document')
  expect(docBlockText(landed.blocks[remote.index]!)).toBe(remoteText)
  expect(docBlockText(landed.blocks[local.index]!)).toBe(localText)
})
