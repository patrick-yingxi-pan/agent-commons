import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyGraph } from '../../contract/index.ts'
import { shouldAcceptRelationGraph } from './relationRevision.ts'

const graph = (revision?: number) => ({
  ...emptyGraph(),
  ...(revision === undefined ? { revision: undefined } : { revision }),
})

test('relation snapshots advance monotonically across HTTP and ambient reads', () => {
  assert.equal(shouldAcceptRelationGraph(undefined, graph(1)), true)
  assert.equal(shouldAcceptRelationGraph(graph(2), graph(3)), true)
  assert.equal(shouldAcceptRelationGraph(graph(3), graph(3)), true)
  assert.equal(shouldAcceptRelationGraph(graph(4), graph(3)), false, 'an older mutation response cannot roll back a newer read')
})

test('legacy unrevisioned graphs remain compatible without overwriting a revisioned world', () => {
  assert.equal(shouldAcceptRelationGraph(graph(), graph()), true)
  assert.equal(shouldAcceptRelationGraph(graph(), graph(1)), true)
  assert.equal(shouldAcceptRelationGraph(graph(1), graph()), false)
})
