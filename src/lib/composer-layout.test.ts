import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COMPOSER_MODEL_LAYOUT, composerExecutionNoteClass } from './composerLayout.ts'

test('composer model controls shrink at container width without clipping standing actions', () => {
  for (const part of Object.values(COMPOSER_MODEL_LAYOUT)) assert.ok(part.includes('min-w-0'))
  assert.ok(COMPOSER_MODEL_LAYOUT.group.includes('max-w-full'))
  assert.ok(COMPOSER_MODEL_LAYOUT.trigger.includes('max-w-full'))
  assert.doesNotMatch(Object.values(COMPOSER_MODEL_LAYOUT).join(' '), /(?:sm|md|lg):|overflow-hidden/)
  const composer = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8')
  const picker = readFileSync(new URL('../components/ModelEffortControl.tsx', import.meta.url), 'utf8')
  assert.ok(composer.includes('data-composer-model-controls className={COMPOSER_MODEL_LAYOUT.group}'))
  assert.ok(picker.includes('className={COMPOSER_MODEL_LAYOUT.picker}'))
  assert.ok(picker.includes('${COMPOSER_MODEL_LAYOUT.trigger}'))
})

test('composer recovery guidance wraps exact identifiers and remains visible in short windows', () => {
  for (const blocked of [false, true]) {
    const className = composerExecutionNoteClass(blocked)
    assert.ok(className.includes('min-w-0'))
    assert.ok(className.includes('[overflow-wrap:anywhere]'))
    assert.equal(className.includes('short:hidden'), !blocked,
      'only nonblocking boilerplate may yield space on short screens')
  }
  const composer = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8')
  assert.match(composer, /data-composer-execution-note className=\{composerExecutionNoteClass\(execution\.blocked\)\}/)
})
