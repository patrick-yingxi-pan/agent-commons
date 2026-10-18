import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, filesUnder, read, stripComments } from '../tests/helpers/source.ts'

test('all direct model admission paths use the shared live budget intersection', () => {
  const consumers = [
    ['server/routes/index.ts', 2],
    ['server/store/index.ts', 4],
    ['server/routineRunner.ts', 1],
  ] as const
  for (const [path, count] of consumers) {
    const source = stripComments(read(join(ROOT, path)))
    assert.equal([...source.matchAll(/\.modelSpendLimit\(/g)].length, count, path)
  }
  const store = stripComments(read(join(ROOT, 'server/store/index.ts')))
  assert.match(store, /this\.modelSpendLimit\(agent, selectedProvider, tenantId, \[commission\.grant\]\)/)
  assert.match(store, /usageRegistry\.overLimit\(tenantId, \[\.\.\.extraBudgets, agent\.budget, parent\.plan, selected\.plan\]\)/)
  const runner = stripComments(read(join(ROOT, 'server/routineRunner.ts')))
  assert.match(runner, /runStore\.modelSpendLimit\(ctx\.agent, ctx\.provider, ctx\.tenantId\)/)
  // The compatibility method may remain for callers testing a single budget,
  // but production model admission must not silently skip the other parents.
  const bypasses = filesUnder('server').filter(path => /\.overSpendLimit\(/.test(stripComments(read(path))))
  assert.deepEqual(bypasses, [])
})
