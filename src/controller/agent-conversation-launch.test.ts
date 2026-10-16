import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LIVE } from '../data/liveSession.ts'
import { agentConversationLaunchBlocked, hasAgentConversationDraft, launchAgentConversation, type AgentConversationLaunchSnapshot } from './agentConversationLaunchCore.ts'

function snapshot(): AgentConversationLaunchSnapshot {
  return { agent: { id: 'agent-a', label: 'Researcher', revision: 2 }, registryReady: true, mutationHeld: false,
    accountGeneration: 3, draftEpoch: 4,
    draft: { live: EMPTY_LIVE, composerText: '', draftBinding: null, busy: false, typing: false } }
}
function run(reviewed: AgentConversationLaunchSnapshot, current = reviewed) {
  const calls: string[] = []
  const error = launchAgentConversation(reviewed, current, {
    resetDraft: () => calls.push('reset'), selectAgent: (id) => calls.push(`select:${id}`), openDraft: () => calls.push('open'),
  })
  return { error, calls }
}

test('Agent launch resets old materialization before selecting inheritance and navigating; it performs no server work', () => {
  const current = snapshot()
  assert.equal(hasAgentConversationDraft(current), false)
  assert.deepEqual(run(current), { error: null, calls: ['reset', 'select:agent-a', 'open'] })
})

test('every kind of unsent work requires replacement review, including whitespace and an explicit model choice', () => {
  const current = snapshot()
  for (const draft of [
    { ...current.draft, composerText: ' ' },
    { ...current.draft, draftBinding: { providerId: 'provider-x' } },
    ...['messages', 'attachments', 'connectors', 'repos', 'workspaces'].map((field) =>
      ({ ...current.draft, live: { ...EMPTY_LIVE, [field]: [{ id: 'retained' }] } })),
  ]) assert.equal(hasAgentConversationDraft({ ...current, draft } as AgentConversationLaunchSnapshot), true)
})

test('unavailable registries, directory-only Agents, held edits/deletion and sending drafts cannot launch', () => {
  const current = snapshot()
  for (const changed of [
    { registryReady: false }, { agent: undefined }, { mutationHeld: true },
    { draft: { ...current.draft, busy: true } }, { draft: { ...current.draft, typing: true } },
  ]) {
    const next = { ...current, ...changed }
    assert.ok(agentConversationLaunchBlocked(next))
    assert.ok(run(current, next).error)
    assert.deepEqual(run(current, next).calls, [])
  }
})

test('confirmation cannot erase a newer draft, reset, changed Agent or another account', () => {
  const reviewed = snapshot()
  for (const changed of [
    { draft: { ...reviewed.draft, composerText: 'new work' } },
    { draftEpoch: 5 }, { accountGeneration: 4 },
    { agent: { ...reviewed.agent!, id: 'agent-b' } },
    { agent: { ...reviewed.agent!, revision: 3 } },
  ]) {
    const result = run(reviewed, { ...reviewed, ...changed })
    assert.ok(result.error)
    assert.deepEqual(result.calls, [])
  }
})
