import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Provider removal is confirmed, dual-revision pinned, retained, and device-recoverable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'providerDeletionMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'providerDeletionMutationRuntime.ts')))
  const holds = stripComments(read(join(ROOT, 'src', 'controller', 'providerMutationHolds.ts')))
  const definition = stripComments(read(join(ROOT, 'src', 'controller', 'providerDefinitionMutations.ts')))
  const connection = stripComments(read(join(ROOT, 'src', 'controller', 'providerConnectionMutations.ts')))
  const catalogRefresh = stripComments(read(join(ROOT, 'src', 'controller', 'providerCatalogRefreshMutations.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProviderDefinitionMutationNotice.tsx')))

  assert.doesNotMatch(view, /deleteProvider\(/, 'the page cannot bypass acknowledged removal')
  assert.doesNotMatch(view, /removeDesktopProviderCredentials\(/,
    'the page cannot silently split server removal from device cleanup')
  assert.match(view, /<ConfirmDialog[\s\S]*title=\{`Remove \$\{provider\.label\}\?`\}/)
  assert.match(facade, /permanently removes the provider and its server-side connection/)
  assert.match(facade, /Conversations using it directly fall back to their Agent’s provider/)
  assert.match(facade, /credential stored on this device is erased/)
  assert.match(view, /heldProviderDeletions\(\)\.filter[\s\S]*!currentProviders\.some/)
  assert.match(view, /<AtomicResourcePage aria-busy=\{deleting\}>/)
  assert.match(view, /enqueueProviderDeletion\(provider\)/)

  assert.match(commands, /apiDelete\(paths\.provider\(id\), expected, \{ idempotencyKey \}\)/)
  assert.match(runtime, /expectedDefinitionRevision: provider\.definitionRevision \?\? 0/)
  assert.match(runtime, /expectedConnectionRevision: provider\.connectionRevision \?\? 0/)
  assert.match(runtime, /ProviderCredentialCleanupError/)
  assert.match(runtime, /removeDesktopProviderCredentials\(providerId\)/)
  assert.match(runtime, /acknowledgedProviderByKey/,
    'Retry after server acknowledgement can target only device cleanup')
  assert.match(runtime, /status === 409 && \/agent\/i[\s\S]*rebaseOnRetry: false/)
  assert.match(runtime, /status === 409[\s\S]*rebaseOnRetry: true/)
  assert.match(facade, /heldSnapshots\.set\(provider\.id, provider\)/)
  assert.match(holds, /'definition',[\s\S]*'connection',[\s\S]*'deletion'/)
  assert.match(definition, /acquireProviderMutation\('definition', providerId\)/)
  assert.match(connection, /acquireProviderMutation\('connection', intent\.providerId\)/)
  assert.match(catalogRefresh, /acquireProviderMutation\('connection', input\.providerId\)/)
  assert.match(notice, /kind="provider-delete"/)
})

test('shared built-in Providers do not advertise owner mutation controls', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(view, /const manageable = provider\.tenantId !== undefined/)
  for (const label of ['Edit provider', 'Update connection', 'Remove provider']) {
    assert.match(view, new RegExp(`manageable[\\s\\S]{0,500}label="${label}"`), label)
  }
  assert.match(view, /manageable && \(provider\.catalogSource === 'listed' \|\| !provider\.models\?\.length\)/)
  assert.match(view, /title="Relay"[\s\S]{0,250}actions=\{\s*manageable \? \(/)
})
