import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (name: string) => stripComments(read(join(ROOT, 'src', 'components', name)))

test('Discussion remains an optional Add context branch backed by its own deferred picker', () => {
  const add = source('AddContextButton.tsx')
  const workflow = source('ContextPickerWorkflow.tsx')
  const deferred = source('DeferredDiscussionContextPicker.tsx')
  assert.match(add, /export type TypeId = ContextTypeId \| 'discussion'/)
  assert.match(add, /DeferredContextPickerWorkflow/)
  assert.match(workflow, /addedDiscussionIds = attachments\.filter\(\(a\) => a\.kind === 'discussion'\)/)
  assert.match(workflow, /type === 'discussion'[\s\S]*<DiscussionPicker/)
  assert.match(workflow, /isDraft=\{!sessionId \|\| sessionId === DRAFT_ID\}/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/DiscussionContextPicker\.tsx'\)/)
  assert.match(deferred, /Couldn’t load discussion options\. Nothing was added\./)
})

test('picker attaches only a currently readable discussion after explicit copy acknowledgement', () => {
  const picker = source('DiscussionContextPicker.tsx')
  assert.match(picker, /useMyDiscussions\(\)/)
  assert.match(picker, /query\.status === 'success' \? query\.data \?\? \[\] : \[\]/)
  assert.match(picker, /query\.status === 'error'[\s\S]*Nothing was added/)
  assert.match(picker, /Everyone with access to the destination conversation can read it/)
  assert.match(picker, /Revoking access to the source later won’t erase this copy or earlier replies/)
  assert.match(picker, /It won’t update live/)
  assert.match(picker, /capture the copy on its first send, after checking that you can still read the source/)
  assert.match(picker, /onAdd\(\{ kind: 'discussion', attachment \}\)/)
  assert.match(picker, /discussionCaptureId: crypto\.randomUUID\(\)/)
  assert.match(picker, /onClick=\{\(\) => setSelectedId\(null\)\}/)
})

test('discussion context panel renders only the saved snapshot and exposes callback-owned actions', () => {
  const panel = source('DiscussionContextPanel.tsx')
  assert.match(panel, /const snapshot = attachment\.discussionSnapshot/)
  assert.match(panel, /readOnly[\s\S]*value=\{snapshot\.text\}/)
  assert.match(panel, /snapshot\.capturedAt/)
  assert.match(panel, /snapshot\.postCount/)
  assert.match(panel, /onRefresh\(attachment\)/)
  assert.match(panel, /onRemove\(attachment\.id\)/)
  assert.match(panel, /onOpenSource\(snapshot\.discussionId\)/)
  assert.doesNotMatch(panel, /useDiscussion|apiGet|fetch\(/)
  assert.match(panel, /captured on the first send, after checking that you can still read the source/)
})

test('both panel tiers share owner-gated commands, local draft removal, and a working close', () => {
  for (const host of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) assert.match(source(host), /<DeferredDiscussionContextPanel/)
  const deferred = source('DeferredDiscussionContextPanel.tsx')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/SessionDiscussionContextPanel'\)/)
  assert.match(deferred, /Couldn’t load this discussion copy/)
  const host = source('SessionDiscussionContextPanel.tsx')
  assert.match(host, /useContextWritable\(sessionId\)/)
  assert.match(host, /writable && sessionId !== DRAFT_ID/)
  assert.match(host, /if \(sessionId === DRAFT_ID\) draft\.removeContexts\(focus\)/)
  assert.match(host, /else void removeContexts\(focus\)/)
  assert.match(host, /onClose=\{onClose\}/)
  assert.match(source('DiscussionContextPanel.tsx'), /onClose=\{onClose\}/)
  assert.match(source('SectionView.tsx'), /onAttach=\{attachToProject\}\s+referenceCopiesEnabled=\{false\}/)
})
