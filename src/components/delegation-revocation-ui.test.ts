import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('one-tap Delegation revocation stays visible until exact durable acknowledgement', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPanel.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'delegationRevocationCommands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'delegationRevocationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'delegationRevocationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DelegationRevocationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))

  assert.doesNotMatch(legacy, /export async function deleteDelegation/,
    'the direct invalidate-only delete command is removed')
  assert.doesNotMatch(view, /deleteDelegation\(/,
    'the one-tap row cannot bypass acknowledgement-owned revocation')
  assert.match(view, /enqueueDelegationRevocation\(d\)/)
  assert.match(view, /heldDelegationRevocations\(project\.id\)/,
    'an early authoritative absence cannot make uncertain intent disappear')
  assert.match(view, /data-delegation-revocation=\{revoking \|\| undefined\}/)
  assert.match(view, /disabled=\{revoking \|\| policyHeld\}/)
  assert.match(view, /revoking \? <Spinner/)
  assert.match(view, /'Revoke — descent is always one tap'/,
    'durable recovery does not add ceremony to cheap authority descent')

  assert.match(facade, /heldSnapshots = new Map<string, Delegation>/)
  assert.match(facade, /accountGeneration/,
    'held private policy text and late acknowledgements are fenced by account')
  assert.match(facade, /import\('\.\/delegationRevocationMutationRuntime\.ts'\)/,
    'low-frequency transport stays out of the cold-start bundle')
  assert.match(runtime, /createRevisionedDeletionMutationController<Delegation, DeleteDelegationRequest>/,
    'revocation reuses the tested destructive FIFO')
  assert.match(runtime, /revision: \(delegation\) => \(\{ expectedCreatedAt: delegation\.createdAt, expectedRevision: delegation\.revision \?\? 0 \}\)/,
    'identity and the mutable policy version both pin reviewed revocation')
  assert.match(runtime, /mintIdempotencyKey: \(\) => crypto\.randomUUID\(\)/)

  assert.match(commands, /apiDelete<\{ ok: true \}>[\s\S]*expectedCreatedAt[\s\S]*idempotencyKey/)
  assert.match(commands, /mergeDelegationRevocationRoster\(rows \?\? \[\], delegationId, represented\)/,
    'acknowledgement and reconciliation evict only the addressed row')
  assert.match(commands, /incoming\.find\(\(delegation\) => delegation\.id === delegationId\)/,
    'absence is proven against the exact authoritative identity')

  assert.match(route, /r\.delete\('\/projects\/:id\/delegations\/:did', idempotent\(/)
  assert.match(route, /delegationRevocationId\(who\.tenant\.id, params\.id, params\.did, idempotencyKey\)/)
  assert.match(route, /if \(represented === true\) return sendJson\(res, \{ ok: true \}\)/,
    'durable receipt replay precedes the absent-row path')
  assert.match(store, /delegationRetirements\.push\(\{[\s\S]*revocationId: options\.revocationId[\s\S]*persist\(\)/,
    'authority removal, resurrection tombstone, receipt, event, and persistence commit together')
  assert.match(store, /delegationRetirements\.some\(\(retirement\) => retirement\.delegationId === options\.logicalId\)/,
    'a delayed keyed create cannot restore revoked authority')
  assert.match(notice, /kind="delegation-revoke"/)
  assert.match(shell, /<DelegationRevocationMutationNotice \/>/)
})
