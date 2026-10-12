import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { McpToolResult } from '../contract/index.ts'
import {
  contributionEffectConsumesSlot,
  createContributionEffectAttempt,
  interruptContributionEffectAttempt,
  parseStoredContributionEffectAttempt,
  publicContributionEffectRun,
  sameContributionEffectIntent,
  settleContributionEffectAttempt,
  type StoredContributionEffectAttempt,
} from './contributionEffectState.ts'

const input = () => ({
  id: `contribution-effect-${'a'.repeat(24)}`,
  tenantId: 'tenant-private',
  projectId: 'project-private',
  contributionId: 'contribution-private',
  envelopeVersion: 3,
  lineId: 'line-reviewed',
  actor: 'Project reader',
  connectionLabel: 'Reviewed calendar connection',
  call: {
    connectionId: `mcp-connection-${'b'.repeat(32)}`,
    connectionRevision: 4,
    toolName: 'create_event',
    schemaHash: 'c'.repeat(64),
    arguments: { title: 'Planning', tags: ['work', 'weekly'], options: { visible: true } },
  },
  startedAt: 10_000,
})

const result = (overrides: Record<string, unknown> = {}): McpToolResult => ({
  resultType: 'complete',
  content: [{ type: 'text', text: 'Created the event.' }],
  isError: false,
  ...overrides,
})

const done = (value: McpToolResult = result()) => ({ status: 'done' as const, summary: 'MCP completed.', result: value })

function terminal(status: 'done' | 'failed' | 'uncertain', outcome?: Parameters<typeof settleContributionEffectAttempt>[1]): StoredContributionEffectAttempt {
  const pending = createContributionEffectAttempt(input())
  return settleContributionEffectAttempt(
    pending,
    outcome ?? (status === 'done' ? done() : status === 'failed' ? { status, summary: 'MCP refused before dispatch.' } : { status, summary: 'MCP outcome is uncertain.' }),
    pending.startedAt + 1,
  )
}

test('creates a pending attempt with a canonical call hash and detached reviewed arguments', () => {
  const source = input()
  const attempt = createContributionEffectAttempt(source)
  assert.match(attempt.callHash, /^[0-9a-f]{64}$/)
  assert.deepEqual(attempt, {
    ...source,
    callHash: attempt.callHash,
    status: 'pending',
  })
  source.call.arguments.options.visible = false
  source.call.arguments.tags.push('mutated')
  assert.deepEqual(attempt.call.arguments, { title: 'Planning', tags: ['work', 'weekly'], options: { visible: true } })
  assert.equal(attempt.status, 'pending')
})

test('rejects malformed or extended creation inputs, including invalid JSON and oversized arguments', () => {
  const invalidInputs = [
    { ...input(), id: 'contribution-effect-short' },
    { ...input(), tenantId: '' },
    { ...input(), envelopeVersion: 0 },
    { ...input(), startedAt: -1 },
    { ...input(), unexpected: true },
    { ...input(), call: { ...input().call, unexpected: true } },
    { ...input(), call: { ...input().call, connectionId: 'ordinary-id' } },
    { ...input(), call: { ...input().call, connectionRevision: -1 } },
    { ...input(), call: { ...input().call, schemaHash: 'not-a-hash' } },
    { ...input(), call: { ...input().call, arguments: [] } },
    { ...input(), call: { ...input().call, arguments: { value: Number.NaN } } },
    { ...input(), call: { ...input().call, arguments: { value: undefined } } },
    { ...input(), call: { ...input().call, arguments: { value: 'x'.repeat(49_153) } } },
  ]
  for (const candidate of invalidInputs) assert.throws(() => createContributionEffectAttempt(candidate as never), Error)

  let nested: unknown = 'leaf'
  for (let index = 0; index < 33; index += 1) nested = { next: nested }
  assert.throws(() => createContributionEffectAttempt({ ...input(), call: { ...input().call, arguments: { nested } } } as never), Error)

  const manyNodes = Object.fromEntries(Array.from({ length: 4_100 }, (_, index) => [`k${index}`, index]))
  assert.throws(() => createContributionEffectAttempt({ ...input(), call: { ...input().call, arguments: manyNodes } } as never), Error)
})

