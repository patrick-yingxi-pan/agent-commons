import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('composer discloses the shared attachment input plan for every attached item', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'Composer.tsx')))
  assert.match(src, /planAttachmentInput\(workspaceInputAttachments\(\{ attachments, workspaces \}\)\)/)
  assert.match(src, /data-attachment-input-disclosure/)
  assert.match(src, /data-attachment-input-ready=/)
  assert.match(src, /data-attachment-input-omitted=/)
  assert.match(src, /on send or retry/)
})

test('attachment panel is read-only and states model availability', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'AttachmentPanel.tsx')))
  assert.match(src, /planAttachmentInput\(allAttachments\)/)
  assert.doesNotMatch(src, /planAttachmentInput\(\[item\]\)/)
  assert.match(src, /attachmentInputCopy\(status\)/)
  assert.doesNotMatch(src, /PHOTO_TOOLS|Crop|Rotate|Annotate/)
  assert.doesNotMatch(src, /<textarea|>Save<|Unsaved|onDraft/)
  assert.match(src, /Remove (?:photo|file)/)
  assert.equal((src.match(/showUnavailableLabel/g) ?? []).length, 2, 'both image preview bodies disclose unavailable images')
  for (const component of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const host = stripComments(read(join(ROOT, 'src', 'components', component)))
    assert.match(host, /workspaceInputAttachments\(live\)/)
    assert.match(host, /allAttachments=\{inputAttachments\}/)
    assert.match(host, /inputAttachments=\{inputAttachments\}/)
  }
})

test('full image previews distinguish stale or missing image URLs from a real photo', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'PhotoThumb.tsx')))
  assert.match(src, /!showImg && showUnavailableLabel/)
  assert.match(src, /data-photo-preview-unavailable/)
  assert.match(src, /Preview unavailable/)
})

test('full image previews contain the whole image while compact tiles may crop', () => {
  const primitive = stripComments(read(join(ROOT, 'src', 'components', 'PhotoThumb.tsx')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'AttachmentPanel.tsx')))
  assert.match(primitive, /fit === 'contain' \? 'object-contain' : 'object-cover'/)
  const previews = [...panel.matchAll(/<PhotoThumb\b[\s\S]*?\/>|<PhotoThumb\b[\s\S]*?>/g)].map((match) => match[0])
  assert.equal(previews.filter((preview) => preview.includes('showUnavailableLabel')).length, 2)
  for (const preview of previews.filter((preview) => preview.includes('showUnavailableLabel'))) assert.match(preview, /fit="contain"/)
})

test('docked panel content can shrink below a long file list', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'PanelShell.tsx')))
  assert.match(src, /className="flex min-h-0 flex-1 flex-col" style=\{\{ width: width - 1 \}\}/)
  const artifacts = stripComments(read(join(ROOT, 'src', 'components', 'panels', 'ArtifactPanel.tsx')))
  assert.match(artifacts, /short:max-h-\[28%\]/, 'short windows reserve room for the first content line and omission notice')
})

test('local picker copy distinguishes text input from preview-only formats and folders', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'AddContextButton.tsx')) + read(join(ROOT, 'src', 'components', 'ContextPickerWorkflow.tsx')))
  const intake = stripComments(read(join(ROOT, 'src', 'components', 'UiHostDropZone.tsx')))
  assert.match(src, /Text, documents, spreadsheets, slides and images/)
  assert.match(intake, /Images are saved as a resized PNG of the first frame/)
  assert.ok(intake.includes('PNG, JPEG, GIF, WebP, BMP, ICO or SVG'))
  assert.ok(intake.includes('ICO uses its largest image'))
  assert.ok(intake.includes('SVG must be self-contained and static'))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'AttachmentPanel.tsx')))
  assert.equal(panel.split('largest image for ICO').length - 1, 2, 'both preview densities disclose icon selection')
  assert.match(intake, /images, layout and OCR are not included/)
  assert.ok(intake.includes('Documents (.pdf, .docx, .xlsx, .pptx): up to 8 MB each, 24 MB combined per selection'))
  assert.ok(intake.includes('Excel: visible cell values only; formulas are not calculated.'))
  assert.ok(intake.includes('PowerPoint: slide text only; speaker notes and hidden slides are excluded.'))
  assert.match(src, /Import top-level text snapshots for the selected model/)
  assert.match(src, /Hidden files and subfolders are excluded/)
})

