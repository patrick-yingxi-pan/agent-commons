import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('served folder intake saves the explicit folder identity and never the live artifact list', () => {
  const picker = source('./ContextPickerWorkflow.tsx').split('function ServedFolderPicker')[1].split('function FolderPicker')[0]
  assert.match(picker, /readFsFolderSnapshot\(source.id, entry.path, controller.signal, captureScope\)/)
  assert.match(picker, /useState<ServedFolderScope>\('flat'\)/, 'subfolder capture starts unchecked')
  assert.match(picker, /<CheckboxRow checked=\{scope === 'recursive'\}/, 'scope uses the shared checkbox control')
  assert.match(picker, /Include subfolders/)
  assert.doesNotMatch(picker, /<input type="checkbox"/)
  assert.match(picker, /if \(read\?\.status === 'error'\) setRead\(null\)/, 'changing scope clears the stale failed capture')
  assert.match(picker, /setRead\(\{ entry, status: 'error', scope: captureScope \}\)/, 'failure retains the exact capture scope')
  assert.match(picker, /take\(read\.entry, read\.scope\)/, 'retry repeats the frozen scope')
  assert.match(picker, /16 levels.*64 subfolders.*500 entries/s, 'recursive traversal limits are disclosed')
  assert.match(picker, /64 KB each and 128 KB total/)
  assert.match(picker, /Hidden files and symlinks are excluded/)
  assert.match(picker, /folder:.*snapshot/)
  assert.match(picker, /artifacts: \[\]/)
  assert.match(picker, /disabled=\{read\?\.status === 'loading'\}/)
  const rows = source('./ContextPickerWorkflow.tsx').split('function ServedFolders')[1].split('function ServedFolderPicker')[0]
  assert.match(rows, /disabled=\{disabled\}/, 'portaled rows retain busy state')
  assert.match(rows, /meta=\{servedFolderFileCount\(f.fileCount\)\}/, 'catalog counts disclose their top-level scope')
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
  assert.match(panel, /top-level files in this saved folder/)
  assert.match(panel, /recursive \? 'files in this saved folder tree'/)
  assert.match(panel, /import \{ isRecursiveFolder \} from '..\/..\/lib\/folderPresentation.ts'/, 'all saved folder scopes use the same predicate')
  assert.match(source('../lib/folderPresentation.ts'), /folder\?\.localSnapshot\?\.version === 2 \|\| folder\?\.snapshot\?\.version === 2/)
  assert.match(panel, /recursive \? 'break-all whitespace-normal'/, 'root-relative labels wrap in the shared list')
  assert.match(panel, /folderScope=\{isRecursiveFolder\(selectedFolder\)/, 'preview follows the same saved scope')
  assert.match(panel, /refreshServedFolder/)
  assert.match(panel, /<SectionAction/, 'folder verbs share accessible action sizing')
  for (const file of ['./ContextPanelView.tsx', './OverlayPanelDock.tsx']) {
    const host = source(file)
    const workspaceProps = host.slice(host.indexOf('<WorkspacePanel'), host.indexOf('/>', host.indexOf('<WorkspacePanel')))
    assert.match(workspaceProps, /refreshSessionId=\{writable \? sessionId : undefined\}/)
    assert.match(workspaceProps, /refreshDisabled=\{isContextMutationHeld\(contextMutation\)\}/)
  }
})
