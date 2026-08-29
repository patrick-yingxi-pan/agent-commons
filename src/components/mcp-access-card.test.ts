import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

test('MCP access card separates the local device owner from hosted token flows', () => {
  const card = stripComments(sectionViewComponent('McpAccessCard'))

  assert.match(card, /const localDesktop = me\.data\?\.local === true && me\.data\.via === 'default'/)
  assert.match(card, /localDesktop \? \([\s\S]*?No access token is required/)
  assert.match(card, /localJsonConfig = JSON\.stringify\(\{ mcpServers: \{ workspace: \{ type: 'http', url: mcpUrl \} \} \}/)
  assert.match(card, /localDesktop \? \([\s\S]*?text=\{localJsonConfig\}[\s\S]*?\) : visibleMinted \? \(/)
  assert.match(card, /disabled=\{!signedIn\}/, 'the hosted mint form keeps its verified-session wall')
})

test('a one-time token reveal is fenced to the identity that minted it', () => {
  const card = stripComments(sectionViewComponent('McpAccessCard'))

  assert.match(card, /const identityKey = me\.data[\s\S]*?me\.data\.user\.id[\s\S]*?me\.data\.tenant\.id/)
  assert.match(card, /const visibleMinted = minted\?\.identityKey === identityKey \? minted : null/)
  assert.match(card, /const requestedFor = identityKey/)
  assert.match(card, /if \(identityKeyRef\.current !== requestedFor\) return/)
  assert.match(card, /setMinted\(\{ token: session\.token, tokenId: session\.tokenId, identityKey: requestedFor \}\)/)
  assert.doesNotMatch(card, /\{minted\.token\}/, 'raw reveal state never bypasses the identity projection')
})
