/** Full Document editing inside the ordinary packaged history/account lifecycle.
 * Fixture preparation uses public APIs; edits and discussion arrivals use the
 * built renderer. No helper or database fixture ships in the application. */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { docBlockId } from '../server/documentIdentity.ts'
import { STORE_VERSION } from '../server/persistence/format.ts'
import { readDocumentSmokeRows, expectedMigratedDocumentRows } from './artifactDocumentMigrationFixture.mjs'

const TIMEOUT_MS = 30_000
const detail = (page, id) => page.locator(`[data-artifact-page="${id}"]`)

async function currentBody(page, request, id) {
  const bodies = await request(page, '/artifact-content')
  assert.equal(bodies[id]?.type, 'doc', 'the exact saved Artifact has a Document body')
  return bodies[id]
}

async function createDiscussion(page, request, artifactId, blockId, text) {
  return request(page, '/discussions', {
    anchor: { ref: { kind: 'artifact', id: artifactId }, locus: { kind: 'artifact-block', blockId } },
    firstPost: text,
  })
}

async function openEditor(page, origin, artifactId) {
  await page.goto(`${origin}/artifacts/${encodeURIComponent(artifactId)}`)
  const content = detail(page, artifactId)
  await expect(content).toBeVisible({ timeout: TIMEOUT_MS })
  await content.getByRole('button', { name: 'Edit document', exact: true }).click()
  const editor = content.locator('[data-document-artifact-editor]')
  await expect(editor).toBeVisible()
  return editor
}

async function saveEditor(page, editor, artifactId, expectedBody, expectedRevision) {
  const responsePromise = page.waitForResponse(incoming => incoming.request().method() === 'PATCH' &&
    new URL(incoming.url()).pathname === `/api/v1/artifacts/${encodeURIComponent(artifactId)}/content`)
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  const response = await responsePromise
  assert.equal(response.status(), 200, 'the packaged backend acknowledges the complete Document edit')
  assert.deepEqual(response.request().postDataJSON(), { content: expectedBody, expectedRevision },
    'the rendered Save sends the exact complete draft under its opening revision')
  assert.deepEqual(await response.json(), { ...expectedBody, revision: expectedRevision + 1 })
  await expect(editor).toHaveCount(0, { timeout: TIMEOUT_MS })
}

async function discussionChip(page, origin, discussion) {
  await page.goto(`${origin}/discussions/${encodeURIComponent(discussion.id)}`)
  await expect(page.getByRole('heading', { name: discussion.posts[0].body, exact: true }))
    .toBeVisible({ timeout: TIMEOUT_MS })
  const chip = page.locator('button[data-artifact-anchor-state]')
  await expect(chip).toBeVisible()
  return chip
}

