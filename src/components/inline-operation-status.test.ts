import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('every inline recovery action invokes its no-argument command without forwarding a DOM event', () => {
  const source = readFileSync(new URL('./InlineOperationStatus.tsx', import.meta.url), 'utf8')
  for (const action of ['action', 'secondaryAction']) {
    assert.ok(source.includes(`onClick={() => ${action}.onClick()}`), `${action} must respect the command signature`)
    assert.ok(!source.includes(`onClick={${action}.onClick}`), `${action} must not supply a click event as command input`)
  }
})