test('parses only a complete stored attempt and returns a detached row', () => {
  const stored = createContributionEffectAttempt(input())
  const parsed = parseStoredContributionEffectAttempt(stored)
  assert.deepEqual(parsed, stored)
  assert.notEqual(parsed, stored)
  assert.notEqual(parsed.call, stored.call)
  assert.notEqual(parsed.call.arguments, stored.call.arguments)
  ;(parsed.call.arguments.options as { visible: boolean }).visible = false
  assert.equal((stored.call.arguments.options as { visible: boolean }).visible, true)

  const badRows = [
    { ...stored, extraPrivateField: 'unexpected' },
    { ...stored, call: { ...stored.call, credential: 'secret' } },
    { ...stored, callHash: 'bad' },
    { ...stored, id: `contribution-effect-${'d'.repeat(24)}` },
    { ...stored, status: 'running' },
    { ...stored, finishedAt: 10_001 },
    { ...stored, summary: 'pending rows have no summary' },
    { ...stored, call: { ...stored.call, arguments: { x: undefined } } },
  ]
  for (const row of badRows) assert.throws(() => parseStoredContributionEffectAttempt(row), Error)
})

test('parse failures use a fixed error message rather than reflecting persisted payloads', () => {
  const messages = [
    { ...createContributionEffectAttempt(input()), secret: 'credential-never-echo' },
    { not: 'an attempt', secret: 'credential-never-echo' },
  ].map((row) => {
    try {
      parseStoredContributionEffectAttempt(row)
      assert.fail('invalid rows must be rejected')
    } catch (error) {
      assert.ok(error instanceof Error)
      return error.message
    }
  })
  assert.equal(messages[0], messages[1])
  assert.equal(messages[0].includes('credential-never-echo'), false)
})

test('settles only pending attempts, preserves valid results, and keeps summaries fixed', () => {
  const pending = createContributionEffectAttempt(input())
  const settled = settleContributionEffectAttempt(pending, { ...done(), summary: 'remote text must not be persisted' }, 10_001)
  assert.equal(settled.status, 'done')
  assert.equal(settled.finishedAt, 10_001)
  assert.deepEqual(settled.result, result())
  assert.notEqual(settled.summary, 'remote text must not be persisted')
  assert.equal(settled.summary?.includes('remote text'), false)
  assert.throws(() => settleContributionEffectAttempt(settled, done(), 10_002), Error)
  assert.throws(() => settleContributionEffectAttempt(pending, done(), 9_999), Error)
})

test('invalid, oversized, and deeply nested returned results become uncertain without truncation', () => {
  const invalidResults: unknown[] = [
    { resultType: 'complete', content: [{ type: 'text', text: undefined }], isError: false },
    result({ content: [{ type: 'unknown', data: 'x' }] }),
    result({ content: [{ type: 'text', text: 'x'.repeat(262_145) }] }),
  ]
  let nested: unknown = 'leaf'
  for (let index = 0; index < 33; index += 1) nested = { next: nested }
  invalidResults.push(result({ structuredContent: nested }))
  for (const invalidResult of invalidResults) {
    const settled = settleContributionEffectAttempt(createContributionEffectAttempt(input()), done(invalidResult as McpToolResult), 10_001)
    assert.equal(settled.status, 'uncertain')
    assert.equal(settled.result, undefined)
    assert.equal(settled.summary?.includes('x'.repeat(32)), false)
  }
})

test('records failed-with-result as consumed, but pre-submit failure as reusable', () => {
  const rejectedBeforeDispatch = terminal('failed')
  const remoteToolError = settleContributionEffectAttempt(
    createContributionEffectAttempt(input()),
    { status: 'failed', summary: 'Remote error details are private.', result: result({ isError: true }) },
    10_001,
  )
  assert.equal(rejectedBeforeDispatch.status, 'failed')
  assert.equal(remoteToolError.status, 'failed')
  assert.equal(contributionEffectConsumesSlot(rejectedBeforeDispatch), false)
  assert.equal(contributionEffectConsumesSlot(remoteToolError), true)
  assert.equal(contributionEffectConsumesSlot(createContributionEffectAttempt(input())), true)
  assert.equal(contributionEffectConsumesSlot(terminal('done')), true)
  assert.equal(contributionEffectConsumesSlot(terminal('uncertain')), true)
})

