import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WRAPPING_PROSE_CLASS } from './prose.ts'

test('review prose wraps unbroken user text inside its own content box', () => {
  assert.match(WRAPPING_PROSE_CLASS, /overflow-wrap:anywhere/)
  for (const path of ['../components/ConfirmDialog.tsx', '../components/artifactPreview.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /data-wrapping-prose/)
    assert.match(source, /\$\{WRAPPING_PROSE_CLASS\}/)
  }
})
