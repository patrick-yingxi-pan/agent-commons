import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { collectionEmptyCopy } from './collectionEmpty.ts'

test('collection empty copy distinguishes first use from a filtered miss', () => {
  assert.equal(collectionEmptyCopy('sessions', 0), 'No sessions yet — choose New session to begin.')
  assert.equal(collectionEmptyCopy('sessions', 4), 'No sessions match these filters.')
  assert.equal(
    collectionEmptyCopy('artifacts', 0),
    'No artifacts yet — choose New artifact or save work from a conversation.',
  )
  assert.equal(collectionEmptyCopy('artifacts', 1), 'No artifacts match.')
  assert.equal(collectionEmptyCopy('routines', 0), 'No routines yet — choose New routine to begin.')
  assert.equal(collectionEmptyCopy('routines', 2), 'No routines match.')
})

test('main and rail collection projections consume the one empty-copy funnel', () => {
  const component = (name: string) => stripComments(read(join(ROOT, 'src', 'components', name)))
  const sectionView = component('SectionView.tsx')
  const sidebar = component('Sidebar.tsx')
  const tree = component('SectionTreeChildren.tsx')
  const artifactRail = component('ArtifactChildren.tsx')

  assert.match(sectionView, /collectionEmptyCopy\('sessions', sessions\.length\)/)
  assert.match(sectionView, /collectionEmptyCopy\('artifacts', artifacts\.length\)/)
  assert.match(sectionView, /collectionEmptyCopy\('routines', items\.length\)/)
  assert.match(sidebar, /collectionEmptyCopy\('sessions', sessions\.length\)/)
  assert.match(sidebar, /collectionEmptyCopy\('routines', routines\.length\)/)
  assert.match(artifactRail, /collectionEmptyCopy\('artifacts', artifacts\.length\)/)
  assert.match(tree, /DeferredArtifactChildren/,
    'the rail consumes the deferred body that owns the shared empty-copy decision')
})
