import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

const creationSource = () => stripComments(read(join(ROOT, 'src/components/SectionView.tsx'))) + '\n' +
  stripComments(read(join(ROOT, 'src/components/NewArtifactDialog.tsx')))

test('document intake is review-only, bounded, account-fenced and shares picker recovery', () => {
  const section = creationSource()
  const surface = stripComments(read(join(ROOT, 'src/components/ArtifactDocumentImport.tsx')))
  const hook = stripComments(read(join(ROOT, 'src/lib/useArtifactFileImport.ts')))
  const frame = stripComments(read(join(ROOT, 'src/components/ArtifactImportReview.tsx')))
  assert.ok(section.includes('!documentImport.reviewing'), 'Create cannot publish while an import is reading or awaiting review')
  assert.ok(section.includes("body.length <= MAX_AUTHORED_DOCUMENT_SOURCE_CHARS"), 'programmatic input never bypasses the source ceiling')
  assert.ok(section.includes('setName((current) => current.trim() ? current : candidate.name)'), 'an import suggestion cannot overwrite a typed name')
  assert.ok(surface.includes('readOnly value={state.text}'), 'candidate preview is separate from the editable draft')
  assert.ok(surface.includes('Replace content with imported text'), 'replacement requires a named action')
  assert.ok(surface.includes('<ArtifactImportReview '), 'document intake uses the common review frame')
  assert.ok(frame.includes('<UiHostLoadNotice '), 'all artifact imports and conversation attachments share actual chunk recovery')
  assert.ok(hook.includes('current.generation === accountGeneration()'), 'extraction results retain their source generation')
  assert.ok(hook.includes('current.generation !== accountGeneration()'), 'review adoption rechecks source generation')
  assert.ok(hook.includes('operation.current === current'), 'superseded imports cannot clear a newer review')
  assert.ok(hook.includes('onAccountSwitch(discard)'), 'account changes discard unsaved private candidate text')
  assert.ok(hook.includes('modeRef.current === current.mode'), 'format changes fence pending extraction immediately')
  assert.ok(hook.includes('modeRef.current !== current.mode'), 'adoption rechecks the active format')
})

test('presentation intake adopts structured source only through the common local review lifetime', () => {
  const section = creationSource()
  const surface = stripComments(read(join(ROOT, 'src/components/ArtifactPresentationImport.tsx')))
  const hook = stripComments(read(join(ROOT, 'src/lib/useArtifactPresentationImport.ts')))
  assert.ok(section.includes('!presentationImport.reviewing'))
  assert.ok(section.includes('presentationImport.accept((candidate) => {'))
  assert.ok(section.includes('setSlides(candidate.body)'))
  assert.ok(surface.includes('<ArtifactImportReview '))
  assert.ok(surface.includes('<StructuredArtifactView body={state.body}'))
  assert.ok(surface.includes('aria-label="Imported slides" tabIndex={0}'))
  assert.ok(surface.includes('Replace slides with imported slides'))
  assert.ok(hook.includes('useArtifactFileImport('))
})

