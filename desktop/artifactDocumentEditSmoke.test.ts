import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('Document native acceptance and the stopped-profile fixture never ship', () => {
  for (const name of ['artifactDocumentEditSmoke', 'artifactDocumentMigrationFixture']) {
    assert.equal(ignoreFromPackage(`/desktop/${name}.mjs`), true)
  }
})

test('packaged Document acceptance uses rendered whole-body Save and exact identity checks', () => {
  const helper = source('./artifactDocumentEditSmoke.mjs')
  for (const action of ['Edit document', 'Add heading', 'Add paragraph', 'Add bullet list', 'Add code block', 'Add email header',
    'Move block 2 up', 'Delete block 2', 'Save changes']) assert.ok(helper.includes(`name: '${action}'`), action)
  for (const proof of [
    'assert.deepEqual(response.request().postDataJSON(), { content: expectedBody, expectedRevision }',
    'assert.deepEqual(await response.json(), { ...expectedBody, revision: expectedRevision + 1 })',
    'assert.deepEqual(ids.slice(0, 2), [targetId, neighborId])',
    "toHaveAttribute('data-artifact-anchor-state', 'attached')",
    "toHaveAttribute('data-artifact-anchor-state', 'deleted')",
    "toContainText('original block deleted')",
    'await expect(target).toHaveClass(/ring-co\\/40/)',
    'assert.deepEqual(rows, { body: edited.body, history: edited.history, discussion: edited.discussion }',
  ]) assert.ok(helper.includes(proof), proof)
  assert.doesNotMatch(helper, /_electron|use-mock-keychain|store\.\w+\(/)
})

test('migration staging occurs only after ordinary host stop, before one independent relaunch', () => {
  const parent = source('./artifactHistorySmoke.mjs')
  const stopped = parent.indexOf("await assert.rejects(fetch(`${oldOrigin}/api/v1/me`")
  const staging = parent.indexOf('stageLegacyDocumentMigration(profile, documentFixtures.legacy)')
  const reopened = parent.indexOf('run = await launch(executable, profile)', staging)
  const verification = parent.indexOf('await verifyDocumentMigrationSmoke(', reopened)
  assert.ok(stopped > 0 && staging > stopped && reopened > staging && verification > reopened)
  assert.ok(parent.includes("fixture: documentFixtures, evidenceDirectory, phase: 'before-relaunch'"))
  assert.ok(parent.includes("fixture: documentFixtures, evidenceDirectory, phase: 'after-relaunch'"))
  assert.ok(parent.includes('documentMigration: documentMigrationProof'))
  const helper = source('./artifactDocumentEditSmoke.mjs')
  for (const proof of [
    'assert.deepEqual(readDocumentSmokeRows(profile, fixture.legacy), expected',
    "toHaveAttribute('data-artifact-anchor-state', 'legacy')",
    "toContainText('original block unavailable')",
    'assert.deepEqual(after.history.slice(0, 3), expected.history',
    'assert.deepEqual(after.history.map(version => version.revision), [0, 1, 2, 3])',
    'assert.deepEqual(after.discussion, expected.discussion)',
  ]) assert.ok(helper.includes(proof), proof)
})
