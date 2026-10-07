import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { shouldReadCurrentArtifactBody } from './artifactBodyRead.ts'

test('only a live, unheld current-body surface admits the current library read', () => {
  assert.equal(shouldReadCurrentArtifactBody(), true)
  for (const addressedRevision of [undefined, 0, 7]) {
    for (const hasBodyOverride of [false, true]) {
      for (const inTrash of [false, true]) {
        for (const lifecycleHeld of [false, true]) {
          const scope = { addressedRevision, hasBodyOverride, inTrash, lifecycleHeld }
          assert.equal(shouldReadCurrentArtifactBody(scope),
            addressedRevision === undefined && !hasBodyOverride && !inTrash && !lifecycleHeld,
            JSON.stringify(scope))
        }
      }
    }
  }
})

test('all shared Artifact renderers pass current-content reads through the admission funnel', () => {
  const source = readFileSync(new URL('../components/artifactPreview.tsx', import.meta.url), 'utf8')
  const calls = [...source.matchAll(/useArtifactContent\(([^\n]*)/g)]
  assert.equal(calls.length, 3, 'body, thumbnail, and canonical page are the shared body readers')
  for (const call of calls) assert.match(call[1], /^shouldReadCurrentArtifactBody\(/)
  assert.match(source, /shouldReadCurrentArtifactBody\(\{ hasBodyOverride: bodyOverride !== undefined \}\)/)
  assert.match(source, /shouldReadCurrentArtifactBody\(\{ addressedRevision, inTrash, lifecycleHeld \}\)/)
})
