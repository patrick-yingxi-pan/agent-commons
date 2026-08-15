/** Lock: every rail destination uses the Project page's main-page grammar.
 *
 * The regression this names was visible on `/projects`: a Project detail was a
 * `max-w-3xl` reading page of FoldSections, while the Projects root reopened to
 * `max-w-7xl` and redrew the same grouped-resource problem with ledger heads.
 * The user then had to learn two hierarchies for one kind of page. Collection
 * roots now keep their resource-specific rows/cards, but the page and section
 * frame are closed vocabulary.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import { SECTION_INSTANCE_KEY } from './subviews.ts'

const fn = (name: string) => stripComments(sectionViewComponent(name))

test('every main page uses the one reading column', () => {
  const page = fn('Page')
  assert.match(page, /max-w-3xl/, 'Page owns the Project reading width for every rail destination')
  assert.doesNotMatch(page, /max-w-7xl/, 'collection roots cannot reopen to a second width')
})

test('collection roots use FoldSection, never a parallel group-header primitive', () => {
  for (const name of [
    'ProjectsSection',
    'ArtifactsSection',
    'ContextsSection',
    'ModelsSection',
    'AgentCommonsSection',
    'ScheduledSection',
    'CommonsSection',
    'DiscussionsSection',
    'MessagesSection',
    'NotificationsSection',
    'AdminSection',
    'GenericSection',
  ]) {
    assert.match(fn(name), /<Page\b/, `${name} uses the shared reading-page wrapper`)
    assert.match(fn(name), /<FoldSection\b/, `${name} projects its groups through FoldSection`)
  }
  assert.doesNotMatch(fn('FoldSection'), /FoldGroupHeader/, 'FoldSection does not delegate to a second look')
  assert.throws(() => sectionViewComponent('FoldGroupHeader'), /has no top-level component/, 'the parallel hub-group primitive is gone')
})

test('the Models index uses the Project synopsis-row vocabulary, not provider cards', () => {
  const models = fn('ModelsSection')
  assert.match(models, /<CardList\b/, 'providers share the divider-list container used by Projects')
  assert.match(models, /<ProviderRow\b/, 'each provider has a dedicated index synopsis')
  assert.doesNotMatch(models, /<ProviderDetailSections\b|<CommonsCard\b/, 'the index never embeds provider detail or card chrome')

  const row = fn('ProviderRow')
  assert.match(row, /LEDGER_ROW_CLASS/, 'provider rows share the Project row rhythm')
  assert.match(row, /text-\[13px\] text-ink/, 'provider identity uses the Project title step')
  assert.match(row, /text-\[12px\] text-ink-soft/, 'the single descriptor uses the Project body step')
  assert.match(row, /text-\[11px\] text-ink-faint/, 'count or connection state uses the Project metadata step')
  for (const detail of ['effortLevels', 'authorityLabel', 'providerPlanLabel', 'CardActions', 'onEdit']) {
    assert.doesNotMatch(row, new RegExp(detail), `${detail} belongs on the provider page, not its index row`)
  }
})

test('every instance rail branch resolves to an honest canonical main page', () => {
  // This table is intentionally total over SECTION_INSTANCE_KEY. Adding a new
  // instance branch without naming its detail renderer fails on the key-set
  // assertion before a focus-only/list-only escape can ship unnoticed.
  const detailBySection = {
    projects: 'ProjectDetail',
    artifacts: 'ArtifactDetailPage',
    contexts: 'ContextDetail',
    models: 'ProviderDetailPage',
    scheduled: 'ScheduledDetail',
    discussions: 'DiscussionPage',
  } as const
  assert.deepEqual(Object.keys(detailBySection).sort(), Object.keys(SECTION_INSTANCE_KEY).sort())

  const sectionView = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  for (const [section, detail] of Object.entries(detailBySection)) {
    assert.match(sectionView, new RegExp(`<${detail}\\b`), `${section} routes an instance to ${detail}`)
  }

  const models = fn('ModelsSection')
  assert.match(models, /if \(providerId\)/, 'a provider id changes the rendered main surface')
  assert.match(models, /<ProviderDetailPage\b/, 'the provider leaf gets its own page')
  assert.doesNotMatch(models, /scrollIntoView|FOCUS_FLASH_CLASS|focusRef/, 'a provider URL never merely focuses its index card')
  assert.match(models, /rel\.navigate\('models', p\.id\)/, 'the Models index and rail share the canonical provider door')
})

test('stable multi-group detail pages use the Project section grammar', () => {
  for (const name of [
    'ProjectDetail',
    'ContextDetail',
    'ProviderDetailPage',
    'OwnerProfilePage',
    'AgentPublicPage',
    'PromptDetailPage',
    'ToolDetailPage',
    'AdminUserDetail',
    'ScheduledDetail',
  ]) {
    const page = fn(name)
    assert.match(page, /<Page\b/, `${name} uses the shared reading page`)
    if (name === 'ProviderDetailPage') {
      assert.match(page, /<ProviderDetailSections\b/, 'the provider page delegates to its detail-section body')
      assert.match(fn('ProviderDetailSections'), /<FoldSection\b/, 'the provider detail body expresses its groups through FoldSection')
    } else {
      assert.match(page, /<FoldSection\b/, `${name} expresses structural groups through FoldSection`)
    }
    assert.match(page, /PAGE_HEADER_CLASS|<PageHeader\b/, `${name} uses the shared page-header vocabulary`)
  }

  // These are atomic timeline/content pages, not grouped configuration pages;
  // variation belongs in their payload, while Page + header stay invariant.
  for (const name of ['WorkItemPage', 'ContributionPage', 'DiscussionPage']) {
    const page = fn(name)
    assert.match(page, /<Page\b/, `${name} stays in the shared reading page`)
    assert.match(page, /PAGE_HEADER_CLASS/, `${name} keeps the shared header vocabulary`)
  }
})

test('cross-file detail bodies receive the one FoldSection instead of redrawing it', () => {
  const section = fn('ArtifactsSection')
  assert.match(section, /<ArtifactDetailPage[\s\S]*?Section=\{FoldSection\}/)
  assert.match(fn('ScheduledDetail'), /<ProposalsPanel[\s\S]*?Section=\{FoldSection\}/)

  const artifact = stripComments(read(join(ROOT, 'src', 'components', 'artifactPreview.tsx')))
  assert.match(artifact, /Section: MainPageSectionComponent/, 'artifact detail requires the shared section component')
  for (const title of ['Content', 'Sharing', 'Provenance']) {
    assert.match(artifact, new RegExp(`<Section[\\s\\S]{0,220}?title="${title}"`), `artifact ${title} uses the injected section`)
  }
  assert.match(artifact, /<ProposalsPanel[\s\S]{0,180}?Section=\{Section\}/, 'artifact Improvements uses the same section')

  const proposals = stripComments(read(join(ROOT, 'src', 'components', 'ProposalsPanel.tsx')))
  assert.match(proposals, /Section: MainPageSectionComponent/, 'Improvements cannot render without the shared section')
  assert.match(proposals, /<Section[\s\S]{0,160}?title="Improvements"/)
  assert.doesNotMatch(proposals, /rounded-lg border border-line bg-surface/, 'Improvements does not redraw a framed section shell')
})

test('dynamic collection bands reuse the frame without growing uiPrefs', () => {
  const section = fn('FoldSection')
  assert.match(section, /persist = true/, 'stable entity sections persist by default')
  assert.match(section, /const \[localFolded, setLocalFolded\] = useState/, 'dynamic groups have local disclosure state')
  assert.match(section, /persist \? storedFolded : localFolded/, 'one component selects the honest state source')
  assert.match(section, /persist \? register/, 'local bands do not join a persisted Fold-all registry')
  for (const name of ['ProjectsSection', 'ArtifactsSection', 'ContextsSection', 'ScheduledSection']) {
    assert.match(fn(name), /persist=\{false\}/, `${name}'s data-defined bands stay out of bounded preferences`)
  }
})

test('a FoldSection owns its list inset exactly once', () => {
  for (const name of ['ContextRow', 'ScheduledRow']) {
    const row = fn(name)
    assert.match(row, /flex min-w-0 flex-1 items-center gap-3 py-3/, `${name}'s payload starts at the section inset`)
    assert.match(row, /flex shrink-0 items-center gap-2/, `${name}'s controls end at the section inset`)
    assert.doesNotMatch(row, /gap-3 px-4 py-3|gap-2 pr-4/, `${name} does not re-apply the old root-page padding`)
  }
  const notificationRow = stripComments(read(join(ROOT, 'src', 'components', 'NotificationList.tsx')))
  assert.match(notificationRow, /flex items-start gap-3 py-3/, 'notification rows share the section inset')
  assert.doesNotMatch(notificationRow, /gap-3 px-4 py-3/, 'notification rows do not double-inset')
})
