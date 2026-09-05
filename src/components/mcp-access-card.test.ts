import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

test('MCP access card separates the local device owner from hosted token flows', () => {
  const card = stripComments(sectionViewComponent('McpAccessCard'))

  assert.match(card, /const localDesktop = me\.data\?\.local === true && me\.data\.via === 'default'/)
  assert.match(card, /localDesktop \? \([\s\S]*?No access token is required/)
  assert.match(card, /localJsonConfig = JSON\.stringify\(\{ mcpServers: \{ workspace: \{ type: 'http', url: mcpUrl \} \} \}/)
  assert.match(card, /localDesktop \? \([\s\S]*?text=\{localJsonConfig\}[\s\S]*?\) : visibleMinted \? \(/)
  assert.match(card, /disabled=\{!signedIn \|\| !!mintHeld \|\| !mintRecoveryChecked\}/, 'the hosted mint form keeps its verified-session and restart-recovery wall')
})

test('a one-time token reveal and frozen label survive navigation but stay identity-fenced', () => {
  const card = stripComments(sectionViewComponent('McpAccessCard'))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'apiTokenMintMutations.ts')))

  assert.match(card, /const identityKey = me\.data[\s\S]*?me\.data\.user\.id[\s\S]*?me\.data\.tenant\.id/)
  assert.match(card, /const mintHeld = heldApiTokenMint\(identityKey\)/)
  assert.match(card, /const visibleMinted = apiTokenMintReveal\(identityKey\)\?\.session \?\? null/)
  assert.match(card, /if \(identityKey\) resumeApiTokenMint\(identityKey\)/)
  assert.match(card, /disabled=\{!signedIn \|\| !!mintHeld \|\| !mintRecoveryChecked\}/)
  assert.match(card, /value=\{mintHeld\?\.label \?\? label\}/)
  assert.match(card, /disabled=\{!signedIn \|\| !!mintHeld \|\| !mintRecoveryChecked\}/)
  assert.match(card, /enqueueApiTokenMint\(\{ identityKey, label: frozenLabel \}\)/)
  assert.doesNotMatch(card, /setMinted|mintApiToken\(/, 'component-local transport hope cannot own the secret')

  assert.match(facade, /reveal\?\.identityKey === identityKey \? reveal : null/)
  assert.match(facade, /heldMint\?\.intent\.identityKey === identityKey \? heldMint\.intent : null/)
  assert.match(facade, /onAccountSwitch\([\s\S]*?heldMint = null[\s\S]*?reveal = null/)
  assert.match(facade, /retainApiTokenMintIntent\(intent\)[\s\S]*?resumeApiTokenMintRuntime\(intent\)/)
  assert.match(facade, /releaseApiTokenMintIntent\(intent\)[\s\S]*?heldMint = null/)
})

test('hosted token minting has exact-key recovery and acknowledged cancellation', () => {
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'apiTokenMintCommands.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'apiTokenMintMutationRuntime.ts')))
  const core = stripComments(read(join(ROOT, 'src', 'controller', 'recoverableSecretMutationCore.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ApiTokenMintMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))

  assert.match(commands, /apiPost<BearerSession>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /apiGet<TokenMintRecovery>\(paths\.authToken, \{ idempotencyKey \}\)/)
  assert.match(commands, /apiDelete<\{ ok: true \}>\(paths\.authToken, undefined, \{ idempotencyKey \}\)/)
  assert.match(runtime, /createRecoverableSecretMutationController<ApiTokenMintIntent, BearerSession>/)
  assert.match(core, /recovered !== null[\s\S]*complete\(entry, 'applied', recovered\)/)
  assert.match(core, /deps\.cancel\(entry\.input, entry\.idempotencyKey\)/)
  assert.match(route, /iat: row\.createdAt/)
  assert.match(route, /accounts\.cancelApiTokenMint\(me\.user\.id, key\)/)
  assert.match(notice, /discardLabel="Cancel request"/)
  assert.match(shell, /<ApiTokenMintMutationNotice \/>/)
})
