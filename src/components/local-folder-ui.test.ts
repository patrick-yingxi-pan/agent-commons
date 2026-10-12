import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('recursive local folder capture is an explicit desktop-only attach scope with bounded disclosure', () => {
  const source = stripComments(read(join(ROOT, 'src/components/LocalFolderConnections.tsx')))
  assert.match(source, /const \[includeSubfolders, setIncludeSubfolders\] = useState\(false\)/)
  assert.match(source, /localFolderTreeAvailable\(\) && <>[\s\S]*?<CheckboxRow/)
  assert.match(source, /Include subfolders/)
  assert.match(source, /up to 16 levels, 64 folders and 500 entries/)
  assert.match(source, /Hidden paths and symlinks are excluded/)
  assert.match(source, /24 readable text files, 64 KB each and 128 KB total/)
  assert.match(source, /includeSubfolders \? 'recursive' : 'flat'/)
  assert.match(source, /opening, previewing and sending never reread files/)
})

test('saved recursive folders disclose scope and preserve full relative names in the saved-copy preview', () => {
  const source = stripComments(read(join(ROOT, 'src/components/panels/ArtifactPanel.tsx')))
  assert.match(source, /import \{ isRecursiveFolder \} from '..\/..\/lib\/folderPresentation.ts'/)
  assert.match(source, /Saved \{recursive \? 'including subfolders \(root-relative paths shown\)'/)
  assert.match(source, /recursive \? 'break-all whitespace-normal' : 'truncate'/)
  assert.match(source, /full root-relative path/)
  assert.match(source, /No visible \{recursive \? 'files in this saved folder tree'/)
})
