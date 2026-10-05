import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

test('the id-free access-change event evicts private history and refreshes artifact projections', () => {
  const source = readFileSync(new URL('./events.ts', import.meta.url), 'utf8')
  const start = source.indexOf("case 'social-access.changed':")
  const end = source.indexOf("case 'grant.changed':", start)
  assert.ok(start >= 0 && end > start)
  const branch = source.slice(start, end)
  assert.match(branch, /evictPrefix\('artifact-history'\)/)
  for (const key of ['artifacts', 'artifactContent', 'relations', 'artifactTrash']) {
    assert.ok(branch.includes(`keys.${key}`), `${key} is refreshed without identifying the artifact`)
  }
  assert.match(branch, /invalidatePrefix\(keys\.artifactLifecycle\(\)\)/)
  assert.doesNotMatch(branch, /e\.artifactId|e\.subject/, 'the event does not disclose a changed artifact identity')
})
