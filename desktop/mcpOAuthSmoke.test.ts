import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../tests/helpers/source.ts'
import { assertOAuthContributionReceipt, oauthSmokePatches } from './mcpOAuthSmoke.mjs'
import { ignoreFromPackage } from './packager.config.mjs'

test('OAuth fixture transforms only known networking/browser seams in an excluded disposable package helper', () => {
  const patches = oauthSmokePatches('http://127.0.0.1:49152')
  assert.equal(patches.length, 6)
  for (const patch of patches) {
    const source = readFileSync(join(ROOT, patch.path), 'utf8')
    assert.equal(source.split(patch.before).length - 1, 1, `unique packaged patch target ${patch.path}`)
  }
  assert.deepEqual([...new Set(patches.map(row => row.path))], ['desktop/mcpOAuthHttp.mjs', 'server/mcpHttpTransport.ts', 'desktop/main.mjs'])
  assert.ok(patches.every(row => !row.before.includes('allowLoopback')))
  for (const path of ['/desktop/mcpOAuthSmoke.mjs', '/desktop/mcpOAuthSmokeFixture.mjs', '/desktop/mcpOAuthMessagesSmokeFixture.mjs', '/desktop/mcpLoopbackSmokePackage.mjs']) {
    assert.equal(ignoreFromPackage(path), true)
  }
  assert.throws(() => oauthSmokePatches('https://public.example'), assert.AssertionError)
})

function contributionEvidence() {
  const identity = { tenantId: 'tenant-private', ownerUserId: 'person-private',
    connectionId: `mcp-connection-${'a'.repeat(32)}` }
  const args = { query: 'native-oauth-contribution-record' }
  const call = { connectionId: identity.connectionId, connectionRevision: 4, toolName: 'records.search',
    schemaHash: 'b'.repeat(64), arguments: args }
  const receipt = { id: `contribution-effect-${'c'.repeat(24)}`, tenantId: identity.tenantId,
    ownerUserId: identity.ownerUserId, projectId: 'project-1', contributionId: 'contribution-1',
    envelopeVersion: 1, lineId: 'line-1', actor: 'Native OAuth owner', connectionLabel: 'Native OAuth fixture',
    call, callHash: 'd'.repeat(64), startedAt: 1_000, status: 'done', finishedAt: 1_001,
    summary: 'The MCP tool completed.', result: { resultType: 'complete', isError: false,
      content: [{ type: 'text', text: 'Fixture record for native-oauth-contribution-record' }],
      structuredContent: { query: args.query, record: 'fixture-record-1' } } }
  const line = { id: 'line-1', type: 'mcp.mutate', target: 'records.search', harness: 'explicit-call',
    cardinality: 2, used: 1, note: '', mcp: { connectionLabel: receipt.connectionLabel, toolName: call.toolName, arguments: args } }
  const envelope = { version: 1, approvedVersion: 1, approvedBy: receipt.actor }
  const stored = { id: receipt.contributionId, projectId: receipt.projectId,
    envelope: { ...envelope, lines: [{ ...line, mcpAuthority: { tenantId: identity.tenantId, ownerUserId: identity.ownerUserId, call } }] },
    effectAttempts: [receipt] }
  const current = { id: stored.id, projectId: stored.projectId,
    envelope: { ...envelope, lines: [{ ...line, mcp: { ...line.mcp, canRun: true } }] },
    effects: [{ id: receipt.id, envelopeVersion: receipt.envelopeVersion, lineId: receipt.lineId,
      actor: receipt.actor, connectionLabel: receipt.connectionLabel, toolName: call.toolName, arguments: args,
      startedAt: receipt.startedAt, status: receipt.status, finishedAt: receipt.finishedAt,
      summary: receipt.summary, result: receipt.result }] }
  return structuredClone({ stored, current, identity })
}

test('native Contribution evidence requires the exact private OAuth owner, one result and remaining capacity', () => {
  const evidence = contributionEvidence()
  assertOAuthContributionReceipt(evidence.stored, evidence.current, evidence.identity)
  const disconnected = structuredClone(evidence.current)
  delete disconnected.envelope.lines[0].mcp.canRun
  assertOAuthContributionReceipt(evidence.stored, disconnected, { ...evidence.identity, canRun: false })

  const corruptions = [
    value => { delete value.stored.envelope.lines[0].mcpAuthority.ownerUserId },
    value => { value.stored.envelope.lines[0].mcpAuthority.ownerUserId = 'another-person' },
    value => { delete value.stored.effectAttempts[0].ownerUserId },
    value => { value.stored.effectAttempts[0].ownerUserId = 'another-person' },
    value => { value.stored.effectAttempts[0].call.arguments.query = 'different-call' },
    value => { value.stored.effectAttempts[0].status = 'uncertain' },
    value => { value.stored.effectAttempts.push(structuredClone(value.stored.effectAttempts[0])) },
    value => { value.current.effects[0].ownerUserId = value.identity.ownerUserId },
    value => { value.current.envelope.lines[0].mcp.connectionId = value.identity.connectionId },
    value => { value.current.effects[0].result.structuredContent.query = 'stale-result' },
    value => { value.stored.envelope.lines[0].used = 2 },
    value => { value.stored.envelope.lines[0].cardinality = 1 },
    value => { delete value.current.envelope.lines[0].mcp.canRun },
  ]
  for (const corrupt of corruptions) {
    const invalid = contributionEvidence()
    corrupt(invalid)
    assert.throws(() => assertOAuthContributionReceipt(invalid.stored, invalid.current, invalid.identity), assert.AssertionError)
  }
})
