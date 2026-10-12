import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('all complete Artifact formats share one local history control and keyboard scope', () => {
  const scope = read('./ArtifactDraftHistory.tsx')
  const editor = read('./StructuredArtifactEditor.tsx')
  const page = read('./artifactPreview.tsx')
  assert.match(editor, /<ArtifactDraftHistory/)
  assert.match(editor, /history=\{history\}/)
  assert.match(scope, /data-artifact-draft-history/)
  assert.match(scope, /onKeyDownCapture/)
  assert.match(scope, /nativeEvent\.isComposing/)
  assert.match(scope, /event\.preventDefault\(\)/, 'native field undo cannot diverge from the shared draft history')
  for (const action of ['undo', 'redo']) {
    assert.ok(page.includes(`artifactEditDrafts.${action}(artifact.id)`))
  }
  assert.match(scope, /disabled=\{disabled \|\| !history\.canUndo\}/)
  assert.match(scope, /disabled=\{disabled \|\| !history\.canRedo\}/)
  assert.match(scope, /onFocusCapture/)
  assert.match(scope, /onBlurCapture/)
  assert.match(scope, /onPasteCapture/)
  assert.match(scope, /onClickCapture/)
  assert.match(scope, /\.isConnected/)
  assert.doesNotMatch(scope, /addEventListener\(['"]keydown|window\.onkeydown|localStorage|sessionStorage|fetch\(/)
})

test('creation-only one-step reversals do not compete with saved-editor draft history', () => {
  const editor = read('./StructuredArtifactEditor.tsx')
  assert.match(editor, /undoManaged/)
  assert.match(editor, /!undoManaged && currentRemoved/)
  assert.match(editor, /const currentRemoved = removed\?\.after === JSON\.stringify\(body\) \? removed : null/,
    'creation-only removal Undo refuses a changed whole-workbook pre-image')
  assert.match(editor, /if \(currentRemoved !== removed\) setRemoved\(currentRemoved\)/,
    'later equal content cannot resurrect an expired creation Undo')
  assert.match(editor, /!undoManaged && currentPaste\.before/)
  assert.match(editor, /<StructuredArtifactFields[^>]*undoManaged/)
})

test('transient worksheet-name fields keep native text undo outside artifact body history', () => {
  const scope = read('./ArtifactDraftHistory.tsx')
  const editor = read('./StructuredArtifactEditor.tsx')
  assert.match(editor, /aria-label="Worksheet name"[^>]*data-artifact-transient-input/,
    'unapplied worksheet names are marked as transient rather than authored body input')
  assert.match(scope, /target instanceof Element && target\.closest\('\[data-artifact-transient-input\]'\)/,
    'the global keyboard shortcut leaves native undo available in marked transient fields')
  const transientGuard = scope.indexOf("target.closest('[data-artifact-transient-input]')")
  const preventDefault = scope.indexOf('event.preventDefault()', transientGuard)
  assert.ok(transientGuard >= 0 && preventDefault > transientGuard,
    'marked transient inputs are exempted before the shared handler prevents the native undo event')
})
