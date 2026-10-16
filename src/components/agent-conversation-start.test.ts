import test from 'node:test'
import assert from 'node:assert/strict'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { join } from 'node:path'

test('Agent detail launch uses the live registry and ordinary shared draft, with replacement consent', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AgentConversationStart.tsx')))
  const view = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  assert.ok(view.includes('registryAgent && <AgentConversationStart key={agentId} agentId={agentId} onOpenSession={onOpenSession} />'),
    'only a locally usable Agent exposes the pane-local draft door')
  assert.match(source, /useAgents\(\)/)
  assert.match(source, /useConversation\(DRAFT_ID\)/)
  assert.match(source, /registryReady: agents.status === 'success'/)
  assert.match(source, /isAgentMutationHeld\(agentId\) \|\| isAgentDeletionHeld\(agentId\)/)
  assert.match(source, /if \(hasAgentConversationDraft\(selected\)\) setReview\(selected\)/)
  assert.match(source, /<ConfirmDialog title="Replace current draft\?"/)
  assert.match(source, /resetDraft: \(\) => draft.reset\(\)/)
  assert.match(source, /draftBinding: \{ agentId: id \}/)
  assert.match(source, /openDraft: \(\) => onOpenSession\(DRAFT_ID\)/)
  assert.doesNotMatch(source, /createSession|sendDraftTurn|sendMessage|sendTurn/, 'only the ordinary composer may create or send')
})
