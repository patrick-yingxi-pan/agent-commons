import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionCompactionId as serverId } from '../../server/sessionCompactionIdentity.ts'
import { sessionCompactionId as browserId } from './sessionCompactionIdentity.ts'

test('browser and server derive the same scope-sensitive compaction receipt', async () => {
  const input = ['tenant-compact', 'session-compact', 'compact-key'] as const
  const expected = serverId(...input)
  assert.equal(await browserId(...input), expected)
  assert.match(expected, /^session-compaction-[a-f0-9]{24}$/)
  assert.notEqual(await browserId('tenant-other', input[1], input[2]), expected)
  assert.notEqual(await browserId(input[0], 'session-other', input[2]), expected)
})
