import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPOSITE_FEATURES,
  compositeCommandSnapshot,
  compositeFoldSnapshot,
  consumeCompositeCommand,
  focusedCompositeFoldSnapshot,
  publishFocusedCompositeFold,
  requestCompositeCommand,
  requestCompositeFold,
  subscribeCompositeCommand,
  subscribeCompositeFold,
  subscribeFocusedCompositeFold,
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
    'sessions',
    'dispatch',
    'customize',
    'admin',
  ])
  assert.equal(COMPOSITE_FEATURES.projects.primaryAction, 'New project')
  assert.equal(COMPOSITE_FEATURES.artifacts.search, 'Search artifacts')
  assert.equal(COMPOSITE_FEATURES.models.search, undefined)
  assert.equal(COMPOSITE_FEATURES.customize.fold, undefined)
  assert.equal(COMPOSITE_FEATURES.sessions.primaryAction, 'New session')
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

test('main bulk disclosure publishes one revisioned signal to the focused page', () => {
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

test('focused fold availability is owner-safe when split projections exchange focus', () => {
  let notifications = 0
  const unsubscribe = subscribeFocusedCompositeFold(() => notifications++)
  const oldPane = Symbol('old-pane')
  const newPane = Symbol('new-pane')
  publishFocusedCompositeFold(oldPane, { section: 'projects', canFold: true, canUnfold: false })
  assert.deepEqual(focusedCompositeFoldSnapshot(), {
    section: 'projects',
    canFold: true,
    canUnfold: false,
  })
  publishFocusedCompositeFold(newPane, { section: 'scheduled', canFold: false, canUnfold: true })
  publishFocusedCompositeFold(oldPane, null)
  assert.equal(focusedCompositeFoldSnapshot()?.section, 'scheduled', 'an old cleanup cannot erase the new focus')
  publishFocusedCompositeFold(newPane, null)
  assert.equal(focusedCompositeFoldSnapshot(), null)
  assert.equal(notifications, 3)
  unsubscribe()
})
