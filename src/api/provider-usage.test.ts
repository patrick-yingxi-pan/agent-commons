import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { keys, paths } from './keys.ts'

test('provider usage keys preserve connection/model identity and paths encode each field', () => {
  const inputs: Array<[string, string?]> = [['one'], ['one', ''], ['one', 'null'], ['one', 'two'], ['one:two'], ['one', 'two:three'], ['one:two', 'three']]
  assert.equal(new Set(inputs.map(([provider, model]) => keys.providerUsage(provider, model))).size, inputs.length)
  const provider = 'provider/one?two', model = 'model/one?two#three'
  const url = new URL(paths.providerUsage(provider, model), 'http://fixture')
  assert.equal(url.pathname, '/providers/provider%2Fone%3Ftwo/usage')
  assert.deepEqual([...url.searchParams], [['model', model]])
  assert.equal(paths.providerUsageBalance(provider, model), paths.providerUsage(provider, model).replace('/usage?', '/usage/balance?'))
  assert.equal(paths.providerUsage('one'), '/providers/one/usage')
})

test('every model-work settlement refreshes observations and connection changes evict them', () => {
  const events = stripComments(read(join(ROOT, 'src/api/events.ts')))
  const block = (name: string) => {
    const start = events.indexOf(`case '${name}':`)
    assert.ok(start >= 0, `the event router handles ${name}`)
    const end = events.indexOf('break', start)
    assert.ok(end > start, `${name} has a complete event branch`)
    return events.slice(start, end)
  }
  for (const name of ['session.updated', 'run.started', 'run.progress', 'run.finished', 'agent-request.changed', 'contribution.changed', 'commission.changed']) {
    assert.match(block(name), /invalidatePrefix\('provider-usage'\)/, name)
  }
  assert.match(block('provider.changed'), /evictPrefix\('provider-usage'\)/)
})

test('balance inspection invalidates authoritative reads without publishing a late response', () => {
  const source = stripComments(read(join(ROOT, 'src/api/providerUsage.ts')))
  assert.match(source, /apiGet<ProviderUsageSnapshot>\(paths\.providerUsageBalance\(providerId, modelId\)\)/)
  assert.match(source, /invalidate\(keys\.providerUsage\(providerId, modelId\)\)/)
  assert.doesNotMatch(source, /setData|apiPost|sendMessage|setInterval/)
})
