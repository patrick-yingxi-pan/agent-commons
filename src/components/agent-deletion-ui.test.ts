import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Agent removal is confirmed, revision-pinned, retained, and shell-recoverable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const resourcePage = stripComments(read(join(ROOT, 'src', 'components', 'ResourcePage.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'agentDeletionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'agentDeletionMutationRuntime.ts')))
  const holds = stripComments(read(join(ROOT, 'src', 'controller', 'agentMutationHolds.ts')))
  const config = stripComments(read(join(ROOT, 'src', 'controller', 'agentMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'AgentMutationNotice.tsx')))

  assert.doesNotMatch(view, /deleteAgent\(/, 'the row cannot bypass acknowledged removal')
  assert.match(view, /<ConfirmDialog[\s\S]*title=\{`Remove \$\{agent\.label\}\?`\}/,
    'the destructive confirmation names the selected Agent')
  assert.match(controller, /permanently removes the Agent, its proposal history, and its Project delegations/)
  assert.match(controller, /Existing conversations, prior replies, and contributions stay/)
  assert.match(controller, /New replies require choosing an available Agent in Model and effort → Conversation Agent/)
  assert.doesNotMatch(controller, /Conversations fall back to the default Agent/,
    'removal must not promise an automatic replacement Agent')
  assert.match(view, /body=\{AGENT_DELETE_SCOPE\}/)
  assert.match(view, /enqueueAgentDeletion\(agent\)/,
    'confirmation freezes the exact row and its definition revision')
  assert.match(view, /heldAgentDeletions\(\)\.filter[\s\S]*!currentAgents\.some/,
    'an early registry refresh cannot erase the reviewed row before settlement')
  assert.match(view, /busy=\{deleting\}/)
  assert.match(resourcePage, /aria-busy=\{busy\}/)
  assert.match(view, /disabled=\{mutationHeld\}/, 'row actions share one mutation hold')

  assert.match(runtime, /createRevisionedDeletionMutationController<Agent>/)
  assert.match(runtime, /revision: \(agent\) => agent\.revision \?\? 0/)
  assert.match(runtime, /rebaseOnRetry: true/, 'only stale reviewed truth rebases on explicit Retry')
  assert.match(runtime, /still a Contributor[\s\S]*rebaseOnRetry: false/,
    'dependency recovery never widens the reviewed revision')
  assert.match(commands, /apiDelete\([\s\S]*expectedRevision[\s\S]*idempotencyKey/)
  assert.match(commands, /acceptAgentAbsence\(id\)/,
    'only acknowledgement or authoritative absence evicts the row')
  assert.match(controller, /heldSnapshots\.set\(agent\.id, agent\)/)
  assert.match(controller, /issuedGeneration !== accountGeneration/)
  assert.match(holds, /createExclusiveMutationHolds<AgentMutationKind>/)
  assert.match(config, /acquireAgentMutation\('configuration', agentId\)/)
  assert.match(notice, /kind="agent-delete"/, 'removal recovery is shell-owned')
})
