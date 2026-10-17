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

test('every model-work settlement refreshes account-wide limits and observations', () => {
  const events = stripComments(read(join(ROOT, 'src/api/events.ts')))
  const block = (name: string) => {
    const start = events.indexOf(`case '${name}':`)
    assert.ok(start >= 0, `the event router handles ${name}`)
    const end = events.indexOf('break', start)
    assert.ok(end > start, `${name} has a complete event branch`)
    return events.slice(start, end)
  }
  const helperStart = events.indexOf('function invalidateModelUsage(')
  const helperEnd = events.indexOf('\n}', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'one model-work refresh funnel exists')
  const helper = events.slice(helperStart, helperEnd)
  assert.ok(helper.includes('invalidatePrefix(keys.usage(), true)'), 'refreshes mounted draft and session snapshots, not only the event session')
  assert.ok(helper.includes("invalidatePrefix('provider-usage', true)"), 'refreshes mounted provider observations through ordinary reads')
  assert.doesNotMatch(helper, /refreshProviderBalance|setData|apiPost|sendMessage|setInterval/)
  for (const name of ['session.updated', 'run.started', 'run.progress', 'run.finished', 'dispatch.changed', 'agent-request.changed', 'contribution.changed', 'commission.changed']) {
    assert.ok(block(name).includes('invalidateModelUsage()'), name)
  }
  assert.doesNotMatch(block('session.updated'), /invalidate\(keys\.usage\(e\.session\.id\)\)/, 'a session-local read cannot represent account-wide usage freshness')
  assert.match(block('provider.changed'), /evictPrefix\('provider-usage'\)/)
})

test('account usage prefix covers drafts and all session snapshots without crossing provider identity keys', () => {
  const prefix = keys.usage()
  const matches = (key: string) => key === prefix || key.startsWith(`${prefix}:`)
  for (const session of [undefined, 'conversation-a', 'conversation-b']) {
    assert.ok(matches(keys.usage(session)))
  }
  assert.equal(matches(keys.providerUsage('provider-one', 'model-one')), false)
})

test('balance inspection invalidates authoritative reads without publishing a late response', () => {
  const source = stripComments(read(join(ROOT, 'src/api/providerUsage.ts')))
  assert.match(source, /apiGet<ProviderUsageSnapshot>\(paths\.providerUsageBalance\(providerId, modelId\)\)/)
  assert.match(source, /invalidate\(keys\.providerUsage\(providerId, modelId\)\)/)
  assert.doesNotMatch(source, /setData|apiPost|sendMessage|setInterval/)
})
