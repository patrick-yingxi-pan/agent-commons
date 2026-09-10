import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('provider onboarding is one acknowledgement-owned form and credential ceremony', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'providerCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'providerCreationMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProviderCreationMutationNotice.tsx')))

  assert.doesNotMatch(view, /createProvider\(/, 'the dialog cannot bypass acknowledged creation')
  assert.equal(
    (view.match(/enqueueProviderCreation\(\{/g) ?? []).length,
    2,
    'endpoint and Session providers enter the same controller',
  )
  assert.match(view, /busy=\{busy\}/, 'the shared dialog freezes the exact submitted fields')
  assert.match(view, /Your provider details are still here/, 'Dismiss preserves the authored form')
  assert.match(controller, /intentId: crypto\.randomUUID\(\)/, 'one form submission owns one logical identity')
  assert.match(controller, /captureProviderCreationSource/, 'the activation account is frozen before native or transport work')
  assert.doesNotMatch(controller, /import\(/, 'provider submission cannot depend on a newly fetched runtime chunk')
  assert.match(controller, /createAcknowledgedActionMutationController/, 'one ready queue owns creation and recovery')
  assert.doesNotMatch(controller, /discardProviderCreationResources/, 'Dismiss cannot delete a key while an aborted request may still commit')
  assert.match(commands, /providerCreationId\(intent\.tenantId, idempotencyKey\)/, 'reconciliation proves the exact tenant-scoped row')
  assert.match(commands, /represented\.kind === 'session'[\s\S]*apiPost<CreatedProvider>/, 'Session reconciliation recovers the same-key one-time secret')
  assert.match(controller, /prepareProviderCreationCredential\(intent, credentials\)[\s\S]*applyProviderCreation/, 'the vault reference exists before the server probe')
  assert.match(controller, /bindProviderCreationCredential\(intent, provider\.id, credentials\)/, 'only acknowledged server identity binds the key')
  assert.match(controller, /definitelyUnapplied[\s\S]*discardProviderCreationCredential/, 'only a definitive refusal discards before user recovery')
  assert.match(notice, /kind="provider-create"/, 'uncertainty has one shell-owned recovery surface')
})
