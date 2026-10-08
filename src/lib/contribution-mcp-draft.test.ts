import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRIBUTION_MCP_ARGUMENTS_MAX_BYTES,
  CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES,
  formatContributionMcpArguments,
  parseContributionMcpArguments,
  transitionContributionEffectDraftType,
} from './contributionMcpDraft.ts'

test('Contribution MCP arguments are bounded JSON objects, not inferred calls', () => {
  assert.deepEqual(parseContributionMcpArguments('{"title":"Planning","count":2,"enabled":true,"none":null}'), {
    ok: true,
    value: { title: 'Planning', count: 2, enabled: true, none: null },
  })
  assert.deepEqual(parseContributionMcpArguments('[]').ok, false)
  assert.deepEqual(parseContributionMcpArguments('null').ok, false)
  assert.deepEqual(parseContributionMcpArguments('{bad').ok, false)
  assert.deepEqual(parseContributionMcpArguments(`{"value":"${'x'.repeat(CONTRIBUTION_MCP_ARGUMENTS_MAX_BYTES)}"}`).ok, false)
  const exact = `{"value":"${'x'.repeat(CONTRIBUTION_MCP_ARGUMENTS_MAX_BYTES - 12)}"}`
  assert.equal(new TextEncoder().encode(exact).byteLength, CONTRIBUTION_MCP_ARGUMENTS_MAX_BYTES)
  assert.equal(parseContributionMcpArguments(exact).ok, true)
})

test('reviewed arguments have a text-only stable preview', () => {
  assert.equal(formatContributionMcpArguments({ nested: { safe: true }, list: ['a', 'b'] }), '{\n  "nested": {\n    "safe": true\n  },\n  "list": [\n    "a",\n    "b"\n  ]\n}')
})

test('leaving MCP clears its call target and authority and restores a valid legacy harness', () => {
  assert.deepEqual(transitionContributionEffectDraftType({
    type: 'mcp.mutate',
    target: 'inspect_records',
    harness: 'explicit-call',
  }, 'connector.write'), {
    type: 'connector.write',
    target: '',
    harness: 'draft-escrow',
  })
})

test('entering MCP selects explicit-call without carrying a legacy target; legacy edits otherwise retain their choices', () => {
  assert.deepEqual(transitionContributionEffectDraftType({
    type: 'connector.write',
    target: 'workspace/a',
    harness: 'canary',
  }, 'mcp.mutate'), {
    type: 'mcp.mutate',
    target: '',
    harness: 'explicit-call',
  })
  assert.deepEqual(transitionContributionEffectDraftType({
    type: 'routine.schedule',
    target: 'routine-a',
    harness: 'canary',
  }, 'connector.write'), {
    type: 'connector.write',
    target: 'routine-a',
    harness: 'canary',
  })
})

test('legacy harness choices never expose the MCP-only explicit-call authority', () => {
  assert.ok(CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES.length > 0)
  assert.ok(!CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES.includes('explicit-call'))
  assert.deepEqual(CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES, [
    'dry-run', 'draft-escrow', 'canary', 'cooling-window', 'hold-until-landing',
  ])
})