test('New artifact authors every supported format through the shared bounded field/parser contract', () => {
  const section = creationSource()
  const fields = stripComments(read(join(ROOT, 'src', 'components', 'StructuredArtifactEditor.tsx')))

  assert.match(section, /title="New artifact"/, 'the form names the complete authored capability')
  assert.match(section, /<option value="doc">Document<\/option>/)
  assert.match(section, /<option value="sheet">Sheet<\/option>/)
  assert.match(section, /<option value="slide">Slides<\/option>/)
  assert.match(section, /maxLength=\{MAX_AUTHORED_DOCUMENT_SOURCE_CHARS\}/, 'document creation exposes its canonical source ceiling')
  assert.match(section, /authoredArtifact\(normalizedName, kind, kind === 'doc' \? body : kind === 'sheet' \? sheet : slides\)/,
    'all three formats pass the one strict authored-body canonicalizer before submission')
  assert.match(section, /<StructuredArtifactFields body=\{kind === 'sheet' \? sheet : slides\}/,
    'creation uses the same structured field component as correction')
  const creation = stripComments(read(join(ROOT, 'src/components/NewArtifactDialog.tsx')))
  assert.match(creation, /projects\.filter\(\(project\) => project\.own === true\)\.map\(/,
    'optional filing offers only projects whose server projection grants owner acts')
  assert.match(fields, /<StructuredArtifactFields body=\{draft\}/,
    'saved sheet/deck editing uses that shared controlled field component')
  for (const bound of [
    'MAX_AUTHORED_SHEET_COLUMNS', 'MAX_AUTHORED_SHEET_ROWS', 'MAX_AUTHORED_SLIDES',
    'MAX_AUTHORED_SLIDE_BULLETS', 'MAX_AUTHORED_LABEL_CHARS', 'MAX_AUTHORED_CELL_CHARS',
  ]) assert.match(fields, new RegExp(bound), `${bound} is enforced by the shared fields`)
})

test('sheet intake requires explicit valid header mapping and adoption before creating', () => {
  const section = creationSource()
  const hook = stripComments(read(join(ROOT, 'src/lib/useArtifactSheetImport.ts')))
  const surface = stripComments(read(join(ROOT, 'src/components/ArtifactSheetImport.tsx')))
  assert.ok(section.includes('!sheetImport.reviewing'), 'Create cannot bypass a pending sheet review')
  assert.ok(section.includes('sheetImport.discard()'), 'format changes explicitly discard sheet review')
  assert.ok(section.includes('sheetImport.accept((candidate) => {'))
  assert.ok(section.includes('setSheet(candidate.body)'))
  assert.ok(hook.includes("useArtifactFileImport(enabled ? 'sheet' : null, reviewArtifactSheetImport)"))
  assert.ok(hook.includes("if (mapping?.status !== 'ready') return"), 'invalid header interpretation cannot adopt or discard the review')
  assert.ok(hook.includes('intake.accept('), 'adoption reuses the account and operation fence')
  assert.ok(surface.includes('<ArtifactImportReview '))
  assert.ok(surface.includes('<CheckboxRow '))
  assert.ok(surface.includes('First row contains column names'))
  assert.ok(surface.includes('label="Worksheet"'))
  assert.ok(surface.includes('intake.selectWorksheet(Number(event.target.value))'))
  assert.ok(hook.includes('selection?.candidate === intake.state'), 'worksheet choices belong to one reviewed candidate')
  assert.ok(surface.includes('<StructuredArtifactView body={mapping.body}'))
  assert.ok(surface.includes('aria-label="Imported sheet" tabIndex={0}'))
  assert.ok(surface.includes('Replace sheet with imported sheet'))
  assert.ok(surface.includes("disabled={disabled || mapping?.status === 'error'}"))
})

test('one global held creation owns recovery and only a still-mounted dialog follows its exact id', () => {
  const section = creationSource()
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'artifactCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'artifactCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ArtifactCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.match(facade, /let held: HeldCreation \| null = null/, 'the account owns one creation hold across panes')
  assert.match(facade, /if \(held\) return held\.result/, 'duplicate activation coalesces onto that exact logical creation')
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/, 'one activation mints one stable logical key')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/, 'Retry reuses the held creation key')
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*held = null[\s\S]*clearArtifactCreations/,
    'account changes fence held creation and late completion')
  assert.match(section, /useState\(\(\) => heldArtifactCreation\(\) !== null\)/,
    'the Artifacts surface remounts the held form instead of hiding recovery in the shell')
  assert.match(section, /const pending = heldArtifactCreation\(\)[\s\S]*if \(pending\) follow\(pending\.result\)/,
    'the remounted dialog follows the existing logical result')
  assert.match(section, /if \(!mounted\.current \|\| followed\.current !== result\) return[\s\S]*createdCallback\.current\(settled\.artifactId\)/,
    'an unmounted or superseded dialog cannot navigate after a late acknowledgement')
  assert.match(section, /onCreated=\{\(id\) => \{[\s\S]*rel\.navigate\('artifacts', id\)/,
    'a mounted success navigates only to the exact acknowledged derived id')
  assert.match(section, /enqueueArtifactCreation\(\{ tenantId, sourceUserId: identity\?\.via === 'session' \? identity\.user\.id : null/,
    'activation freezes the signed-in source before a shared-cookie change in another tab')
  assert.match(notice, /kind="artifact-create"/, 'uncertainty has one shell recovery surface')
  assert.equal((shell.match(/<ArtifactCreationMutationNotice \/>/g) ?? []).length, 1)
})

test('artifact creation loads before accepting draft input and shares the bounded form shell', () => {
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredNewArtifactDialog.tsx')))
  const section = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const form = stripComments(read(join(ROOT, 'src/components/NewArtifactDialog.tsx')))
  assert.ok(section.includes('DeferredNewArtifactDialog as NewArtifactDialog'))
  assert.ok(deferred.includes("import('./NewArtifactDialog.tsx')"))
  assert.ok(deferred.includes('<FormDialog title="New artifact"'))
  assert.ok(deferred.includes('data-artifact-form-load='))
  assert.ok(deferred.includes('window.location.reload()'))
  assert.ok(form.includes("from './FormDialog.tsx'"))
  assert.doesNotMatch(form, /from ['"]\.\/SectionView/)
  assert.doesNotMatch(deferred, /<input|<textarea/)
})
