/** The optimistic-id seam: `save-artifact` mints a client-temporary id (prefix
 *  `art-opt-`) that the server's `art-live-*` id replaces on reconcile. The gallery
 *  must NOT open or re-file an artifact still carrying that temp id — its id is one
 *  the server's graph never knows about, so a refile would target a phantom and the
 *  user's move would be silently dropped (an adversarial review caught this). The
 *  minter (api/commands) and the guard (the gallery) agree only because they share
 *  OPTIMISTIC_ID_PREFIX; this pins that the predicate matches the minted shape. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPTIMISTIC_ID_PREFIX, isOptimisticId } from '../src/api/ids.ts'

test('isOptimisticId flags a client-minted optimistic artifact id', () => {
  // The exact shape api/commands.ts mints: `${OPTIMISTIC_ID_PREFIX}${n}`.
  assert.equal(isOptimisticId(`${OPTIMISTIC_ID_PREFIX}1`), true)
  assert.equal(isOptimisticId(`${OPTIMISTIC_ID_PREFIX}42`), true)
})

test('isOptimisticId rejects reconciled and seed ids (which the UI may safely act on)', () => {
  assert.equal(isOptimisticId('art-live-1'), false, 'a server-minted id is stable')
  assert.equal(isOptimisticId('a1'), false, 'a seed artifact id is stable')
  assert.equal(isOptimisticId(''), false)
})
