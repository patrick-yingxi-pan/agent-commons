import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('served text files attach only an explicit, exact source snapshot', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  assert.match(source, /readFsSnapshot\(source\.id, entry\.id, controller\.signal\)/)
  assert.match(source, /isLocalTextFileName\(entry\.name\)/)
  assert.match(source, /<ServedFilePicker key=\{active\.id\}/)
  const body = source.slice(source.indexOf('function ServedFilePicker(')).split('\nfunction ')[0]
  assert.match(body, /if \(intake\.current\) return/)
  assert.match(body, /intake\.current\?\.abort\(\)/)
  assert.match(body, /onAccountSwitch/)
  assert.match(body, /if \(controller\.signal\.aborted \|\| issuedAccount !== accountGeneration\(\)\) return/)
  assert.match(body, /snapshot\.sourceId !== source\.id \|\| snapshot\.path !== entry\.id/)
  assert.match(body, /textSnapshot: snapshot/)
  assert.doesNotMatch(body, /previewText/)
  const take = body.slice(body.indexOf('const take = async'), body.indexOf('return <>'))
  assert.ok(take.indexOf('await readFsSnapshot') < take.indexOf('textSnapshot: snapshot'), 'attachment publication follows the successful read')
  assert.ok(take.indexOf('snapshot.path !== entry.id') < take.indexOf('textSnapshot: snapshot'), 'the response identity is checked before publication')
  assert.match(body, /data-fs-file-read=\{read\.status\}/)
  assert.match(body, /disabled=\{read\?\.status === 'loading'\}/)
  assert.match(body, /Nothing was attached/)
  assert.match(body, />Retry<\/button>/)
})

test('portal overflow retains real button semantics and explicit intake disablement', () => {
  const picker = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const files = picker.slice(picker.indexOf('function ServedFiles(')).split('\nfunction ')[0]
  assert.match(files, /<OptionRow[\s\S]*disabled=\{disabled\}/)
  const row = picker.slice(picker.indexOf('function OptionRow('))
  assert.match(row, /disabled=\{disabled\}/)
  assert.match(row, /onClick=\{added \|\| disabled \? undefined : onClick\}/)
  const overflow = stripComments(read(join(ROOT, 'src/components/RecentOverflowList.tsx')))
  assert.match(overflow, /aria-haspopup="dialog"/)
  assert.match(overflow, /<FlyoutPanel[^>]*role="dialog" label=\{moreLabel\}/)
  assert.match(overflow, /role=\{role\}[\s\S]*aria-label=\{label\}/)
})

test('unsupported served formats remain metadata-only attachments', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const body = source.slice(source.indexOf('function ServedFilePicker(')).split('\nfunction ')[0]
  assert.match(body, /isLocalTextFileName\(entry\.name\) \? void take\(entry\) : onPreviewOnly\(entry\)/)
  assert.match(source, /const attachServed = \(e: FsFileEntry \| FsPhotoEntry\) =>\s+active && onAdd\(\{ kind, attachments: \[\{ id: fsRecentKey\(active\.id, e\.id\), label: e\.name, kind: kind === 'photos' \? 'photo' : 'file', source: active \}\] \}\)/)
  assert.doesNotMatch(body, /previewText/)
})
test('saved served previews never reread their source and every panel offers owner-only Refresh', () => {
  const panel = stripComments(read(join(ROOT, 'src/components/AttachmentPanel.tsx')))
  assert.doesNotMatch(panel, /useFsText|readFsText|readFsSnapshot/)
  assert.match(panel, /item\.textSnapshot/)
  assert.match(panel, /data-served-snapshot/)
  assert.match(panel, /Refresh saved copy/)
  assert.match(panel, /Save snapshot/)
  for (const file of ['ContextPanelView.tsx', 'OverlayPanelDock.tsx']) {
    const host = stripComments(read(join(ROOT, 'src/components', file)))
    assert.match(host, /refreshSessionId=\{writable \? sessionId : undefined\}/)
    assert.match(host, /<DeferredAttachmentPanel/)
    assert.match(host, /refreshDisabled=\{isContextMutationHeld\(contextMutation\)\}/)
  }
  assert.match(panel, /refreshServedAttachment\(refreshSessionId, attachment\)/)
})

test('preview and Refresh runtime admit together behind a recoverable panel shell', () => {
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredAttachmentPanel.tsx')))
  assert.match(deferred, /import type \{ AttachmentPanel \}/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/AttachmentPanel\.tsx'\)/)
  assert.match(deferred, /<PanelShell/)
  assert.match(deferred, /data-attachment-panel-load/)
  assert.match(deferred, /tone=\{failed \? 'alert' : 'status'\}/)
  assert.match(deferred, /Copy any unsent text before reloading/)
  assert.match(deferred, /onClose=\{this\.props\.onClose\}/)
  assert.match(deferred, /onClick: \(\) => window\.location\.reload\(\)/)
})
