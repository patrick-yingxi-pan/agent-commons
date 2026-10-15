import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (path: string) => stripComments(read(join(ROOT, path)))

test('captured-image OCR has an explicit native-only gesture fenced by current receipt and account', () => {
  const action = source('src/components/LocalPreviewArtifactAction.tsx')
  assert.ok(action.includes('localPreviewImageImport(preview)'))
  assert.ok(action.includes('preview && image && imageOcrAvailable'))
  assert.ok(action.includes('disabled || receipt === null || !isCurrent?.(receipt) || !desktopImageOcrAvailable()'))
  assert.ok(action.includes('setDraft({ image, sourceName: preview.path, generation: accountGeneration() })'))
  assert.ok(action.includes('useEffect(() => onAccountSwitch(() => setDraft(null)), [])'))
  assert.ok(action.includes('draft.generation === accountGeneration()'))
  assert.ok(action.includes('initialImage={draft.image ? { file: draft.image, sourceName: draft.sourceName, generation: draft.generation } : undefined}'))
  assert.ok(!action.includes('recognizeDesktopImageText(') && !action.includes('enqueueArtifactCreation('))
})

test('image seed uses the ordinary OCR review lifetime, not document text import or implicit adoption', () => {
  const form = source('src/components/NewArtifactDialog.tsx')
  const deferred = source('src/components/DeferredNewArtifactDialog.tsx')
  const documentImport = source('src/lib/useArtifactDocumentImport.ts')
  const intake = source('src/lib/useArtifactFileImport.ts')
  assert.ok(form.includes('!held && initialImage?.generation === accountGeneration() ? initialImage : null'))
  assert.ok(form.includes("useArtifactDocumentImport(draftKind === 'doc' && !busy, imageSource ?? undefined)"))
  assert.ok(form.includes('imageSource && !heldRequest'))
  assert.ok(form.includes('|| initialImage !== undefined') && deferred.includes('|| props.initialImage !== undefined'))
  assert.ok(documentImport.includes("initialImage ? { ...initialImage, selectionMode: 'image-text' } : undefined"))
  assert.ok(intake.includes('selectionMode: seed.selectionMode ?? mode'))
  assert.ok(intake.includes('review([seed.file], current.abort.signal, current.selectionMode)'))
  assert.ok(intake.includes('seed.generation !== accountGeneration() || operation.current'))
  assert.ok(intake.includes('!current.abort.signal.aborted && current.generation === accountGeneration()'))
  assert.ok(intake.includes('apply(state)') && intake.includes('discard()'))
  assert.ok(form.includes('!documentImport.reviewing'))
})
