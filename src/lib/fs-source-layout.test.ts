import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import {
  FS_LOCAL_CONNECTION_ACTIONS_CLASS,
  FS_LOCAL_CONNECTION_IDENTITY_CLASS,
  FS_LOCAL_CONNECTION_NAME_CLASS,
  FS_LOCAL_CONNECTION_ROW_CLASS,
  FS_LOCAL_CONNECTION_STATUS_CLASS,
  FS_SOURCE_GROUP_CLASS,
  FS_SOURCE_OPTION_CLASS,
} from './fsSourceLayout.ts'

test('filesystem source switcher layout is shared, wrapping, and reachable', () => {
  const component = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const switcherStart = component.indexOf('function SourceSwitcher(')
  assert.notEqual(switcherStart, -1, 'the shared source switcher exists')
  const switcher = component.slice(switcherStart).split('\nfunction ')[0]

  assert.match(component, /from '\.\.\/lib\/fsSourceLayout\.ts'/, 'the component imports shared source layout')
  assert.match(switcher, /data-fs-source-switcher/, 'the source group is a stable layout target')
  assert.match(switcher, /className=\{FS_SOURCE_GROUP_CLASS\}/, 'the group uses the shared layout constant')
  assert.match(switcher, /className=\{`\$\{FS_SOURCE_OPTION_CLASS\}/, 'options use the shared layout constant')
  assert.match(switcher, /<Icon[^>]*className="shrink-0"/, 'source icons keep their intrinsic width')
  assert.match(switcher, /<span className="min-w-0 truncate">\{s\.label\}<\/span>/, 'labels truncate inside a bounded option')
  assert.doesNotMatch(switcher, /overflow-x-auto/, 'the source group never steals horizontal pointer gestures')

  assert.equal(
    FS_SOURCE_GROUP_CLASS,
    'mb-2 flex flex-wrap items-center gap-0.5 rounded-lg bg-panel-2 p-0.5',
    'the shared group wraps its options instead of creating a horizontal scroller',
  )
  assert.equal(
    FS_SOURCE_OPTION_CLASS,
    'flex min-w-0 max-w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
    'the shared option may shrink within the available viewport width',
  )

  for (const kind of ['files', 'photos']) {
    assert.ok(component.includes(`<FilePicker kind="${kind}"`), `${kind} uses the shared file/photo picker`)
  }
  const sourcePanels = component.match(/<FsSourcePanel selection=\{selection\}>/g) ?? []
  assert.equal(sourcePanels.length, 2, 'file/photo and folder picker families share one source panel')
  for (const picker of ['FilePicker', 'FolderPicker']) {
    const start = component.indexOf(`function ${picker}(`)
    assert.notEqual(start, -1, `${picker} exists`)
    const body = component.slice(start).split('\nfunction ')[0]
    assert.match(body, /<FsSourcePanel selection=\{selection\}>/, `${picker} renders the shared source panel`)
  }
})

test('every filesystem intake scrolls one shared body while Done stays outside it', () => {
  const component = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const panel = component.slice(component.indexOf('function FsSourcePanel(')).split('\nfunction ')[0]
  assert.match(panel, /data-fs-picker-body className=\{FS_PICKER_BODY_CLASS\}/)
  assert.doesNotMatch(panel, /MultiAddFooter/)
  for (const picker of ['FilePicker', 'FolderPicker']) {
    const body = component.slice(component.indexOf(`function ${picker}(`)).split('\nfunction ')[0]
    assert.match(body, /<\/FsSourcePanel>\s*<MultiAddFooter/)
  }
  const layout = read(join(ROOT, 'src/lib/fsSourceLayout.ts'))
  const repo = stripComments(read(join(ROOT, 'src/components/RepoContextPicker.tsx')))
  assert.match(repo, /data-fs-picker-body className=\{FS_PICKER_BODY_CLASS\}/)
  assert.match(repo, /<\/div>\s*<MultiAddFooter/)
  assert.match(layout, /--popover-available-height/)
  assert.match(layout, /overflow-y-auto/)
  const native = stripComments(read(join(ROOT, 'src/components/LocalFolderConnections.tsx')))
  assert.doesNotMatch(native, /max-h-\[|overflow-y-auto/, 'native folder rows share the outer intake scroll owner')
  const git = stripComments(read(join(ROOT, 'src/components/LocalGitConnections.tsx')))
  assert.doesNotMatch(git, /max-h-\[|overflow-y-auto/, 'native Git rows share the outer intake scroll owner')
  const photos = component.slice(component.indexOf('function ServedPhotos(')).split('\nfunction ')[0]
  assert.doesNotMatch(photos, /overflow-y-auto/, 'photo catalogs share the outer intake scroll owner')
})

test('native connection pickers share a full-width identity then wrapping action funnel', () => {
  const layout = read(join(ROOT, 'src/lib/fsSourceLayout.ts'))
  assert.match(layout, /FS_LOCAL_CONNECTION_ROW_CLASS/)
  assert.match(layout, /FS_LOCAL_CONNECTION_IDENTITY_CLASS/)
  assert.match(layout, /FS_LOCAL_CONNECTION_ACTIONS_CLASS/)
  assert.match(layout, /FS_LOCAL_CONNECTION_NAME_CLASS/)
  assert.match(layout, /FS_LOCAL_CONNECTION_STATUS_CLASS/)
  assert.match(FS_LOCAL_CONNECTION_ROW_CLASS, /min-w-0/)
  assert.match(FS_LOCAL_CONNECTION_IDENTITY_CLASS, /w-full/)
  assert.match(FS_LOCAL_CONNECTION_ACTIONS_CLASS, /flex-wrap/)
  assert.match(FS_LOCAL_CONNECTION_NAME_CLASS, /break-words/)
  assert.match(FS_LOCAL_CONNECTION_STATUS_CLASS, /whitespace-nowrap/)

  for (const [path, marker] of [
    ['src/components/LocalFolderConnections.tsx', 'data-native-folder-picker'],
    ['src/components/LocalGitConnections.tsx', 'data-native-git-picker'],
  ]) {
    const picker = stripComments(read(join(ROOT, path)))
    assert.match(picker, /from '\.\.\/lib\/fsSourceLayout\.ts'/, `${path} imports the shared picker layout`)
    const rowStart = picker.indexOf('data-local-connection-picker-row')
    assert.notEqual(rowStart, -1, `${path} stamps each connection row`)
    const row = picker.slice(rowStart, rowStart + 1800)
    assert.ok(row.indexOf('data-local-connection-picker-identity') < row.indexOf('data-local-connection-picker-actions'),
      'identity is laid out before actions')
    assert.match(row, /data-local-connection-picker-identity/, 'the identity occupies its own full-width row')
    assert.match(row, /data-local-connection-picker-name/, 'the complete name can wrap in the identity row')
    assert.match(row, /data-local-connection-picker-status/, 'persistence status stays on one line')
    assert.match(row, /data-local-connection-picker-actions/, 'actions wrap in their own row')
    assert.match(row, /FS_LOCAL_CONNECTION_ROW_CLASS/)
    assert.match(row, /FS_LOCAL_CONNECTION_IDENTITY_CLASS/)
    assert.match(row, /FS_LOCAL_CONNECTION_ACTIONS_CLASS/)
    assert.match(picker, new RegExp(marker))
  }
})
