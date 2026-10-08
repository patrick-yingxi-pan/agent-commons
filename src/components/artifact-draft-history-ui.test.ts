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
  assert.match(editor, /!undoManaged && removed/)
  assert.match(editor, /!undoManaged && currentPaste\.before/)
  assert.match(editor, /<StructuredArtifactFields[^>]*undoManaged/)
})
