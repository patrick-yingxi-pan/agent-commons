import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
const source = (path: string) => stripComments(read(join(ROOT, 'src', path)))

test('conversation Agent choice uses shared draft state or the revisioned metadata funnel', () => {
  const pane = source('components/ConversationPane.tsx')
  assert.ok(pane.includes('conv.draftBinding ??'), 'duplicate panes read one binding')
  assert.ok(pane.includes('selectBinding({ agentId })'), 'Agent change deliberately inherits its provider')
  assert.ok(pane.includes("{ ...next, providerId: next.providerId ?? '', modelId: next.modelId ?? '' }"), 'saved Agent and provider resets are one patch')
  assert.ok(pane.includes('draftBinding: next'), 'both draft selectors share the same memory owner')
  assert.ok(pane.includes('pick.providerId ?? DEFAULT_PROVIDER_ID'), 'registry-default selection is an explicit override of the Agent')
  assert.ok(pane.includes('onSelectAgent={canControlTurn ? selectAgent : undefined}'), 'shared readers cannot change the driver')
  assert.ok(pane.includes('conversationModelPick(binding, agents)'), 'toolbar reflects the same inheritance as generation')
  const command = source('api/commands.ts')
  assert.ok(command.includes('agentId: options.agentId'), 'first send persists its chosen Agent')
})

test('missing Agents block sends and live/pending operations freeze binding changes', () => {
  const view = source('components/ConversationView.tsx')
  assert.ok(view.includes('This conversation’s Agent is unavailable.'), 'absence never wears default-Agent success copy')
  assert.ok(view.includes('const selectionLocked = busy || compactionHeld || bindingHeld'))
  assert.ok(view.includes('onSelectAgent={selectionLocked ? undefined : onSelectAgent}'))
  assert.ok(view.includes('selectionLocked || execution.blocked'))
  assert.ok(view.includes('isSessionBindingHeld(sessionId)'), 'unrelated conversation and title edits cannot hold this execution')
  assert.ok(source('controller/sessionMetadataMutations.ts').includes('controller.isPending(sessionId, isConversationBindingPatch)'))
  assert.match(view, /const interrupted =\s*canControlTurn &&\s*!selectionLocked &&\s*!execution\.blocked &&/, 'Retry cannot dispatch under an unconfirmed or missing binding')
  const picker = source('components/ConversationAgentPicker.tsx')
  assert.ok(picker.includes('useAgents()'), 'options come only from the live registry')
  assert.ok(picker.includes('Earlier replies stay unchanged.'))
  assert.ok(picker.includes('disabled={disabled || !onSelect || !query.data || !!query.error}'))
  assert.ok(picker.includes('invalidate(keys.workerAgents)'), 'an initial registry failure has a read-only retry')
})

test('optional Agent choices and mode toggles share the existing lazy catalog boundary', () => {
  const control = source('components/ModelEffortControl.tsx')
  assert.ok(control.includes('agentControl={agentId ? { agentId, onSelect: onSelectAgent } : undefined}'))
  assert.ok(!control.includes("from './ConversationAgentPicker'"))
  assert.ok(!control.includes("from './ModelModeToggles'"))
  assert.ok(control.includes('modes={{ config, update: updateModelPreferences, onSelectModel }}'))
  assert.ok(source('components/ModelPickerMenuBody.tsx').includes('modes ? modes.onSelectModel &&'), 'lazy preference writes require the conversation write path')
  assert.ok(source('components/ModelPickerMenuBody.tsx').includes('<ConversationAgentPicker'))
})