test('interrupting a pending attempt fences it as uncertain; terminal rows are detached unchanged', () => {
  const pending = createContributionEffectAttempt(input())
  const interrupted = interruptContributionEffectAttempt(pending, 10_001)
  assert.equal(interrupted.status, 'uncertain')
  assert.equal(interrupted.finishedAt, 10_001)
  assert.equal(interrupted.result, undefined)
  assert.throws(() => interruptContributionEffectAttempt(pending, 9_999), Error)

  const completed = terminal('done')
  const afterTerminalInterrupt = interruptContributionEffectAttempt(completed, 50_000)
  assert.deepEqual(afterTerminalInterrupt, completed)
  assert.notEqual(afterTerminalInterrupt, completed)
})

test('public run projection exposes reviewed arguments and result but not private authority', () => {
  const row = settleContributionEffectAttempt(
    createContributionEffectAttempt(input()),
    done(result({ structuredContent: { created: true } })),
    10_001,
  )
  const publicRun = publicContributionEffectRun(row)
  assert.deepEqual(publicRun, {
    id: row.id,
    envelopeVersion: row.envelopeVersion,
    lineId: row.lineId,
    actor: row.actor,
    connectionLabel: row.connectionLabel,
    toolName: row.call.toolName,
    arguments: row.call.arguments,
    startedAt: row.startedAt,
    status: row.status,
    finishedAt: row.finishedAt,
    summary: row.summary,
    result: row.result,
  })
  for (const key of ['tenantId', 'projectId', 'contributionId', 'callHash', 'connectionId', 'connectionRevision', 'schemaHash']) {
    assert.equal(Object.hasOwn(publicRun, key), false, `${key} must remain private`)
  }
  ;(publicRun.arguments.options as { visible: boolean }).visible = false
  assert.equal((row.call.arguments.options as { visible: boolean }).visible, true)
})

test('intent matching binds every owner, target, reviewed call field, and canonical arguments', () => {
  const original = input()
  const row = createContributionEffectAttempt(original)
  assert.equal(sameContributionEffectIntent(row, original), true)

  const reordered = input()
  reordered.call.arguments = { options: { visible: true }, tags: ['work', 'weekly'], title: 'Planning' }
  assert.equal(sameContributionEffectIntent(row, reordered), true, 'JSON object-key order is not intent')

  const mutations: Array<(value: ReturnType<typeof input>) => void> = [
    (value) => { value.id = `contribution-effect-${'d'.repeat(24)}` },
    (value) => { value.tenantId = 'another-tenant' },
    (value) => { value.projectId = 'another-project' },
    (value) => { value.contributionId = 'another-contribution' },
    (value) => { value.envelopeVersion += 1 },
    (value) => { value.lineId = 'another-line' },
    (value) => { value.call.connectionId = `mcp-connection-${'d'.repeat(32)}` },
    (value) => { value.call.connectionRevision += 1 },
    (value) => { value.call.toolName = 'delete_event' },
    (value) => { value.call.schemaHash = 'd'.repeat(64) },
    (value) => { value.call.arguments.title = 'Different event' },
    (value) => { value.call.arguments.tags.reverse() },
  ]
  for (const mutate of mutations) {
    const changed = input()
    mutate(changed)
    assert.equal(sameContributionEffectIntent(row, changed), false)
  }
})

test('optional OAuth owner binds private receipt identity without changing legacy hashes', () => {
  const legacy = createContributionEffectAttempt(input())
  assert.equal(legacy.callHash, 'edb032cf58b3730df5ba7b62f37cc914f5e2d418c7cf8a223df92e6009fe4567')
  assert.equal(Object.hasOwn(legacy, 'ownerUserId'), false)
  assert.deepEqual(parseStoredContributionEffectAttempt(legacy), legacy)

  const ownedInput = { ...input(), ownerUserId: 'person-private-owner' }
  const owned = createContributionEffectAttempt(ownedInput)
  assert.equal(owned.ownerUserId, ownedInput.ownerUserId)
  assert.notEqual(owned.callHash, legacy.callHash)
  assert.deepEqual(parseStoredContributionEffectAttempt(owned), owned)
  assert.equal(sameContributionEffectIntent(owned, ownedInput), true)
  assert.equal(sameContributionEffectIntent(owned, input()), false)
  assert.equal(sameContributionEffectIntent(legacy, ownedInput), false)
  assert.equal(sameContributionEffectIntent(owned, { ...ownedInput, ownerUserId: 'another-person' }), false)
  assert.throws(() => parseStoredContributionEffectAttempt({ ...owned, ownerUserId: 'another-person' }), Error)
  assert.throws(() => parseStoredContributionEffectAttempt({ ...legacy, ownerUserId: ownedInput.ownerUserId }), Error)
  const { ownerUserId: _owner, ...stripped } = owned
  assert.throws(() => parseStoredContributionEffectAttempt(stripped), Error)
})