test('local picker chunk failure has honest explicit recovery without automatic reload', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')) + read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const intake = stripComments(read(join(ROOT, 'src/components/UiHostDropZone.tsx')))
  const notice = stripComments(read(join(ROOT, 'src/components/UiHostLoadNotice.tsx')))
  const loader = stripComments(read(join(ROOT, 'src/lib/useUiHostFs.ts')))
  assert.match(source, /import type \{ UiHostFile \} from/)
  assert.equal((source.match(/const hostFs = useUiHostFs\(active\?\.kind === 'ui-host'\)/g) ?? []).length, 2, 'shared file/photo and folder pickers use the admission hook')
  for (const kind of ['files', 'photos']) assert.ok(source.includes(`<FilePicker kind="${kind}"`), `${kind} uses shared intake`)
  assert.match(source, /import \{ UiHostLoadNotice \} from/)
  assert.match(notice, /data-local-picker-load="error"/)
  assert.match(notice, /Copy any unsent text first/)
  assert.match(notice, /onClick=\{\(\) => window\.location\.reload\(\)\}/)
  assert.doesNotMatch(loader, /location\.reload|setInterval/)
  assert.match(loader, /if \(!alive\) return/)
  assert.doesNotMatch(source, /import[^\n]*imageAttachments/)
  assert.match(loader, /import type \{ UiHostDropZone as UiHostDropZoneComponent \} from/)
  assert.match(loader, /import type \{ NativeLocalFolderPicker \} from '\.\.\/components\/LocalFolderConnections\.tsx'/)
  assert.match(loader, /Promise\.all\(\[import\('\.\/uiHostFs'\), import\('\.\.\/components\/UiHostDropZone\.tsx'\), import\('\.\.\/components\/LocalFolderConnections\.tsx'\)\]\)/,
    'local picker runtimes are admitted together without entering the eager picker graph')
  assert.match(loader, /NativeLocalFolderPicker: typeof NativeLocalFolderPicker/)
  assert.match(loader, /NativeLocalFolderPicker: localFolders\.NativeLocalFolderPicker/,
    'the third deferred module is explicitly wired into the admitted module bundle')
  assert.match(loader, /setState\(\{ status: 'ready', module: \{ \.\.\.loaded, UiHostDropZone: dropZone\.UiHostDropZone, NativeLocalFolderPicker: localFolders\.NativeLocalFolderPicker \} \}\)/)
  assert.match(source, /<hostFs\.module\.UiHostDropZone/)
  assert.match(intake, /hostFs: Pick<UiHostFsModule, 'pickUiHostFiles' \| 'readDroppedFiles'>/)
  assert.match(intake, /import \{ prepareUiHostFiles \} from/)
  assert.match(intake, /prepareUiHostFiles\(files, controller\.signal\)/)
})

test('context mutation controls share authoritative ownership across chips and both panel tiers', () => {
  const access = stripComments(read(join(ROOT, 'src/controller/useContextWritable.ts')))
  assert.match(access, /useSession\(draft \? '' : sessionId\)/)
  assert.match(access, /draft \? !busy : \(!!session && session\.own !== false\)/)
  for (const file of ['Composer.tsx', 'ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const source = stripComments(read(join(ROOT, 'src/components', file)))
    assert.match(source, /useContextWritable\(sessionId\)/, `${file} uses the shared ownership projection`)
  }
  const attachments = stripComments(read(join(ROOT, 'src/components/AttachmentPanel.tsx')))
  assert.equal((attachments.match(/\{onRemove && <button/g) ?? []).length, 2, 'photo and file removal require a writable host')
})

test('accepted local selections queue completely before a context split can remount the picker', () => {
  const source = stripComments(read(join(ROOT, 'src/components/UiHostDropZone.tsx')))
  assert.match(source, /const commits = prepared\.map\(\(file\) => onPicked\(file\)\)/)
  assert.match(source, /await Promise\.all\(commits\)/)
  assert.match(source, /onAccountSwitch\(\(\) => \{/)
})
