import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('canonical Artifact history is owner-only, lazy, bounded, and previews an immutable body override', () => {
  const page = read('./artifactPreview.tsx')
  const historySection = read('./ArtifactHistorySection.tsx')
  const panel = read('./ArtifactHistoryPanel.tsx')
  assert.match(historySection, /const Panel = lazy\(loadHistoryPanel\)/)
  assert.match(historySection, /Promise\.all\([\s\S]*import\('\.\/ArtifactHistoryPanel'\)[\s\S]*import\('\.\/ShellMutationNotices'\)/,
    'restore controls are admitted only after the same deferred shell recovery module loads')
  assert.match(page, /own && artifact\.kind !== 'image' && <ArtifactHistorySectionBoundary/)
  assert.match(historySection, /onClick=\{\(\) => setOpened\(true\)\}>Load history/)
  assert.match(page, /<ArtifactHistorySectionBoundary key=\{artifact\.id\}>[\s\S]*DeferredArtifactHistorySection/)
  assert.match(page, /class ArtifactHistorySectionBoundary[\s\S]*<Suspense fallback=/)
  assert.match(page, /allowRestore=\{!inTrash && !lifecycleHeld\}/, 'Trash history is inspectable but never offers a body restore')
  assert.match(panel, /data-artifact-history-version=\{version\.revision\}/)
  assert.match(panel, /data-artifact-history-body/)
  assert.match(panel, /bodyOverride=\{selectedVersion\.body\}/)
  assert.match(page, /useArtifactContent\(!bodyOverride\)/, 'a history preview does not fetch the live current body')
  assert.match(panel, /data-artifact-history-reload="true"/)
  assert.match(panel, /Retry history load/)
  assert.match(panel, /Retry version load/)
  const events = read('../api/events.ts')
  const artifactChanged = events.slice(events.indexOf("case 'artifact.changed':"), events.indexOf("case 'agent.changed':"))
  assert.match(artifactChanged, /invalidatePrefix\(`artifact-history:\$\{e\.artifactId\}`\)/, 'a loaded history list and selected version refresh on body SSE')
})

test('restore consent freezes the reviewed CAS revision and account-scopes late UI effects', () => {
  const panel = read('./ArtifactHistoryPanel.tsx')
  assert.match(panel, /setReview\(\{ targetRevision: selectedVersion\.revision, expectedRevision: currentRevision \}\)/)
  assert.match(panel, /enqueueArtifactHistoryRestore\(artifactId, target, expected, sourceUserId\)/)
  assert.match(panel, /title="Restore artifact version"/)
  assert.match(panel, /confirmLabel="Restore version"/)
  assert.match(panel, /accountGeneration\(\) !== submittedScope\.generation/)
  assert.match(panel, /currentRevision !== review\.expectedRevision/)
  const controller = read('../controller/artifactHistoryMutations.ts')
  assert.match(controller, /holdArtifactHistoryRestore\(artifactId\)/)
  assert.match(controller, /artifactEditDrafts\.get\(artifactId\)/)
  assert.match(controller, /heldArtifactLifecycle\(artifactId\)/)
  assert.match(controller, /clearArtifactHistoryRestoreHolds\(\)/)
  assert.match(controller, /return false/, 'read-only metadata resemblance cannot settle an uncertain mutation')
  assert.match(read('./ArtifactHistoryRestoreMutationNotice.tsx'), /data-artifact-history-restore-status=/)
})
