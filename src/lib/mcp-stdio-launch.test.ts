import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMcpStdioLaunchDraft } from './mcpStdioLaunch.ts'
const draft = { executable: '/fixture/node', cwd: '/fixture/space here', argumentsJson: '["--flag","$(never executed)","","a\\nb","日本語"]', environmentJson: '{"MODE":"read-only","SENSITIVE":"fixture-secret"}' }

test('local process editor preserves literal ordered arguments and environment without a shell', () => {
  const result = parseMcpStdioLaunchDraft(draft)
  assert.deepEqual(result.launch, { executable: '/fixture/node', cwd: '/fixture/space here', args: ['--flag', '$(never executed)', '', 'a\nb', '日本語'], env: { MODE: 'read-only', SENSITIVE: 'fixture-secret' } })
  assert.ok(Object.isFrozen(result.launch))
  assert.ok(Object.isFrozen(result.launch!.args))
  assert.ok(Object.isFrozen(result.launch!.env))
})
test('local process editor refuses lossy, unbounded and ambiguous command input with non-reflecting errors', () => {
  for (const changed of [
    { executable: 'node' }, { cwd: '~' }, { executable: '/bad\0path' }, { cwd: '/bad\ud800' },
    { argumentsJson: 'npm run SERVER_SECRET' }, { argumentsJson: '[1]' }, { argumentsJson: JSON.stringify(Array(65).fill('a')) },
    { argumentsJson: JSON.stringify(['a'.repeat(8193)]) }, { argumentsJson: '["\\ud800"]' },
    { environmentJson: '{"__proto__":"SERVER_SECRET"}' }, { environmentJson: '{"A":42}' },
    { environmentJson: '{"A-B":"x"}' }, { environmentJson: '[]' }, { environmentJson: '{invalid SERVER_SECRET' },
    { argumentsJson: JSON.stringify(Array(8).fill('a'.repeat(8192))) },
  ]) {
    const result = parseMcpStdioLaunchDraft({ ...draft, ...changed })
    assert.equal(result.launch, undefined, JSON.stringify(changed).slice(0, 80))
    assert.ok(result.error)
    assert.equal(result.error.includes('SERVER_SECRET'), false)
  }
})
