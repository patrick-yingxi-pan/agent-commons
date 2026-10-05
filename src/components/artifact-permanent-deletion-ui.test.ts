import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('permanent deletion requires a frozen owner-only Trash preview before explicit consent', () => {
  const section = read('./ArtifactPermanentDeletionSection.tsx')
  assert.match(section, /readArtifactDeletionPreview\(frozenArtifact\.id, source\)/)
  assert.match(section, /setReview\(\{ artifact: frozenArtifact, preview: structuredClone\(preview\), sourceUserId: source, generation: issued\.generation \}\)/)
  assert.match(section, /preview\.lifecycleRevision !== \(frozenArtifact\.lifecycleRevision \?\? 0\)/)
  assert.match(section, /<ConfirmDialog[\s\S]*title="Delete artifact permanently\?"/)
  assert.match(section, /confirmLabel="Delete permanently"/)
  assert.match(section, /enqueueArtifactPermanentDeletion\(review\.artifact, review\.preview, review\.sourceUserId\)/)
  assert.match(section, /data-artifact-permanent-delete-open="true"/)
  assert.match(section, /Old save retries and routine runs will not recreate this artifact/)
  assert.match(section, /Conversations and audit records stay/)
  assert.match(section, /Existing backups may still contain this artifact/)
  assert.match(section, /There is no Undo/)
  for (const cascade of ['retained version', 'share', 'artifact-only discussion', 'proposal']) {
    assert.ok(section.includes(cascade), `${cascade} is named in the reviewed deletion scope`)
  }
})

test('recovery is admitted before deletion, Trash detail disables competing restore, and stale rows remain recoverable', () => {
  const deferred = read('./DeferredArtifactPermanentDeletionSection.tsx')
  assert.match(deferred, /Promise\.all\([\s\S]*import\('\.\/ArtifactPermanentDeletionSection'\)[\s\S]*import\('\.\/ShellMutationNotices'\)/)
  assert.match(deferred, /section\.ArtifactPermanentDeletionSection/)
  assert.match(deferred, /DeletionSectionBoundary/)
  const page = read('./artifactPreview.tsx')
  assert.match(page, /if \(inTrash \|\| lifecycleHeld \|\| permanentDeletionHeld\) return/)
  assert.match(page, /disabled=\{!identity \|\| historyRestoreHeld \|\| permanentDeletionHeld\}/)
  assert.match(page, /own && inTrash && !lifecycleHeld && identity/)
  assert.match(page, /useArtifactContent\(!inTrash && !lifecycleHeld\)/)
  const notices = read('./ShellMutationNotices.tsx')
  assert.match(notices, /<ArtifactPermanentDeletionMutationNotice \/>/)
  const controller = read('../controller/artifactPermanentDeletionMutations.ts')
  assert.match(controller, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(controller, /discardReconcileFailure: 'retain'/)
  assert.match(controller, /expectedLifecycleRevision: intent\.preview\.lifecycleRevision/)
})
