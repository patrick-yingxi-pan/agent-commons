import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { createRetryableRuntimeLoader } from './retryableRuntimeLoader.ts'

test('a rejected Artifact creation runtime load leaves the facade cache able to retry', async () => {
  const loaded = { runtime: 'ready' }
  let attempts = 0
  let accepted = 0
  const load = createRetryableRuntimeLoader(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('first load failed')
    return loaded
  }, () => { accepted += 1 })

  const first = load()
  assert.equal(load(), first, 'concurrent callers share the active load')
  await assert.rejects(first, /first load failed/)
  const second = load()
  assert.notEqual(second, first, 'the rejected facade promise is not retained')
  assert.equal(await second, loaded)
  assert.equal(attempts, 2)
  assert.equal(accepted, 1, 'only a successful runtime is installed')

  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'artifactCreationMutations.ts')))
  assert.match(facade, /from '\.\/retryableRuntimeLoader\.ts'/,
    'the Artifact facade imports the shared framework-free loader')
  assert.match(facade, /createRetryableRuntimeLoader<Runtime>\([\s\S]*import\('\.\/artifactCreationMutationRuntime\.ts'\)/,
    'the production Artifact facade uses the retryable cache around its runtime import')
})
