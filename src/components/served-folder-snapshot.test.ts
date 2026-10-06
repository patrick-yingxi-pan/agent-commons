import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('served folder intake saves the explicit folder identity and never the live artifact list', () => {
  const picker = source('./ContextPickerWorkflow.tsx').split('function ServedFolderPicker')[1].split('function FolderPicker')[0]
  assert.match(picker, /readFsFolderSnapshot\(source.id, entry.path, controller.signal\)/)
  assert.match(picker, /folder:.*snapshot/)
  assert.match(picker, /artifacts: \[\]/)
  assert.match(picker, /disabled=\{read\?\.status === 'loading'\}/)
  const rows = source('./ContextPickerWorkflow.tsx').split('function ServedFolders')[1].split('function ServedFolderPicker')[0]
  assert.match(rows, /disabled=\{disabled\}/, 'portaled rows retain busy state')
})

test('workspace previews derive saved content without live source I/O, and match the exact capture for input status', () => {
  const workspace = source('./WorkspacePanel.tsx')
  assert.match(workspace, /workspaceArtifacts\(workspace\)/)
  assert.match(workspace, /workspaceFolders\(workspace\)/)
  assert.match(source('./Composer.tsx'), /foldersOf\(workspace\)/, 'chips count explicit empty folders and legacy projections alike')
  const panel = source('./panels/ArtifactPanel.tsx')
  assert.doesNotMatch(panel, /served=\{|readFs|fsContentUrl/)
  assert.match(panel, /savedFolderSnapshot/)
  assert.match(panel, /savedFolderSnapshotId/)
  assert.match(panel, /No visible top-level files/)
  assert.match(panel, /refreshServedFolder/)
  assert.match(panel, /<SectionAction/, 'folder verbs share accessible action sizing')
  for (const file of ['./ContextPanelView.tsx', './OverlayPanelDock.tsx']) {
    const host = source(file)
    const workspaceProps = host.slice(host.indexOf('<WorkspacePanel'), host.indexOf('/>', host.indexOf('<WorkspacePanel')))
    assert.match(workspaceProps, /refreshSessionId=\{writable \? sessionId : undefined\}/)
    assert.match(workspaceProps, /refreshDisabled=\{isContextMutationHeld\(contextMutation\)\}/)
  }
})