export async function prepareDocumentEditSmoke({ page, origin, request, profile, stamp, evidenceDirectory }) {
  const originalTexts = ['Original block to delete.', 'Original block to move.', 'Unchanged neighboring block.']
  const created = await request(page, '/artifacts', {
    name: `Packaged block editing ${stamp}.md`, kind: 'doc', body: originalTexts.join('\n\n'),
  })
  const artifactId = created.artifact.id
  const original = await currentBody(page, request, artifactId)
  assert.deepEqual(original.blocks, originalTexts.map((p, index) => ({ p, id: docBlockId(artifactId, 0, index) })))
  const [deletedId, targetId, neighborId] = original.blocks.map(block => block.id)
  const attached = await createDiscussion(page, request, artifactId, targetId, `Moved original discussion ${stamp}`)
  const deleted = await createDiscussion(page, request, artifactId, deletedId, `Deleted original discussion ${stamp}`)
  const editor = await openEditor(page, origin, artifactId)
  const history = detail(page, artifactId).locator('[data-artifact-draft-history]')
  await expect(history).toBeVisible()
  const undo = history.getByRole('button', { name: 'Undo', exact: true })
  const redo = history.getByRole('button', { name: 'Redo', exact: true })
  const openingIds = original.blocks.map(block => block.id)
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  await editor.getByRole('button', { name: 'Add heading', exact: true }).click()
  const temporaryBlock = editor.locator('[data-doc-block-id]').last()
  const temporaryBlockId = await temporaryBlock.getAttribute('data-doc-block-id')
  assert.match(temporaryBlockId ?? '', /^block-[0-9a-f-]{36}$/)
  await expect(undo).toBeEnabled()
  await temporaryBlock.getByRole('textbox').press('Meta+z')
  assert.deepEqual(await editor.locator('[data-doc-block-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-doc-block-id'))), openingIds,
    'Undo removes the newly inserted block without changing original block identities')
  await expect(undo).toBeDisabled()
  await expect(redo).toBeEnabled()
  await history.press('Meta+Shift+z')
  assert.deepEqual(await editor.locator('[data-doc-block-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-doc-block-id'))), [...openingIds, temporaryBlockId],
    'Redo restores the same inserted block identity')
  await expect(editor.getByRole('textbox', { name: 'Block 4 heading', exact: true })).toHaveValue('')
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()
  await undo.click()
  assert.deepEqual(await editor.locator('[data-doc-block-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-doc-block-id'))), openingIds)

  const title = `Reviewed Document ${stamp}`
  const targetText = 'Reviewed text on the same moved block.'
  await editor.getByRole('textbox', { name: 'Document title', exact: true }).fill(title)
  await editor.getByRole('textbox', { name: 'Block 2 paragraph', exact: true }).fill(targetText)
  await editor.getByRole('button', { name: 'Add heading', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 4 heading', exact: true }).fill('Inserted native heading')
  await editor.getByRole('button', { name: 'Add paragraph', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 5 paragraph', exact: true }).fill('Inserted native paragraph')
  await editor.getByRole('button', { name: 'Add bullet list', exact: true }).click()
  const bullet = 'First bullet\nembedded newline remains in one item'
  await editor.getByRole('textbox', { name: 'Block 6 bullet 1', exact: true }).fill(bullet)
  await editor.getByRole('button', { name: 'Add bullet to block 6', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 6 bullet 2', exact: true }).fill('Second bullet')
  await editor.getByRole('button', { name: 'Add code block', exact: true }).click()
  const code = 'const exact = true\n  // preserve literal entry'
  await editor.getByRole('textbox', { name: 'Block 7 code line 1', exact: true }).fill(code)
  await editor.getByRole('button', { name: 'Add code line to block 7', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 7 code line 2', exact: true }).fill('return exact')
  await editor.getByRole('button', { name: 'Add email header', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 8 email recipient', exact: true }).fill('review@example.test')
  await editor.getByRole('textbox', { name: 'Block 8 email subject', exact: true }).fill('Reviewed native Document')
  await editor.getByRole('button', { name: 'Move block 2 up', exact: true }).click()
  await editor.getByRole('button', { name: 'Delete block 2', exact: true }).click()
  const ids = await editor.locator('[data-doc-block-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-doc-block-id')))
  assert.equal(ids.length, 7)
  assert.equal(new Set(ids).size, 7)
  assert.deepEqual(ids.slice(0, 2), [targetId, neighborId])
  assert.ok(!ids.includes(deletedId), 'deletion removes only the selected original identity')
  for (const id of ids.slice(2)) assert.match(id, /^block-[0-9a-f-]{36}$/)
  const content = { type: 'doc', title, blocks: [
    { id: targetId, p: targetText }, { id: neighborId, p: originalTexts[2] },
    { id: ids[2], h: 'Inserted native heading' }, { id: ids[3], p: 'Inserted native paragraph' },
    { id: ids[4], ul: [bullet, 'Second bullet'] }, { id: ids[5], code: [code, 'return exact'] },
    { id: ids[6], email: { to: 'review@example.test', subject: 'Reviewed native Document' } },
  ] }
  await page.screenshot({ path: join(evidenceDirectory, 'document-complete-editor.png'), fullPage: true })
  await saveEditor(page, editor, artifactId, content, 0)
  const body = { ...content, revision: 1 }
  assert.deepEqual(await currentBody(page, request, artifactId), body)
  const edited = { artifactId, discussionId: attached.id, targetId, neighborId, deletedId,
    ...readDocumentSmokeRows(profile, { artifactId, discussionId: attached.id }),
    deletedDiscussion: readDocumentSmokeRows(profile, { artifactId, discussionId: deleted.id }).discussion,
  }
  assert.deepEqual(edited.body, body, 'SQLite holds the exact UI-authored replacement')

  // A separate fixture models old stored data; the editor's real current body
  // and stable discussions remain identified and unchanged during migration.
  const legacyCreated = await request(page, '/artifacts', {
    name: `Legacy migration ${stamp}.md`, kind: 'doc', body: 'Legacy opening.\n\nLegacy neighbor.',
  })
  const legacyId = legacyCreated.artifact.id
  const initialLegacy = await currentBody(page, request, legacyId)
  await request(page, `/artifacts/${encodeURIComponent(legacyId)}/content`, {
    blockId: initialLegacy.blocks[0].id, text: 'Legacy intermediate edit.', expectedRevision: 0,
  }, 'PATCH')
  await request(page, `/artifacts/${encodeURIComponent(legacyId)}/history/0/restore`, { expectedRevision: 1 })
  const legacyDiscussion = await createDiscussion(page, request, legacyId, initialLegacy.blocks[0].id,
    `Legacy ordinal discussion ${stamp}`)
  const legacy = { artifactId: legacyId, discussionId: legacyDiscussion.id,
    ...readDocumentSmokeRows(profile, { artifactId: legacyId, discussionId: legacyDiscussion.id }),
  }
  assert.deepEqual(legacy.history.map(version => version.revision), [0, 1, 2])
  assert.equal(legacy.history[2].restoredFromRevision, 0)
  return { edited, legacy }
}

export async function verifyDocumentEditSmoke({ page, origin, request, profile, fixture, evidenceDirectory, phase }) {
  const { edited } = fixture
  assert.deepEqual(await currentBody(page, request, edited.artifactId), edited.body,
    `${phase}: exact edited content and all seven block IDs survive`)
  const rows = readDocumentSmokeRows(profile, edited)
  assert.deepEqual(rows, { body: edited.body, history: edited.history, discussion: edited.discussion },
    `${phase}: SQLite preserves body, retained versions and original discussion`)
  assert.deepEqual(readDocumentSmokeRows(profile, { artifactId: edited.artifactId,
    discussionId: edited.deletedDiscussion.id }).discussion, edited.deletedDiscussion)
  const chip = await discussionChip(page, origin, edited.discussion)
  await expect(chip).toHaveAttribute('data-artifact-anchor-state', 'attached')
  await chip.click()
  await expect(page).toHaveURL(`${origin}/artifacts/${encodeURIComponent(edited.artifactId)}`)
  const target = detail(page, edited.artifactId).locator(`[data-doc-block-id="${edited.targetId}"]`)
  await expect(target).toBeInViewport()
  await expect(target).toHaveClass(/ring-co\/40/)
  await expect(detail(page, edited.artifactId).locator(`[data-doc-block-id="${edited.neighborId}"]`)).not.toHaveClass(/ring-co\/40/)
  await page.screenshot({ path: join(evidenceDirectory, `${phase}-document-moved-discussion.png`) })
  const deletedChip = await discussionChip(page, origin, edited.deletedDiscussion)
  await expect(deletedChip).toHaveAttribute('data-artifact-anchor-state', 'deleted')
  await expect(deletedChip).toContainText('original block deleted')
  await page.screenshot({ path: join(evidenceDirectory, `${phase}-document-deleted-discussion.png`) })
  await deletedChip.click()
  await expect(page).toHaveURL(`${origin}/artifacts/${encodeURIComponent(edited.artifactId)}`)
  await expect(detail(page, edited.artifactId).locator(`[data-doc-block-id="${edited.deletedId}"]`)).toHaveCount(0)
  await expect(detail(page, edited.artifactId).locator(`[data-doc-block-id="${edited.neighborId}"]`)).not.toHaveClass(/ring-co\/40/)
}

export async function verifyDocumentMigrationSmoke({ page, origin, request, profile, fixture, legacyRows, evidenceDirectory }) {
  const expected = expectedMigratedDocumentRows(legacyRows, fixture.legacy.artifactId)
  assert.deepEqual(readDocumentSmokeRows(profile, fixture.legacy), expected,
    'ordinary startup migrates exact current/history data with revision-local IDs and exact restore lineage')
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    assert.equal(JSON.parse(database.prepare('SELECT json FROM kv WHERE key = ?').get('version').json), STORE_VERSION,
      'ordinary startup durably commits the current data version')
  } finally { database.close() }
  assert.deepEqual(await currentBody(page, request, fixture.legacy.artifactId), expected.body)
  const chip = await discussionChip(page, origin, expected.discussion)
  await expect(chip).toHaveAttribute('data-artifact-anchor-state', 'legacy')
  await expect(chip).toContainText('original block unavailable')
  await page.screenshot({ path: join(evidenceDirectory, 'after-relaunch-document-legacy-discussion.png') })
  await chip.click()
  await expect(page).toHaveURL(`${origin}/artifacts/${encodeURIComponent(fixture.legacy.artifactId)}`)
  for (const block of expected.body.blocks) {
    await expect(detail(page, fixture.legacy.artifactId).locator(`[data-doc-block-id="${block.id}"]`)).not.toHaveClass(/ring-co\/40/)
  }
  // Migration must leave an editable Document, not merely a readable snapshot.
  const editor = await openEditor(page, origin, fixture.legacy.artifactId)
  await editor.getByRole('textbox', { name: 'Block 1 paragraph', exact: true }).fill('Reviewed after migration.')
  const { revision, ...migratedContent } = expected.body
  const content = { ...migratedContent, blocks: migratedContent.blocks.map((block, index) =>
    index === 0 ? { ...block, p: 'Reviewed after migration.' } : block) }
  await saveEditor(page, editor, fixture.legacy.artifactId, content, revision)
  const after = readDocumentSmokeRows(profile, fixture.legacy)
  assert.deepEqual(after.body, { ...content, revision: 3 })
  assert.deepEqual(after.history.slice(0, 3), expected.history, 'post-migration editing never rewrites retained history')
  assert.deepEqual(after.history.map(version => version.revision), [0, 1, 2, 3])
  assert.deepEqual(after.history[3].body, content)
  assert.deepEqual(after.discussion, expected.discussion)
  await page.screenshot({ path: join(evidenceDirectory, 'after-relaunch-document-migrated-edit.png') })
  return { migratedArtifactId: fixture.legacy.artifactId, migratedVersion: STORE_VERSION,
    legacyDiscussionUnresolved: true, restoreIdentityPreserved: true, postMigrationRevision: 3 }
}
