import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fsReadPhase, selectedFsSource } from './fsReadState.ts'

test('only successful catalogs can be ready or empty, even with retained stale rows', () => {
  for (const hasItems of [false, true]) {
    assert.equal(fsReadPhase('idle', hasItems), 'loading')
    assert.equal(fsReadPhase('loading', hasItems), 'loading')
    assert.equal(fsReadPhase('error', hasItems), 'error')
  }
  assert.equal(fsReadPhase('success', false), 'empty')
  assert.equal(fsReadPhase('success', true), 'ready')
})

test('local access is explicit and missing or failed discovery cannot substitute a different source', () => {
  const local = { id: 'ui-host', kind: 'ui-host' as const, label: 'This computer' }
  const cloud = { id: 'cloud', kind: 'cloud' as const, label: 'Cloud storage' }
  for (const status of ['idle', 'loading', 'error', 'success'] as const) {
    for (const data of [undefined, [], [cloud]]) {
      const query = { status, data, error: undefined }
      assert.equal(selectedFsSource(query, 'ui-host', local), local)
      assert.equal(selectedFsSource(query, 'runner:gone', local), undefined)
      assert.equal(selectedFsSource(query, 'cloud', local), status === 'success' && data?.length ? cloud : undefined)
    }
  }
})
