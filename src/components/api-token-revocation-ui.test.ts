import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('personal access-token revocation is held, recoverable, and exact', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'apiTokenRevocationCommands.ts')))
  const roster = stripComments(read(join(ROOT, 'src', 'api', 'apiTokenRevocationRoster.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'apiTokenRevocationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'apiTokenRevocationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ApiTokenRevocationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const mcpCard = view.match(/function McpAccessCard\(\) \{[\s\S]*?(?=\nfunction ContextRow\()/)?.[0]
  assert.ok(mcpCard, 'the hosted MCP credential surface exists')

  assert.doesNotMatch(legacy, /export async function revokeApiToken/,
    'the direct invalidate-and-swallow command is gone')
  assert.doesNotMatch(mcpCard, /revokeApiToken\(t\.id\)[\s\S]{0,240}\.catch\(\(\) => \{\}\)/,
    'the security action cannot silently swallow failure')
  assert.match(mcpCard, /enqueueApiTokenRevocation\(t\)/)
  assert.match(mcpCard, /heldApiTokenRevocations\(\)\.filter/,
    'an early absence cannot erase the exact uncertain credential row')
  assert.match(mcpCard, /data-api-token-revocation=\{failed \? 'failed' : revoking \? 'pending' : undefined\}/)
  assert.match(mcpCard, /disabled=\{revoking\}/)
  assert.match(mcpCard, /revocation needs attention/,
    'failure is explained at the credential row as well as in the shell')

  assert.match(facade, /heldRevocations = new Map<string, HeldRevocation>/)
  assert.match(facade, /existing\) return existing\.result/,
    'repeat activation coalesces onto the same logical act')
  assert.match(facade, /onAccountSwitch/)
  assert.match(facade, /crypto\.randomUUID\(\)/)
  assert.match(facade, /import\('\.\/apiTokenRevocationMutationRuntime\.ts'\)/,
    'low-frequency transport remains behind the action boundary')
  assert.match(runtime, /createAcknowledgedActionMutationController<ApiTokenRevocationIntent, undefined>/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)

  assert.match(commands, /apiDelete<\{ ok: true \}>[\s\S]*idempotencyKey/)
  assert.match(commands, /incoming\.find\(\(token\) => token\.id === intent\.tokenId\)/,
    'only exact authoritative absence proves success')
  assert.match(commands, /mergeApiTokenRevocationRoster\(rows \?\? \[\], tokenId, represented\)/)
  assert.match(roster, /filter\(\(token\) => token\.id !== tokenId\)/)

  assert.match(route, /if \(accounts\.revokeApiToken\(me\.user\.id, params\.id\)\) store\.accountsMutated\(\)/)
  assert.doesNotMatch(route, /No token '\$\{params\.id\}' on this account/,
    'already-absent, unknown, and foreign ids share a non-leaking success')
  assert.match(notice, /kind="api-token-revoke"/)
  assert.match(shell, /<ApiTokenRevocationMutationNotice \/>/)
})