test('stdio transport is hashed, public only as a sparse marker, and local refusal preserves launch uncertainty', () => {
  const localInput = { ...input(), ownerUserId: 'person-private-owner', transport: 'stdio' as const }
  const local = createContributionEffectAttempt(localInput)
  assert.equal(local.transport, 'stdio')
  assert.notEqual(local.callHash, createContributionEffectAttempt({ ...input(), ownerUserId: localInput.ownerUserId }).callHash)
  assert.deepEqual(parseStoredContributionEffectAttempt(local), local)
  assert.throws(() => createContributionEffectAttempt({ ...input(), transport: 'stdio' } as never), Error,
    'local provenance cannot be recorded without its authenticated person owner')
  assert.throws(() => parseStoredContributionEffectAttempt({ ...local, transport: undefined }), Error,
    'stripping transport invalidates the private attempt hash')
  const publicPending = publicContributionEffectRun(local)
  assert.equal(publicPending.transport, 'stdio')
  assert.equal(Object.hasOwn(publicPending, 'ownerUserId'), false)

  const refused = settleContributionEffectAttempt(local, { status: 'failed', summary: 'Private refusal.' }, 10_001)
  assert.equal(refused.status, 'failed')
  assert.match(refused.summary, /refused before execution/i)
  assert.match(refused.summary, /local program may already have had effects/i)
  assert.deepEqual(parseStoredContributionEffectAttempt(refused), refused)
  assert.equal(publicContributionEffectRun(refused).transport, 'stdio')

  const legacy = createContributionEffectAttempt(input())
  assert.equal(Object.hasOwn(legacy, 'transport'), false)
  assert.equal(Object.hasOwn(publicContributionEffectRun(legacy), 'transport'), false)
})

test('present OAuth receipt owners are strictly bounded and cannot normalize to absence', () => {
  const legacy = createContributionEffectAttempt(input())
  for (const ownerUserId of [undefined, null, false, 12, {}, [], '', ' ', 'x'.repeat(201), 'owner\u0000private', 'person-é']) {
    assert.throws(() => createContributionEffectAttempt({ ...input(), ownerUserId } as never), Error)
    assert.throws(() => parseStoredContributionEffectAttempt({ ...legacy, ownerUserId }), Error)
  }
  assert.equal(createContributionEffectAttempt({ ...input(), ownerUserId: 'x'.repeat(200) }).ownerUserId?.length, 200)
})

test('settlement and interruption retain OAuth receipt owners without exposing them in any public state', () => {
  const owned = createContributionEffectAttempt({ ...input(), ownerUserId: 'person-private-owner' })
  const states = [
    owned,
    settleContributionEffectAttempt(owned, done(), 10_001),
    settleContributionEffectAttempt(owned, { status: 'failed' as const, summary: 'Private refusal.' }, 10_001),
    settleContributionEffectAttempt(owned, { status: 'failed' as const, summary: 'Private tool error.', result: result({ isError: true }) }, 10_001),
    interruptContributionEffectAttempt(owned, 10_001),
  ]
  for (const state of states) {
    assert.equal(state.ownerUserId, owned.ownerUserId)
    assert.equal(state.callHash, owned.callHash)
    assert.deepEqual(parseStoredContributionEffectAttempt(state), state)
    assert.equal(Object.hasOwn(publicContributionEffectRun(state), 'ownerUserId'), false)
    assert.equal(JSON.stringify(publicContributionEffectRun(state)).includes(owned.ownerUserId!), false)
  }
})
