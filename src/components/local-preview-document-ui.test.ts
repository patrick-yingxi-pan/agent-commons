import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const source = (path: string) => stripComments(read(join(ROOT, path)))

test('Folder and Git previews expose one reviewed-text adoption action with receipt, pending and account fences', () => {
  const view = source('src/components/LocalFileBrowserView.tsx')
  const action = source('src/components/LocalPreviewArtifactAction.tsx')
  const importer = source('src/lib/artifactDocumentImport.ts')

  assert.ok(view.includes("import { LocalPreviewArtifactAction } from './LocalPreviewArtifactAction.tsx'"))
  assert.equal((view.match(/<LocalPreviewArtifactAction\b/g) ?? []).length, 1,
    'the shared browser view supplies the action for Folder, tracked Git and untracked Git')
  assert.ok(view.includes('<LocalPreviewArtifactAction preview={state.preview} receipt={receipt} disabled={!enabled || state.pending} isCurrent={isCurrent} />'),
    'the common action receives the currently displayed preview, receipt, busy state and source-current check')
  assert.ok(action.includes('localPreviewDocumentImport(preview)'),
    'adoption is gated by the shared complete-text/PDF/DOCX validator')
  assert.ok(action.includes("candidate.status !== 'ready'"), 'only a validated ready candidate is enabled')
  assert.ok(action.includes('receipt === null || !isCurrent || candidate.status !== \'ready\''),
    'the button fails closed without a current receipt or ready text')
  assert.ok(action.includes('!isCurrent?.(receipt) || candidate.status !== \'ready\'') && action.includes('setDraft({ candidate, sourceName: preview.path, generation: accountGeneration() })'),
    'click rechecks the exact receipt and freezes only the reviewed text and current account generation')
  assert.ok(action.includes('useEffect(() => onAccountSwitch(() => setDraft(null)), [])'),
    'account switch disposes the private in-memory candidate')
  assert.ok(action.includes('draft.generation === accountGeneration()'),
    'a draft cannot open under a later account generation')
  assert.ok(importer.includes('file.text.length > MAX_AUTHORED_DOCUMENT_SOURCE_CHARS') && importer.includes("file.documentImport.status !== 'ready'"),
    'the shared validator bounds text and requires ready document provenance')
})

test('adoption becomes an independent editable shared artifact draft and preserves held creation precedence', () => {
  const action = source('src/components/LocalPreviewArtifactAction.tsx')
  const form = source('src/components/NewArtifactDialog.tsx')
  const deferred = source('src/components/DeferredNewArtifactDialog.tsx')

  assert.ok(action.includes('initialDocument={draft.candidate ? { ...draft.candidate, sourceName: draft.sourceName, generation: draft.generation } : undefined}'),
    'the existing lazy New artifact form receives the normalized reviewed candidate')
  assert.ok(action.includes("rel.navigate('artifacts', id)"), 'navigation follows only the exact acknowledged created id')
  assert.ok(form.includes('held?.intent.request ?? (initialDocument && initialDocument.generation === accountGeneration()'),
    'an existing held creation request takes precedence over the local preview draft')
  assert.ok(form.includes('useState(() => held ? null : initialDocument)'),
    'an unrelated held request does not falsely disclose the local source')
  assert.ok(form.includes('initialDocument !== undefined || initialStructured !== undefined'), 'adopted local drafts isolate Escape')
  assert.ok(form.includes('generation === accountGeneration() && canCreate') && form.includes('enqueueArtifactCreation('),
    'Create rechecks account generation and enqueues through the existing creation owner')
  assert.ok(deferred.includes("import('./NewArtifactDialog.tsx')") && deferred.includes('prepareArtifactCreation()'),
    'the shared lazy admission waits for the established dialog and creation runtime')
  assert.ok(deferred.includes('<Dialog {...props} />') && deferred.includes('data-artifact-form-load='),
    'the ready, loading and failed states remain the shared dialog boundary')
  assert.ok(!action.includes('document.bytes') && !action.includes('snapshot.document'),
    'the draft carries text only, never retained source bytes')
  assert.ok(!action.includes('readPreview(') && !action.includes('readLocal') && !action.includes('localStorage'),
    'adoption does not reread, persist or create a parallel source path')
  assert.ok(!action.includes('enqueueArtifactCreation('), 'the source action itself never saves')
})

test('structured preview seeds the shared explicit review without source reads or automatic adoption', () => {
  const action = source('src/components/LocalPreviewArtifactAction.tsx')
  const form = source('src/components/NewArtifactDialog.tsx')
  const intake = source('src/lib/useArtifactFileImport.ts')
  assert.ok(action.includes('localPreviewStructuredImport(preview)'))
  assert.ok(action.includes('if (disabled || receipt === null || !isCurrent?.(receipt)) return'))
  assert.ok(action.includes('setDraft({ structured, sourceName: preview.path, generation: accountGeneration() })'))
  assert.ok(action.includes('initialStructured={draft.structured ?'))
  assert.ok(form.includes('!held && initialStructured?.generation === accountGeneration() ? initialStructured : null'))
  assert.ok(form.includes("initial?.kind ?? structuredSource?.kind ?? 'doc'"))
  assert.ok(intake.includes('seed.generation !== accountGeneration() || operation.current'))
  assert.ok(intake.includes('review([seed.file], current.abort.signal, current.mode)'))
  assert.ok(intake.includes("if (result.status !== 'ready') operation.current = null"))
  assert.ok(intake.includes('apply(state)') && intake.includes('current.generation !== accountGeneration()'))
  assert.ok(!intake.includes('readPreview(') && !intake.includes('enqueueArtifactCreation('))
})
