import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'

test('Contribution stdio acceptance is excluded and composed into the complete packaged lifecycle', () => {
  assert.equal(ignoreFromPackage('/desktop/contributionStdioSmoke.mjs'), true)
  const driver = readFileSync(new URL('./mcpStdioSmoke.mjs', import.meta.url), 'utf8')
  assert.match(driver, /await prepareContributionStdioSmoke\(/)
  assert.match(driver, /await recoverContributionStdioSmoke\(/)
  assert.match(driver, /await assertRevokedContributionStdioSmoke\(/)
  const source = readFileSync(new URL('./contributionStdioSmoke.mjs', import.meta.url), 'utf8')
  assert.match(source, /Confirm and run once/)
  assert.match(source, /Land and resolve work/)
  assert.match(source, /data-contribution-stdio-disclosure/)
  assert.match(source, /status, 'pending'/)
  assert.match(source, /status, 'uncertain'/)
  assert.match(source, /ownerUserId, identity\.user\.id/)
  assert.match(source, /transport, 'stdio'/)
  assert.match(source, /key: pending\.submission\.key/)
})

test('authored packaged child accepts each named call only once and retains an interrupted request without a result', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ac-stdio-peer-lock-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const trace = join(directory, 'trace.jsonl')
  const peer = fileURLToPath(new URL('./mcpStdioSmokePeer.mjs', import.meta.url))
  const call = (query: string) => {
    const wire = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'records.search', arguments: { query } } }
    const child = spawnSync(process.execPath, [peer, trace], {
      input: `${JSON.stringify(wire)}\n`, encoding: 'utf8', timeout: 5_000, env: {},
    })
    assert.equal(child.status, 0, child.stderr)
    return child.stdout.trim() ? JSON.parse(child.stdout).result : undefined
  }
  assert.equal(call('native-oauth-approved-record').isError, false)
  assert.equal(call('contribution-smoke-success').isError, false)
  assert.equal(call('contribution-smoke-interrupt'), undefined)
  assert.equal(call('contribution-smoke-success').isError, true, 'a duplicate cannot fabricate a second success')
  assert.equal(call('unapproved-fixture-query').isError, true)
  const rows = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(rows.filter(row => row.method === 'tools/call').length, 5)
})
