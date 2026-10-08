/** Current-body search acceptance inside the ordinary history smoke's real
 * account/profile lifecycle. No model, native fixture, or production authority. */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { docBlockId } from '../server/documentIdentity.ts'

const TIMEOUT_MS = 30_000

export async function prepareArtifactSearchSmoke({ page, request, stamp }) {
  const documentName = `Packaged search document ${stamp}`
  const opening = 'Opening context. '.repeat(32).trim()
  const paragraph = `A later paragraph contains documentneedle${stamp}.`
  const fixtures = [
    {
      label: 'document', name: `${documentName}.md`, kind: 'doc',
      input: `${opening}\n\n${paragraph}`, query: `documentneedle${stamp}`, field: 'doc.block.1.p',
      body: { type: 'doc', title: documentName, blocks: [{ p: opening }, { p: paragraph }], revision: 0 },
    },
    {
      label: 'sheet', name: `Packaged search sheet ${stamp}.xlsx`, kind: 'sheet',
      query: `sheetneedle${stamp}`, field: 'sheet.cell.1.1',
      body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Opening', 'Ordinary'], ['Later', `sheetneedle${stamp}`]], revision: 0 },
    },
    {
      label: 'workbook', name: `Packaged search workbook ${stamp}.xlsx`, kind: 'sheet',
      query: `workbookneedle${stamp}`, field: 'workbook.1.cell.0.1',
      body: { type: 'workbook', revision: 0, sheets: [
        { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Opening', 'Ordinary']] },
        { id: 'details', name: 'Details', columns: ['Metric', 'Value'], rows: [['Later', `workbookneedle${stamp}`]] },
      ] },
    },
    {
      label: 'slides', name: `Packaged search slides ${stamp}.pptx`, kind: 'slide',
      query: `slidesneedle${stamp}`, field: 'slides.1.bullet.1',
      body: { type: 'slides', revision: 0, slides: [
        { title: 'Opening', bullets: ['Ordinary introduction'] },
        { title: 'Details', bullets: ['Other detail', `slidesneedle${stamp}`] },
      ] },
    },
  ]
  for (const fixture of fixtures) {
    const { revision: _revision, ...structured } = fixture.body
    const created = await request(page, '/artifacts', {
      name: fixture.name, kind: fixture.kind, body: fixture.input ?? structured,
    })
    assert.equal(created.artifact.name, fixture.name)
    fixture.id = created.artifact.id
    if (fixture.label === 'document') {
      fixture.body.blocks.forEach((block, index) => { block.id = docBlockId(fixture.id, 0, index) })
    }
    fixture.path = `/artifacts/${encodeURIComponent(fixture.id)}/match/0/${fixture.field}`
  }
  const bodies = await request(page, '/artifact-content')
  for (const fixture of fixtures) assert.deepEqual(bodies[fixture.id], fixture.body,
    `the packaged API saves the exact generated ${fixture.label} body`)
  return fixtures
}

export function readSqliteSearchBodies(profile, fixtures) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const statement = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?')
    return Object.fromEntries(fixtures.map(fixture => {
      const row = statement.get('artifactBodies', fixture.id)
      assert.ok(row, `SQLite retains the exact ${fixture.label} identity`)
      const body = JSON.parse(row.json)
      assert.deepEqual(body, fixture.body, `SQLite retains the exact ${fixture.label} body`)
      return [fixture.id, body]
    }))
  } finally { database.close() }
}

function detail(page, id) { return page.locator(`[data-artifact-page="${id}"]`) }

async function assertMatch(page, fixture) {
  const content = detail(page, fixture.id)
  await expect(content.locator('[data-artifact-search-reveal="ready"]')).toBeVisible({ timeout: TIMEOUT_MS })
  const match = content.locator('[data-artifact-search-match="true"]')
  await expect(match).toHaveCount(1)
  await expect(match).toHaveAttribute('data-artifact-search-field', fixture.field)
  await expect(match).toContainText(fixture.query)
  await expect(match).toBeFocused()
  await expect.poll(() => match.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const region = element.closest('[aria-label="Sheet preview"]')?.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight &&
      rect.left >= 0 && rect.right <= innerWidth &&
      (!region || (rect.left >= region.left && rect.right <= region.right))
  }), { message: `${fixture.label} match is inside its visible reading region` }).toBe(true)
  await expect(content.locator('[data-artifact-history-body]')).toHaveCount(0)
  return content
}

