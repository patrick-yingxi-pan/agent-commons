import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Provider catalog refresh is revision-pinned, navigation-safe, and shell recoverable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'providerCatalogRefreshMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'providerCatalogRefreshMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ProviderCatalogRefreshMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = read(join(ROOT, 'server', 'routes', 'index.ts'))

  assert.doesNotMatch(view, /refreshProviderModels\(|refreshProviderCatalog\(/,
    'the Provider page cannot own refresh transport recovery')
  assert.match(view, /enqueueProviderCatalogRefresh\(\{[\s\S]*tenantId: me\.tenant\.id,[\s\S]*providerId: provider\.id,[\s\S]*expectedRevision: provider\.connectionRevision \?\? 0/)
  assert.match(view, /useProviderCatalogRefreshStatus\(\)[\s\S]*isProviderCatalogRefreshHeld\(provider\.id\)/,
    'the canonical action reconstructs its held label after navigation')
  assert.match(view, /manageable && \(provider\.catalogSource === 'listed' \|\| !provider\.models\?\.length\)/,
    'an owned endpoint without a catalog still exposes discovery recovery')
  assert.match(facade, /const heldRefreshes = new Map/)
  assert.match(facade, /acquireProviderMutation\('connection', input\.providerId\)/,
    'catalog refresh excludes endpoint replacement, secret rotation, and removal')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*heldRefreshes\.clear\(\)/)
  assert.match(runtime, /refreshProviderModels\(intent\.providerId, intent\.expectedRevision, idempotencyKey\)/)
  assert.match(runtime, /await reconcileProviderConnection\(intent\.providerId\)[\s\S]*return false/,
    'a revision or similar public catalog cannot prove this exact outbound refresh')
  assert.match(runtime, /discardReconcileFailure: 'retain'/)
  assert.match(commands, /\{ expectedRevision \} satisfies RefreshProviderModelsRequest[\s\S]*\{ idempotencyKey \}/)
  assert.match(route, /models\/refresh/)
  assert.match(route, /providerCatalogRefresh\(await body<unknown>\(\)\)/)
  assert.match(notice, /kind="provider-catalog-refresh"/)
  assert.match(shell, /<ProviderCatalogRefreshMutationNotice \/>/)
})
