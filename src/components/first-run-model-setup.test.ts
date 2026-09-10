import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('a blocked fresh draft hands off to the canonical Models form and returns only after readiness', () => {
  const conversation = stripComments(read(join(ROOT, 'src', 'components', 'ConversationPane.tsx')))
  const empty = stripComments(read(join(ROOT, 'src', 'components', 'EmptyState.tsx')))
  const models = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))

  assert.match(conversation, /providersQ\.data !== undefined && modelSetupRequired\(providersQ\.data\)/,
    'unresolved provider reads never manufacture onboarding')
  assert.match(conversation, /onOpenModelSetup=\{needsModelSetup \? \(\) => relations\.navigate\('models'\)/,
    'the setup act uses the pane-local Models door')
  assert.match(empty, /<h2[^>]*>Connect a model to begin<\/h2>/,
    'the impossible typing invitation is replaced by an accessible setup heading')
  assert.match(empty, /After a connection is verified, this untouched draft reopens/,
    'the handoff states what success does')

  assert.match(models, /fromDraft = backTo\?\.kind === 'session' && backTo\.sessionId === DRAFT_ID/,
    'only a carried draft entry earns automatic setup')
  assert.match(models, /modelSetupRequired\(providersQ\.data\)[\s\S]*setEditing\('new'\)/,
    'that entry opens the existing provider form instead of duplicating it')
  const handoff = models.slice(models.indexOf('const providerCreated ='), models.indexOf("const [filter] = useSectionFilter('models')"))
  assert.match(handoff, /modelProviderAvailable\(created\)[\s\S]*updateModelPreferences\([\s\S]*outcome !== 'applied'[\s\S]*onBack\(\)/,
    'only a runnable provider with an acknowledged personal preference returns to the draft')
  assert.match(handoff, /!setupMounted\.current.*!fromDraftRef\.current.*providerIdRef\.current/,
    'a delayed preference save cannot pull a departed Models surface back to the draft')
})
