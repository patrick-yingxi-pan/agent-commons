import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('saved Context status and removal use held acknowledgement queues', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const connectorDetail = stripComments(read(join(ROOT, 'src', 'components', 'ConnectorPanel.tsx')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'savedContextConnectionMutations.ts')))
  const deletionController = stripComments(read(join(ROOT, 'src', 'controller', 'savedContextDeletionMutations.ts')))
  const deletionCore = stripComments(read(join(ROOT, 'src', 'controller', 'revisionedDeletionCore.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SavedContextMutationNotice.tsx')))
  const deletionNotice = stripComments(read(join(ROOT, 'src', 'components', 'SavedContextDeletionNotice.tsx')))

  assert.match(view, /updateSavedContextConnection\(/, 'the rendered toggle enters the controller')
  assert.doesNotMatch(view, /setConnectorStatus\(/, 'no optimistic command bypass survives')
  assert.match(view, /disabled=\{mutationHeld\}/, 'the addressed controls stay held through pending or failed delivery')
  assert.match(view, /isSavedContextConnectionHeld\(id\)/, 'queued rows are held before they reach the FIFO head')
  assert.match(view, /<ConfirmDialog[\s\S]*title=\{`Remove \$\{removeTarget\.label\}\?`\}/, 'removal asks against the named row')
  assert.match(view, /Existing session attachments stay/, 'confirmation explains the actual removal scope')
  assert.match(view, /enqueueSavedContextDeletion\(target\.id, target\.connectionRevision \?\? 0\)/, 'confirmation freezes the reviewed revision')
  assert.match(view, /contextIdRef\.current === target\.id/, 'a late acknowledgement cannot redirect a person who left the removed detail')
  assert.match(view, /detail: 'Saved connection'/, 'descriptive fallback copy does not impersonate live status')
  assert.match(view, /ctx\.status !== 'connected' \? ' · Needs authentication'/, 'the picker derives setup posture from live status')
  assert.match(connectorDetail, /connected\s*\? detail\.blurb/, 'a disconnected detail cannot reuse a connected-service blurb')
  assert.match(connectorDetail, /Reconnect to make this service available in sessions\./, 'connector recovery copy follows live status')
  assert.match(controller, /createRevisionedMutationController/, 'Context status reuses the one revisioned FIFO')
  assert.match(controller, /heldResourceIds\.add\(id\)/, 'every queued row enters the held set immediately')
  assert.match(controller, /outcome\.finally/, 'a row leaves the held set only after its intent settles')
  assert.match(controller, /connectionRevision \?\? 0/, 'the controller pins the server-owned connection dimension')
  assert.match(
    controller,
    /onAccountSwitch\(\(\) => \{[\s\S]*heldResourceIds\.clear\(\)[\s\S]*controller\.clearAll\(\)[\s\S]*\}\)/,
    'old-account intent and row holds cannot land in a new account',
  )
  assert.match(notice, /kind="saved-context"/, 'recovery has one enumerable shell role')
  assert.match(deletionController, /createRevisionedDeletionMutationController/, 'removal reuses the shared destructive FIFO')
  assert.match(deletionController, /heldResourceIds\.add\(id\)/, 'a queued removal holds its row immediately')
  assert.match(deletionController, /connectionRevision \?\? 0/, 'removal rebases only the connection dimension')
  assert.match(deletionCore, /current === null/, 'authoritative absence heals a lost acknowledgement')
  assert.match(deletionNotice, /kind="saved-context-delete"/, 'removal recovery has one enumerable shell role')
})
