import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Context connection controls enter one held acknowledgement queue', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const connectorDetail = stripComments(read(join(ROOT, 'src', 'components', 'ConnectorPanel.tsx')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'savedContextConnectionMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SavedContextMutationNotice.tsx')))

  assert.match(view, /updateSavedContextConnection\(/, 'the rendered toggle enters the controller')
  assert.doesNotMatch(view, /setConnectorStatus\(/, 'no optimistic command bypass survives')
  assert.match(view, /disabled=\{connectionHeld\}/, 'the addressed controls stay held through pending or failed delivery')
  assert.match(view, /isSavedContextConnectionHeld\(id\)/, 'queued rows are held before they reach the FIFO head')
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
})
