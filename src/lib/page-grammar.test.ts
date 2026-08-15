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
