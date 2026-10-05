import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { FS_SOURCE_GROUP_CLASS, FS_SOURCE_OPTION_CLASS } from './fsSourceLayout.ts'

test('filesystem source switcher layout is shared, wrapping, and reachable', () => {
  const component = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
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
  const component = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const panel = component.slice(component.indexOf('function FsSourcePanel(')).split('\nfunction ')[0]
  assert.match(panel, /data-fs-picker-body className=\{FS_PICKER_BODY_CLASS\}/)
  assert.doesNotMatch(panel, /MultiAddFooter/)
  for (const picker of ['FilePicker', 'FolderPicker']) {
    const body = component.slice(component.indexOf(`function ${picker}(`)).split('\nfunction ')[0]
    assert.match(body, /<\/FsSourcePanel>\s*<MultiAddFooter/)
  }
  const layout = read(join(ROOT, 'src/lib/fsSourceLayout.ts'))
  assert.match(layout, /--popover-available-height/)
  assert.match(layout, /overflow-y-auto/)
  const native = stripComments(read(join(ROOT, 'src/components/LocalFolderConnections.tsx')))
  assert.doesNotMatch(native, /max-h-\[|overflow-y-auto/, 'native folder rows share the outer intake scroll owner')
  const photos = component.slice(component.indexOf('function ServedPhotos(')).split('\nfunction ')[0]
  assert.doesNotMatch(photos, /overflow-y-auto/, 'photo catalogs share the outer intake scroll owner')
})
