import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Provider connection replacement is private, navigation-safe, and shell recoverable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'providerConnectionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'providerConnectionMutationRuntime.ts')))
  const core = stripComments(read(join(ROOT, 'src', 'controller', 'providerConnectionCore.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProviderConnectionMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(view, /replaceProviderConnection\(/, 'the dialog cannot own transport recovery')
  assert.match(view, /enqueueProviderConnection\(\{ tenantId: me\.tenant\.id, providerId: provider\.id, attempt \}\)/)
  assert.match(view, /providerId !== updatingConnectionId[\s\S]*setUpdatingConnectionId\(null\)/,
    'leaving the Provider page does not resurrect a blank modal')
  assert.match(view, /busy=\{busy && !recoveryOwned\}[\s\S]*fieldsDisabled=\{busy\}[\s\S]*cancelLabel=\{recoveryOwned \? 'Close form' : 'Cancel'\}/,
    'the frozen dialog may leave once shell recovery owns an uncertain result')
  assert.match(view, /useProviderConnectionStatus\(\)[\s\S]*isProviderConnectionHeld\(provider\.id\)/,
    'the canonical action reconstructs its held state after navigation')
  assert.match(facade, /const heldConnections = new Map/)
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*heldConnections\.clear\(\)/)
  assert.doesNotMatch(facade, /statusStore\.publish\([^)]*(?:attempt|patch|reference|deviceSecret|idempotencyKey)/,
    'public status never projects endpoint or credential material')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.attempt\.idempotencyKey/)
  assert.match(runtime, /await reconcileProviderConnection\(intent\.providerId\)[\s\S]*return false/,
    'a public revision cannot prove an exact hidden write')
  assert.match(runtime, /discardReconcileFailure: 'retain'/,
    'Dismiss cannot release while the final truth read is unavailable')
  assert.match(core, /attempt\.deviceSecret = undefined/,
    'the raw key is released as soon as the OS vault returns a reference')
  assert.match(notice, /kind="provider-connection"/)
  assert.match(shell, /<ProviderConnectionMutationNotice \/>/)
})
