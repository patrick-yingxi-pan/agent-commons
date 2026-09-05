import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountRegistry } from './accounts.ts'

test('a keyed token mint replays one row across rehydrate without storing its key', () => {
  const registry = new AccountRegistry()
  const key = 'raw-browser-secret-key'
  const first = registry.mintApiTokenWithReceipt('user-ada', 'laptop MCP', key)
  assert.equal(first.kind, 'active')
  if (first.kind !== 'active') return
  assert.equal(first.created, true)

  const replay = registry.mintApiTokenWithReceipt('user-ada', 'laptop MCP', key)
  assert.equal(replay.kind, 'active')
  if (replay.kind !== 'active') return
  assert.equal(replay.created, false)
  assert.deepEqual(replay.row, first.row)
  assert.equal(registry.mintApiTokenWithReceipt('user-ada', 'changed label', key).kind, 'conflict')

  const persisted = registry.toPersisted()
  assert.ok(persisted.apiTokenMintReceipts[0]?.[1][0]?.keyDigest)
  assert.equal(JSON.stringify(persisted).includes(key), false, 'raw idempotency keys never enter storage')
  const restarted = new AccountRegistry()
  restarted.rehydrate(persisted)
  assert.deepEqual(restarted.recoverApiTokenMint('user-ada', key), { kind: 'active', row: first.row })
})

test('cancellation is a durable tombstone before or after mint and revocation retires replay', () => {
  const registry = new AccountRegistry()
  assert.equal(registry.cancelApiTokenMint('user-ada', 'cancel-before'), true)
  assert.equal(registry.cancelApiTokenMint('user-ada', 'cancel-before'), false)
  assert.equal(registry.mintApiTokenWithReceipt('user-ada', undefined, 'cancel-before').kind, 'cancelled')

  const minted = registry.mintApiTokenWithReceipt('user-ada', 'desktop', 'cancel-after')
  assert.equal(minted.kind, 'active')
  if (minted.kind !== 'active') return
  assert.equal(registry.cancelApiTokenMint('user-ada', 'cancel-after'), true)
  assert.equal(registry.apiTokenLive('user-ada', minted.row.id), false)
  assert.equal(registry.mintApiTokenWithReceipt('user-ada', 'desktop', 'cancel-after').kind, 'cancelled')

  const revoked = registry.mintApiTokenWithReceipt('user-ada', 'revoked', 'revoked-key')
  assert.equal(revoked.kind, 'active')
  if (revoked.kind !== 'active') return
  assert.equal(registry.revokeApiToken('user-ada', revoked.row.id), true)
  assert.equal(registry.mintApiTokenWithReceipt('user-ada', 'revoked', 'revoked-key').kind, 'cancelled')
})

test('cancelled receipt history is bounded without evicting active recovery', () => {
  const registry = new AccountRegistry()
  const active = registry.mintApiTokenWithReceipt('user-ada', 'keep recoverable', 'active-key')
  assert.equal(active.kind, 'active')
  for (let i = 0; i < 160; i += 1) registry.cancelApiTokenMint('user-ada', `cancelled-${i}`)
  const receipts = registry.toPersisted().apiTokenMintReceipts.find(([userId]) => userId === 'user-ada')?.[1] ?? []
  assert.equal(receipts.filter((receipt) => receipt.state === 'cancelled').length, 128)
  assert.equal(receipts.filter((receipt) => receipt.state === 'active').length, 1)
  assert.equal(registry.recoverApiTokenMint('user-ada', 'active-key').kind, 'active')
})