export async function verifyArtifactSearchSmoke({ page, origin, request, fixtures, evidenceDirectory, phase }) {
  const mutations = []
  const historyReads = []
  const observe = outgoing => {
    const path = new URL(outgoing.url()).pathname
    if ((path === '/api/v1/artifacts' || path.startsWith('/api/v1/artifacts/')) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(outgoing.method())) {
      mutations.push(`${outgoing.method()} ${path}`)
    }
    if (outgoing.method() === 'GET' && /^\/api\/v1\/artifacts\/[^/]+\/history(?:\/|$)/.test(path)) historyReads.push(path)
  }
  page.on('request', observe)
  try {
    await page.goto(`${origin}/artifacts`)
    for (const fixture of fixtures) {
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      const input = page.getByRole('textbox', { name: 'Search everything' })
      await input.fill(fixture.query)
      const hit = page.locator(`[data-search-result="artifact-${fixture.id}"]`)
      await expect(hit).toBeVisible({ timeout: TIMEOUT_MS })
      await expect(hit).toHaveAttribute('data-search-active', 'true')
      await expect(hit).toContainText(fixture.query)
      await input.press('Enter')
      await expect(page).toHaveURL(`${origin}${fixture.path}`)
      const content = await assertMatch(page, fixture)
      if (fixture.label === 'workbook') {
        await expect(content.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true')
        await content.getByRole('tab', { name: 'Overview', exact: true }).click()
        await expect(content.getByRole('tabpanel')).not.toContainText(fixture.query)
        await content.getByRole('button', { name: 'Show match', exact: true }).click()
        await assertMatch(page, fixture)
      }
      await page.screenshot({ path: join(evidenceDirectory, `${phase}-current-${fixture.label}.png`) })
      await page.reload()
      await expect(page).toHaveURL(`${origin}${fixture.path}`)
      await assertMatch(page, fixture)
    }
    // The last arrival is Slides; Back must recover the preceding workbook's
    // field and tab rather than its ordinary first-tab resource destination.
    const workbook = fixtures.find(fixture => fixture.label === 'workbook')
    assert.ok(workbook)
    await page.goBack()
    await expect(page).toHaveURL(`${origin}${workbook.path}`)
    await assertMatch(page, workbook)
    const bodies = await request(page, '/artifact-content')
    for (const fixture of fixtures) assert.deepEqual(bodies[fixture.id], fixture.body,
      `${phase} navigation leaves the exact ${fixture.label} body unchanged`)
    assert.deepEqual(mutations, [], 'current search, reveal, tab navigation, reload and Back do not mutate Artifacts')
    assert.deepEqual(historyReads, [], 'current search never reads private saved versions')
  } finally { page.off('request', observe) }
}

export async function verifyStaleArtifactSearchSmoke({ page, origin, artifactId, oldRevision, expectedText, evidenceDirectory, phase }) {
  await page.goto(`${origin}/artifacts/${encodeURIComponent(artifactId)}/match/${oldRevision}/doc.block.0.p`)
  const content = detail(page, artifactId)
  await expect(content.locator('[data-artifact-search-reveal="stale"]'))
    .toContainText('This artifact changed since this search result.')
  await expect(content.locator('[data-artifact-search-match]')).toHaveCount(0)
  await expect(content.locator('[data-resource-section="Content"]')).toContainText(expectedText)
  await expect(content.locator('[data-artifact-history-body]')).toHaveCount(0)
  await page.screenshot({ path: join(evidenceDirectory, `${phase}-stale-current-match.png`) })
}
