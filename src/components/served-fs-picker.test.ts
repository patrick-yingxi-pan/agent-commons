import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('all served pickers distinguish source/catalog failure from an empty answer', () => {
  const source = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const intake = stripComments(read(join(ROOT, 'src/components/ServedFileIntake.tsx')))
  for (const [name, module, catalog] of [
    ['ServedFileIntake', intake, 'catalog'],
    ['ServedFolders', source, 'cat'],
  ]) {
    const start = module.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} remains an enumerated served picker`)
    const body = module.slice(start).split('\nfunction ')[0]
    assert.ok(body.includes(`fsReadPhase(${catalog}.status,`), `${name} uses the shared read-state policy`)
    assert.match(body, /<FsReadNotice/, `${name} exposes the shared recovery face`)
    assert.match(body, /retryFsCatalog\(source\.id\)/, `${name} retries its exact source`)
  }
  assert.equal((source.match(/<FsSourcePanel selection=\{selection\}>/g) ?? []).length, 2, 'shared file/photo and folder pickers use the source recovery face')
  for (const kind of ['files', 'photos']) assert.ok(source.includes(`<FilePicker kind="${kind}"`), `${kind} uses shared intake`)
  assert.ok(intake.includes("(kind === 'photos' ? photos : files).length > 0"), 'each catalog contributes its own empty/ready truth')
  assert.doesNotMatch(source + intake, /CatalogEmpty|catch\(\(\) => undefined\)/)
})

test('served folder intake is cancellable, single-flight, and fenced before mutation', () => {
  const source = stripComments(read(join(ROOT, 'src/components/ContextPickerWorkflow.tsx')))
  const body = source.slice(source.indexOf('function ServedFolderPicker(')).split('\nfunction ')[0]
  assert.match(source, /<ServedFolderPicker key=\{active\.id\}/)
  assert.match(body, /if \(intake\.current\) return/)
  assert.match(body, /intake\.current\?\.abort\(\)/)
  assert.match(body, /onAccountSwitch/)
  assert.match(body, /readFsFolderSnapshot\(source\.id, entry\.path, controller\.signal, captureScope\)/)
  assert.match(body, /<CheckboxRow checked=\{scope === 'recursive'\}/)
  assert.match(body, /Include subfolders/)
  assert.doesNotMatch(body, /<input type="checkbox"/)
  assert.match(body, /if \(read\?\.status === 'error'\) setRead\(null\)/)
  assert.match(body, /<fieldset disabled=\{read\?\.status === 'loading'\}/, 'scope choice freezes during capture')
  assert.match(body, /take\(read\.entry, read\.scope\)/, 'Retry retains the requested scope')
  assert.match(body, /setScope\('flat'\)/, 'account switch resets the scope choice')
  assert.match(body, /if \(controller\.signal\.aborted \|\| issuedAccount !== accountGeneration\(\)\) return/)
  assert.match(body, /<fieldset disabled=\{read\?\.status === 'loading'\}/)
  assert.match(body, /data-fs-folder-read=\{read\.status\}/)
  assert.match(body, /Nothing was attached/)
})
