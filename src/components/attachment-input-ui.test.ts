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

test('docked panel content can shrink below a long file list', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'PanelShell.tsx')))
  assert.match(src, /className="flex min-h-0 flex-1 flex-col" style=\{\{ width \}\}/)
  const artifacts = stripComments(read(join(ROOT, 'src', 'components', 'panels', 'ArtifactPanel.tsx')))
  assert.match(artifacts, /short:max-h-\[28%\]/, 'short windows reserve room for the first content line and omission notice')
})

test('local picker copy distinguishes text input from preview-only formats and folders', () => {
  const src = stripComments(read(join(ROOT, 'src', 'components', 'AddContextButton.tsx')))
  assert.match(src, /Local text input; other formats are preview-only/)
  assert.match(src, /Import top-level text snapshots for the selected model/)
  assert.match(src, /Hidden files and subfolders are excluded/)
})
