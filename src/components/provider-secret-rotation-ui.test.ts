import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Session-secret rotation is exact, held globally, and never component-local', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'providerSecretRotationCommands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'providerSecretRotationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'providerSecretRotationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProviderSecretRotationMutationNotice.tsx')))
  const reveal = stripComments(read(join(ROOT, 'src', 'components', 'RelaySecretPanel.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.match(view, /enqueueProviderSecretRotation\(\{[\s\S]*expectedRevision: provider\.connectionRevision \?\? 0/)
  assert.doesNotMatch(view, /setRotated|rotateProviderSecret\(/, 'page-local transport hope cannot own a credential reveal')
  assert.match(commands, /apiGet<ModelProvider>\(paths\.provider\(intent\.providerId\)\)/)
  assert.match(commands, /represented\.secretRotationReceipt\?\.id !== expectedId/)
  assert.match(commands, /apiPost<CreatedProvider>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /apiDelete<ModelProvider>[\s\S]*\{ idempotencyKey \}/)
  assert.match(runtime, /createRecoverableSecretMutationController/)
  assert.match(facade, /retainProviderSecretRotationIntent\(intent\)/)
  assert.match(facade, /acquireProviderMutation\('connection', intent\.providerId\)/)
  assert.match(facade, /if \(!reveal\) releaseHeldRotation\(intent\)/, 'the connection lease survives until Done when a secret was revealed')
  assert.match(facade, /reveal = null[\s\S]*releaseHeldRotation\(intent\)/)
  assert.match(notice, /resumeProviderSecretRotation\(identityKey\)/)
  assert.match(notice, /discardLabel="Cancel request"/)
  assert.match(notice, /<RelaySecretPanel/)
  assert.match(reveal, /live\.connectionRevision \?\? 0\) === \(provider\.connectionRevision \?\? 0\)/, 'stale pre-rotation liveness cannot unlock Done for the replacement secret')
  assert.match(shell, /<ProviderSecretRotationMutationNotice \/>/)
})
