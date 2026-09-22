import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('all served pickers distinguish source/catalog failure from an empty answer', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  for (const name of ['ServedFiles', 'ServedPhotos', 'ServedFolders']) {
    const body = source.slice(source.indexOf(`function ${name}(`)).split('\nfunction ')[0]
    assert.match(body, /fsReadPhase\(cat\.status,/, `${name} uses the shared read-state policy`)
    assert.match(body, /<FsReadNotice/, `${name} exposes the shared recovery face`)
    assert.match(body, /retryFsCatalog\(source\.id\)/, `${name} retries its exact source`)
  }
  assert.equal((source.match(/<FsSourcePanel selection=\{selection\}>/g) ?? []).length, 2, 'shared file/photo and folder pickers use the source recovery face')
  for (const kind of ['files', 'photos']) assert.ok(source.includes(`<FilePicker kind="${kind}"`), `${kind} uses shared intake`)
  assert.doesNotMatch(source, /CatalogEmpty|catch\(\(\) => undefined\)/)
})

test('served folder intake is cancellable, single-flight, and fenced before mutation', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const body = source.slice(source.indexOf('function ServedFolderPicker(')).split('\nfunction ')[0]
  assert.match(source, /<ServedFolderPicker key=\{active\.id\}/)
  assert.match(body, /if \(intake\.current\) return/)
  assert.match(body, /intake\.current\?\.abort\(\)/)
  assert.match(body, /onAccountSwitch/)
  assert.match(body, /readFsFolder\(source\.id, entry\.path, controller\.signal\)/)
  assert.match(body, /if \(controller\.signal\.aborted \|\| issuedAccount !== accountGeneration\(\)\) return/)
  assert.match(body, /<fieldset disabled=\{read\?\.status === 'loading'\}/)
  assert.match(body, /data-fs-folder-read=\{read\.status\}/)
  assert.match(body, /Nothing was attached/)
})
