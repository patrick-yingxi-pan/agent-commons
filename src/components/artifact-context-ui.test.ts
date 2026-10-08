import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (name: string) => stripComments(read(join(ROOT, 'src', 'components', name)))

test('Artifact stays in the optional Add context workflow and gets its own deferred picker', () => {
  const add = source('AddContextButton.tsx')
  const workflow = source('ContextPickerWorkflow.tsx')
  const deferred = source('DeferredArtifactContextPicker.tsx')
  assert.match(add, /export type TypeId = ContextTypeId[^\n]*'artifact'/)
  assert.match(workflow, /addedArtifactIds = attachments\.filter\(\(a\) => a\.kind === 'artifact'\)/)
  assert.match(workflow, /type === 'artifact'[\s\S]*<ArtifactPicker/)
  assert.match(workflow, /isDraft=\{!sessionId \|\| sessionId === DRAFT_ID\}/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ArtifactContextPicker\.tsx'\)/)
  assert.match(deferred, /Nothing was added/)
})

test('Artifact picker confirms copy disclosure and queues only an exact source identity for drafts', () => {
  const picker = source('ArtifactContextPicker.tsx')
  assert.match(picker, /useArtifacts\(\)/)
  assert.match(picker, /Attach a saved copy/)
  assert.match(picker, /Add to draft/)
  assert.match(picker, /Everyone with access to the destination conversation can read it/)
  assert.match(picker, /Revoking access to the source later won’t erase this copy/)
  assert.match(picker, /It won’t update live/)
  assert.match(picker, /artifactContextId\(/)
  assert.match(picker, /artifactCaptureId:\s*crypto\.randomUUID\(\)/)
  assert.doesNotMatch(picker, /previewText\s*:/, 'the picker must not turn an excerpt into the saved copy')
})

test('Artifact context panel reads the saved body and exposes explicit callback-owned actions', () => {
  const panel = source('ArtifactContextPanel.tsx')
  assert.match(panel, /const snapshot = attachment\.artifactSnapshot/)
  assert.match(panel, /role="region" aria-label="Saved Artifact content"/)
  assert.match(panel, /SavedArtifactBodyView body=\{snapshot\.body\}/)
  assert.match(panel, /Refresh copy/)
  assert.match(panel, /View source Artifact/)
  assert.match(panel, /onRefresh\(attachment\)/)
  assert.match(panel, /onRemove\(attachment\.id\)/)
  assert.doesNotMatch(panel, /useArtifactContent|apiGet|fetch\(/, 'opening a saved copy never rereads its mutable source')

  const wrapper = source('SessionArtifactContextPanel.tsx')
  assert.match(wrapper, /useContextWritable\(sessionId\)/)
  assert.match(wrapper, /writable && sessionId !== DRAFT_ID/)
  assert.match(wrapper, /draft\.removeContexts/)
  assert.match(wrapper, /removeContexts\(/)
})

test('saved Artifact bodies use the canonical read-only renderer for all authored body families', () => {
  const preview = source('artifactPreview.tsx')
  const saved = preview.slice(preview.indexOf('export function SavedArtifactBodyView'), preview.indexOf('export function ArtifactBodyView'))
  assert.match(saved, /body\.type === 'doc'[\s\S]*<DocView/)
  assert.match(saved, /body\.type === 'figure'[\s\S]*<FigureView/)
  assert.match(saved, /<StructuredArtifactView body=\{body\} size=\{size\}/)
  assert.doesNotMatch(saved, /useArtifactContent|useFsText|useArtifactEditDraft|<LocusGutter|<ProposalsPanel/,
    'a conversation copy reads only its snapshotted body; it never gains mutable source, editor, or discussion affordances')

  const structured = source('StructuredArtifactView.tsx')
  assert.match(structured, /body\.type === 'workbook'[\s\S]*<StructuredWorkbookView/)
  assert.match(structured, /body\.type === 'sheet'[\s\S]*<StructuredSheetView/)
  assert.match(structured, /<StructuredSlidesView/)
})

test('both panel projections route Artifact focus through the same deferred, owner-gated panel', () => {
  for (const host of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    assert.match(source(host), /<DeferredArtifactContextPanel/)
  }
  const deferred = source('DeferredArtifactContextPanel.tsx')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/SessionArtifactContextPanel'\)/)
  assert.match(deferred, /saved Artifact copy is unchanged|Saved Artifact copy is unchanged/)
})
