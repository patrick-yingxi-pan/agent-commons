import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPOSITE_FEATURES,
  compositeCommandSnapshot,
  compositeFoldSnapshot,
  consumeCompositeCommand,
  requestCompositeCommand,
  requestCompositeFold,
  subscribeCompositeCommand,
  subscribeCompositeFold,
} from './compositeFeatures.ts'

test('the composite capability catalog is total and names the standing page features', () => {
  assert.deepEqual(Object.keys(COMPOSITE_FEATURES), [
    'commons',
    'projects',
    'artifacts',
    'contexts',
    'models',
    'agents',
    'scheduled',
    'discussions',
    'messages',
    'notifications',
    'dispatch',
    'customize',
    'admin',
  ])
  assert.equal(COMPOSITE_FEATURES.projects.primaryAction, 'New project')
  assert.equal(COMPOSITE_FEATURES.artifacts.search, 'Search artifacts')
  assert.equal(COMPOSITE_FEATURES.models.search, undefined)
  assert.equal(COMPOSITE_FEATURES.customize.fold, undefined)
})

test('a rail command stays pending until the focused matching page consumes it', () => {
  let notifications = 0
  const unsubscribe = subscribeCompositeCommand(() => notifications++)
  requestCompositeCommand('artifacts', 'focus-search')
  const command = compositeCommandSnapshot()
  assert.deepEqual(command && { section: command.section, kind: command.kind }, {
    section: 'artifacts',
    kind: 'focus-search',
  })
  assert.equal(notifications, 1)

  consumeCompositeCommand((command?.revision ?? 0) + 1)
  assert.equal(compositeCommandSnapshot()?.revision, command?.revision, 'a different pane cannot consume the request')
  consumeCompositeCommand(command?.revision ?? 0)
  assert.equal(compositeCommandSnapshot(), null)
  assert.equal(notifications, 2)
  unsubscribe()
})

test('bulk disclosure publishes one revisioned signal to both projections', () => {
  let notifications = 0
  const unsubscribe = subscribeCompositeFold(() => notifications++)
  requestCompositeFold('projects', false)
  const folded = compositeFoldSnapshot()
  assert.deepEqual(folded && { section: folded.section, expanded: folded.expanded }, {
    section: 'projects',
    expanded: false,
  })
  requestCompositeFold('projects', true)
  const unfolded = compositeFoldSnapshot()
  assert.equal(unfolded?.expanded, true)
  assert.ok((unfolded?.revision ?? 0) > (folded?.revision ?? 0))
  assert.equal(notifications, 2)
  unsubscribe()
})
