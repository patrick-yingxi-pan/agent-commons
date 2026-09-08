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
  assert.match(src, /className="flex min-h-0 flex-1 flex-col" style=\{\{ width \}\}/)
  const artifacts = stripComments(read(join(ROOT, 'src', 'components', 'panels', 'ArtifactPanel.tsx')))
  assert.match(artifacts, /short:max-h-\[28%\]/, 'short windows reserve room for the first content line and omission notice')
})

test('local picker copy distinguishes text input from preview-only formats and folders', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'AddContextButton.tsx')))
  assert.match(src, /Text, PDF and Word text, and images for your conversation/)
  assert.match(src, /Images are saved as a resized PNG of the first frame/)
  assert.match(src, /images, layout and OCR are not included/)
  assert.ok(src.includes('PDFs and Word (.docx): up to 8 MB each, 24 MB per selection'))
  assert.match(src, /Import top-level text snapshots for the selected model/)
  assert.match(src, /Hidden files and subfolders are excluded/)
})

test('context mutation controls share authoritative ownership across chips and both panel tiers', () => {
  const access = stripComments(read(join(ROOT, 'src/controller/useContextWritable.ts')))
  assert.match(access, /useSession\(draft \? '' : sessionId\)/)
  assert.match(access, /draft \|\| \(!!session && session\.own !== false\)/)
  for (const file of ['Composer.tsx', 'ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const source = stripComments(read(join(ROOT, 'src/components', file)))
    assert.match(source, /useContextWritable\(sessionId\)/, `${file} uses the shared ownership projection`)
  }
  const attachments = stripComments(read(join(ROOT, 'src/components/AttachmentPanel.tsx')))
  assert.equal((attachments.match(/\{onRemove && <button/g) ?? []).length, 2, 'photo and file removal require a writable host')
})

test('accepted local selections queue completely before a context split can remount the picker', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  assert.match(source, /const commits = prepared\.map\(\(file\) => onPicked\(file\)\)/)
  assert.match(source, /await Promise\.all\(commits\)/)
  assert.match(source, /onAccountSwitch\(\(\) => \{/)
})
