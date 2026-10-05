import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { join } from 'node:path'

test('served image intake is lazy, cancellable and shares its capture lifetime between retries', () => {
  const source = stripComments(read(join(ROOT, 'src/components/AddContextButton.tsx')))
  const capture = stripComments(read(join(ROOT, 'src/components/ServedFileIntake.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src/components/DeferredServedFileIntake.tsx')))
  const loaded = capture.indexOf("await import('../controller/servedImageCapture.ts')")
  const create = capture.indexOf('capture: createServedImageCapture(')
  assert.ok(loaded >= 0 && create > loaded)
  assert.ok(capture.slice(loaded, create).includes('issuedAccount !== accountGeneration()'))
  assert.ok(capture.includes('imageIntake.current.capture(controller.signal)'))
  assert.ok(capture.includes('imageIntake.current?.path !== entry.id'))
  assert.match(capture, /imageSnapshot\s*\}\]/)
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ServedFileIntake\.tsx'\)/)
  assert.match(deferred, /data-served-file-intake=\{failed \? 'error' : 'loading'\}/)
  assert.match(deferred, /Close picker[\s\S]*Reload app/)
  assert.match(source, /DeferredServedFileIntake[\s\S]*maxRows=\{maxRows\} addedIds=\{addedIds\} onPreviewOnly=\{attachServed\}/)
  assert.match(capture, /<fieldset disabled=\{disabled\}>/)
  const photo = capture.split('return <PhotoThumb ')[1]?.split('className=')[0] ?? ''
  assert.ok(photo.includes('disabled={disabled}'))
  assert.ok(photo.includes('onClick={added ? undefined : () => onCapture(photo)}'), 'held tiles remain buttons, with native disabled semantics')
  const refresh = stripComments(read(join(ROOT, 'src/controller/servedAttachmentRefresh.ts')))
  assert.ok(refresh.includes('imageCapture ??= createServedImageCapture(source, path, requestId)'))
  assert.match(refresh, /assertCurrent\(\)\s*imageCapture \?\?=/)
})

test('Files and Photos preview saved assets only and share held owner refresh controls', () => {
  const panel = stripComments(read(join(ROOT, 'src/components/AttachmentPanel.tsx')))
  assert.ok(panel.includes('const image = attachmentImageRef(att)'))
  assert.doesNotMatch(panel, /fsContentUrl|previewUrl|fetch\(/)
  assert.equal((panel.match(/<ServedSnapshotControls /g) ?? []).length, 2)
  assert.equal((panel.match(/refreshSessionId \? \(attachment\)/g) ?? []).length, 2)
  assert.equal((panel.match(/tabIndex=\{0\} role="region"/g) ?? []).length, 2, 'both bodies remain keyboard-scrollable during a held refresh')
  const photos = stripComments(read(join(ROOT, 'src/components/PhotoThumb.tsx')))
  assert.match(photos, /<button[^>]*disabled=\{disabled\}/)
  assert.ok(photos.includes("fit === 'contain' ? 'shrink-0' : ''"), 'full previews keep their aspect box and scroll rather than shrinking into a strip')
})
