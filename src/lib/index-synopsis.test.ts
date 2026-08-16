/** UI-36 — collection indexes are synopsis ledgers, not compressed detail cards.
 *
 * The shared page template owns the identity / descriptor / metadata hierarchy.
 * This suite enumerates every ordinary resource-index family that adopted it,
 * and separately proves that the Agents regression cannot grow its management
 * surface back into the overview row.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resourcePageComponent, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

const fn = (name: string) => stripComments(sectionViewComponent(name))
const templateFn = (name: string) => stripComments(resourcePageComponent(name))

test('the page template owns one frameless synopsis-row vocabulary', () => {
  const row = templateFn('ResourcePageSynopsisRow')
  for (const cue of ['data-resource-synopsis-row', 'LEDGER_ROW_CLASS', 'ROW_DOOR_CLASS', 'cardDoorClick', 'DOOR_CLASS']) {
    assert.match(row, new RegExp(cue), `the synopsis row owns ${cue}`)
  }
  for (const step of ['text-[13px]', 'text-[12px] text-ink-soft', 'text-[11px] text-ink-faint']) {
    assert.ok(row.includes(step), `the synopsis hierarchy keeps ${step}`)
  }
  assert.match(row, /titleClassName = 'text-ink'/, 'identity defaults to ink without conflicting color utilities')
  assert.doesNotMatch(row, /QUIET_CARD_CLASS|CARD_DOOR_CLASS|rounded-|\bborder\b/, 'an index synopsis draws no item box')
  assert.match(row, /@lg:block/, 'the descriptor yields before identity and state in a narrow pane')
})

test('ordinary resource indexes consume the synopsis funnel', () => {
  for (const name of [
    'ProjectRow',
    'ProviderRow',
    'AgentRow',
    'SharedProjectRow',
    'PublishedAgentRow',
    'DispatchView',
  ]) {
    assert.match(fn(name), /<SynopsisRow\b/, `${name} is a synopsis row`)
  }
  const work = fn('YourWorkTab')
  assert.ok((work.match(/<SynopsisRow\b/g) ?? []).length >= 2, 'both Your work collections use the synopsis funnel')
})

test('the Agents overview does not compress its canonical detail page into a row', () => {
  const agent = fn('AgentRow')
  for (const detail of [
    'MetricTile',
    'authorityLabel',
    'ChangelogList',
    'togglePublish',
    'A2aCardDialog',
    'AgentContributionLink',
  ]) {
    assert.doesNotMatch(agent, new RegExp(detail), `${detail} belongs on the canonical Agent page`)
  }
  assert.match(agent, /<CardActions\b/, 'small row-local edit/delete verbs remain available')
  assert.doesNotMatch(fn('AgentNestedGroup'), />Open page</, 'a group title does not restate its existing navigation door')
})

test('directories and administrative ledgers do not redraw list boxes', () => {
  for (const name of ['SharedProjectRow', 'PublishedAgentRow']) {
    assert.doesNotMatch(fn(name), /CommonsCard|QUIET_CARD_CLASS|rounded-|\bborder\b/, `${name} stays frameless`)
  }
  for (const name of [
    'AdminUserDetail',
    'AdminAccountsPanel',
    'AdminOrgsPanel',
    'AdminCredentialsPanel',
    'AdminAuditPanel',
  ]) {
    const source = fn(name)
    assert.match(source, /<CardList\b/, `${name} uses divider-ledger structure`)
    assert.doesNotMatch(source, /<MetricTile\b|QUIET_CARD_CLASS/, `${name} does not box its lists`)
  }
  assert.match(fn('AdminOpsPanel'), /<MetricTile\b/, 'independently comparable metric tiles retain meaningful containment')
})
