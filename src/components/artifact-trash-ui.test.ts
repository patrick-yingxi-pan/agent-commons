import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('Artifact Trash is one owner-only canonical lifecycle and shared recovery projection', () => {
  const page = read('./artifactPreview.tsx')
  assert.match(page, /if \(inTrash \|\| lifecycleHeld\) return/)
  assert.match(page, /useArtifactContent\(!inTrash && !lifecycleHeld\)/)
  assert.match(page, /own && !lifecycleHeld && <button/)
  assert.match(page, /<ConfirmDialog title="Move artifact to Trash\?"/)
  assert.match(page, /enqueueArtifactLifecycle\(trashReview\.artifact, 'trashed', trashReview\.sourceUserId\)/)
  assert.match(page, /setTrashReview\(\{ artifact: structuredClone\(artifact\), sourceUserId \}\)/)
  assert.match(page, /draftState !== undefined/)
  for (const file of ['./SectionView.tsx', './ArtifactChildren.tsx']) {
    const projection = read(file)
    assert.match(projection, /artifactTrashProjection\(rel\.allArtifacts\(\), trashQ\.data \?\? \[\], heldArtifactLifecycles\(\)\.map/)
    assert.match(projection, /useArtifactLifecycleStatus\(\)/)
    assert.match(projection, /artifactCollectionSections\([^\n]+library\.trashed/)
  }
  assert.match(read('./ShellMutationNotices.tsx'), /<ArtifactLifecycleMutationNotice \/>/)
})

test('lifecycle visibility refresh reaches social caches without disclosing the private artifact', () => {
  const events = read('../api/events.ts')
  const body = events.slice(events.indexOf("case 'social-access.changed':"), events.indexOf("case 'grant.changed':"))
  for (const key of ['grants', 'discussions', 'discussion', 'socialProposals', 'socialProposal', 'notifications', 'commons', 'search']) {
    assert.ok(body.includes(`keys.${key}`), `${key} heals when nested access is suspended or restored`)
  }
  assert.ok(!body.includes('e.artifactId'), 'nested reader never needs the root identity')
})
