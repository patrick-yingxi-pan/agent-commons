/** Lock: every reading-page rail destination uses the Project page's grammar;
 *  atomic sessions declare the same resource template with workspace layout.
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
import { ROOT, read, resourcePageComponent, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import { SECTION_INSTANCE_KEY } from './subviews.ts'

const fn = (name: string) => stripComments(sectionViewComponent(name))
const templateFn = (name: string) => stripComments(resourcePageComponent(name))

test('every reading main page uses the one reading column', () => {
  const page = templateFn('ResourcePageFrame')
  const consumers = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(page, /max-w-3xl/, 'ResourcePageFrame owns the Project reading width for every reading destination')
  assert.doesNotMatch(page, /max-w-7xl/, 'collection roots cannot reopen to a second width')
  assert.match(page, /data-resource-nature/, 'the template stamps its ontology for browser review')
  assert.doesNotMatch(consumers, /max-w-3xl/, 'resource pages cannot redraw the template reading column')
})

test('collection roots derive from the composite frame and the one runtime collection template', () => {
  const collections = [
    'SessionsSection',
    'ProjectsSection',
    'ArtifactsSection',
    'ContextsSection',
    'ModelsSection',
    'ScheduledSection',
    'DiscussionsSection',
    'MessagesSection',
    'NotificationsSection',
    'DispatchView',
  ]
  const otherCompositePages = [
    'CommonsSection',
    'AgentCommonsSection',
    'AdminSection',
    'GenericSection',
  ]
  for (const name of [...collections.filter((name) => name !== 'DispatchView'), ...otherCompositePages]) {
    assert.match(fn(name), /<CompositeResourcePage\b/, `${name} derives from the composite page template`)
  }
  for (const name of collections) {
    assert.match(fn(name), /<MainCollectionTemplate\b/, `${name} delegates its collection body to the shared template`)
    assert.match(
      fn(name),
      /(?:flat|partitioned|structural)CollectionProjection\(/,
      `${name} declares runtime data through the typed projection grammar`,
    )
  }
  for (const name of ['ProjectsSection', 'ArtifactsSection', 'ContextsSection', 'ModelsSection', 'ScheduledSection']) {
    assert.match(fn(name), /<CompositePageControls\b/, `${name} exposes the composite view-control toolbar`)
  }
  const consumers = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const openings = [...consumers.matchAll(/<CompositeResourcePage\b([^>]*)>/g)]
  assert.ok(openings.length >= collections.length + otherCompositePages.length - 1, 'the section-scope scan has subjects')
  for (const opening of openings) {
    assert.match(opening[1], /\bsection=/, 'every composite page identifies its rail projection to the shared template')
  }
  const composite = templateFn('CompositeResourcePage')
  assert.match(
    composite,
    /<CompositeProjectionContext\.Provider value=\{projectSections \? section : null\}>/,
    'the shared composite template carries section identity only for rail-projected structure',
  )
  for (const primitive of ['ResourcePageSection', 'ResourcePageListPartition']) {
    const source = templateFn(primitive)
    assert.match(source, /data-main-projection-entry=/, `${primitive} enters the inverse browser enumeration`)
    assert.match(source, /data-projection-entry-label=/, `${primitive} exposes the label its rail entry must mirror`)
  }
  assert.match(
    templateFn('ResourcePageListPartition'),
    /data-main-list-partition=/,
    'the static list primitive declares the capability the browser must mirror',
  )
  assert.match(
    templateFn('ResourcePageSection'),
    /data-main-list-partition=\{projection && listPartition/,
    'only an explicitly classified view partition claims mirrored list disclosure',
  )
  const collectionTemplate = templateFn('MainCollectionTemplate')
  assert.match(collectionTemplate, /data-main-collection-template/, 'the main template exposes its projection for browser review')
  assert.match(collectionTemplate, /group\.presentation === 'flat'/, 'flat collections cannot grow a redundant heading')
  assert.match(collectionTemplate, /group\.presentation === 'static'/, 'static named lists use the one partition primitive')
  assert.match(collectionTemplate, /<ResourcePageSection/, 'foldable groups use the one structural-section primitive')
  assert.match(collectionTemplate, /persist=\{false\}/, 'runtime collection groups stay out of bounded preferences')
  assert.match(collectionTemplate, /listPartition=\{group\.role === 'partition'\}/,
    'the data role, not consumer markup, decides whether a group mirrors into the rail')
  assert.match(fn('GenericSection'), /projectSections=\{false\}/, 'Customize information regions never pose as rail structure')
  assert.doesNotMatch(
    consumers,
    /<FoldSection[^>]*\btitle="(?:Threads|Inbox|Conversations|Runs)"/,
    'a flat one-list root cannot add a page-only list wrapper',
  )
  assert.doesNotMatch(templateFn('ResourcePageSection'), /FoldGroupHeader/, 'FoldSection does not delegate to a second look')
  assert.throws(() => sectionViewComponent('FoldGroupHeader'), /has no top-level component/, 'the parallel hub-group primitive is gone')
})

test('the atomic and composite templates are semantic specializations of one frame', () => {
  const composite = templateFn('CompositeResourcePage')
  const atomic = templateFn('AtomicResourcePage')
  assert.match(composite, /<ResourcePageFrame nature="composite">/)
  assert.match(composite, /FoldScopeContext\.Provider/, 'only the composite template opens structural-section scope')
  assert.match(composite, /CompositeSectionPageContext\.Provider/, 'a selected structural child is forced open')
  assert.match(atomic, /<ResourcePageFrame nature="atomic" layout=\{layout\}/)
  assert.doesNotMatch(atomic, /FoldScopeContext|CompositeSectionPageContext/, 'visual regions do not turn an atomic leaf into navigation')
  const conversation = stripComments(read(join(ROOT, 'src', 'components', 'ConversationPane.tsx')))
  assert.match(conversation, /<AtomicResourcePage layout="workspace" data-conversation-pane=\{sessionId\}>/,
    'an atomic session derives from the template without losing its transcript/composer workspace')
})

test('the Models index uses the Project synopsis-row vocabulary, not provider cards', () => {
  const models = fn('ModelsSection')
  assert.match(models, /<MainCollectionTemplate\b/, 'providers share the collection container used by Projects')
  assert.match(models, /<ProviderRow\b/, 'each provider has a dedicated index synopsis')
  assert.doesNotMatch(models, /<ProviderDetailSections\b|<MetricTile\b|QUIET_CARD_CLASS/, 'the index never embeds provider detail or card chrome')

  assert.match(templateFn('MainCollectionTemplate'), /<ResourcePageList\b/,
    'the collection template owns the divider-list container for every index')

  const row = fn('ProviderRow')
  assert.match(row, /<SynopsisRow\b/, 'provider rows consume the Project synopsis funnel')
  const synopsis = templateFn('ResourcePageSynopsisRow')
  assert.match(synopsis, /LEDGER_ROW_CLASS/, 'the synopsis funnel owns Project row rhythm')
  assert.match(synopsis, /text-\[13px\]/, 'resource identity uses the Project title size')
  assert.match(synopsis, /titleClassName = 'text-ink'/, 'resource identity defaults to the Project title color')
  assert.match(synopsis, /text-\[12px\] text-ink-soft/, 'the single descriptor uses the Project body step')
  assert.match(synopsis, /text-\[11px\] text-ink-faint/, 'count or state uses the Project metadata step')
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
  assert.match(models, /rel\.navigate\('models', item\.value\.id\)/, 'the Models index and rail share the canonical provider door')
})

test('a recognized detail URL that cannot resolve keeps one honest unavailable main page', () => {
  const unavailable = templateFn('ResourceUnavailablePage')
  assert.match(unavailable, /<AtomicResourcePage data-resource-unavailable=\{state\}>/,
    'the unavailable face is an atomic page and exposes its state to browser review')
  assert.match(unavailable, /state: 'loading' \| 'missing'/, 'loading cannot flash the terminal missing copy')
  assert.match(unavailable, /<BackButton to=\{backTo\} onBack=\{onBack\}/, 'the stranded address keeps an explicit way out')

  // These are the data-backed SECTION_INSTANCE_KEY leaves. A typo, stale link,
  // hidden foreign id, or deleted row must never leave the collection index in
  // place under a detail address. Existence-hiding deliberately shares the same
  // terminal face as an absent id.
  for (const [section, id, title] of [
    ['ProjectsSection', 'projectId', 'Project'],
    ['ArtifactsSection', 'artifactId', 'Artifact'],
    ['ContextsSection', 'contextId', 'Context'],
    ['ModelsSection', 'providerId', 'Provider'],
    ['ScheduledSection', 'scheduleId', 'Routine'],
  ] as const) {
    const source = fn(section)
    assert.match(source, new RegExp(`if \\(${id}\\)[\\s\\S]*?<UnavailableResourcePage[\\s\\S]*?title="${title}"`),
      `${section} owns an unavailable face for its unresolved detail id`)
    assert.match(source, /state=\{[^}]*\? 'loading' : 'missing'\}/,
      `${section} separates the pending and terminal states`)
  }
  const discussion = fn('DiscussionPage')
  assert.match(discussion, /<UnavailableResourcePage[\s\S]*?title="Discussion"/,
    'the asynchronously fetched discussion leaf consumes the same unavailable face')
  assert.match(discussion, /state=\{!d && q\.status === 'error' \? 'missing' : 'loading'\}/,
    'the discussion keeps its feed-disambiguation wait distinct from a terminal miss')
})

test('every detail page derives from the template matching its resource nature', () => {
  for (const name of ['ProjectDetail', 'ScheduledDetail', 'OwnerProfilePage']) {
    const page = fn(name)
    assert.match(page, /<CompositeResourcePage\b/, `${name} derives from the composite template`)
    assert.match(page, /<CompositePageControls\b/, `${name} offers the template's discovered fold controls`)
  }

  for (const name of [
    'ContextDetail',
    'ProviderDetailPage',
    'AgentPublicPage',
    'PromptDetailPage',
    'ToolDetailPage',
    'AdminUserDetail',
    'WorkItemPage',
    'ContributionPage',
    'DiscussionPage',
  ]) {
    const page = fn(name)
    assert.match(page, /<AtomicResourcePage\b/, `${name} derives from the atomic page template`)
    if (name === 'ProviderDetailPage') {
      assert.match(page, /<ProviderDetailSections\b/, 'the provider page delegates to its detail-section body')
      assert.match(fn('ProviderDetailSections'), /<FoldSection\b/, 'the provider detail body expresses its groups through FoldSection')
    } else if (!['WorkItemPage', 'ContributionPage', 'DiscussionPage'].includes(name)) {
      assert.match(page, /<FoldSection\b/, `${name} expresses structural groups through FoldSection`)
    }
    assert.match(page, /PAGE_HEADER_CLASS|<PageHeader\b/, `${name} uses the shared page-header vocabulary`)
  }

  const artifacts = fn('ArtifactsSection')
  assert.match(artifacts, /if \(openArtifact\)[\s\S]*?<AtomicResourcePage>/, 'an artifact leaf uses the atomic template')
  assert.match(artifacts, /<CompositeResourcePage\b[\s\S]*?<PageHeader title="Artifacts"/, 'the artifact index uses the composite template')
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
  const section = templateFn('ResourcePageSection')
  assert.match(section, /persist = true/, 'stable entity sections persist by default')
  assert.match(section, /const \[localFolded, setLocalFolded\] = useState/, 'dynamic groups have local disclosure state')
  assert.match(section, /persist \? storedFolded : localFolded/, 'one component selects the honest state source')
  assert.match(section, /register\?\.register/, 'local and stored bands both join the in-memory page fold scope')
  assert.doesNotMatch(section, /persist \? register/, 'joining Fold all does not make a dynamic band persistent')
  const collectionTemplate = templateFn('MainCollectionTemplate')
  assert.match(collectionTemplate, /<ResourcePageSection[\s\S]*?persist=\{false\}/,
    'the collection template keeps every runtime band out of bounded preferences')
  for (const name of ['ProjectsSection', 'ArtifactsSection', 'ContextsSection', 'ScheduledSection']) {
    assert.match(fn(name), /<MainCollectionTemplate\b/, `${name}'s data-defined bands use the non-persistent template path`)
  }
})

test('a FoldSection owns its list inset exactly once', () => {
  assert.match(templateFn('ResourcePageSection'), /data-resource-section=\{title\}/, 'browser checks can address a structural section without guessing DOM depth')
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
