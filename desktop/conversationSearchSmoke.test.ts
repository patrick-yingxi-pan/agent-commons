import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { readSqliteConversationSearch } from './conversationSearchSmoke.mjs'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('packaged conversation-search acceptance helper stays out of the shipped application', () => {
  assert.equal(ignoreFromPackage('/desktop/conversationSearchSmoke.mjs'), true)
})

test('ordinary packaged Discussion workflow prepares once and verifies exact search state across relaunch', () => {
  const discussion = source('./discussionContextSmoke.mjs')
  const prepare = [...discussion.matchAll(/await prepareConversationSearchSmoke\(/g)]
  assert.equal(prepare.length, 1, 'one canonical search corpus is created in the ordinary Discussion run')
  assert.match(discussion, /await verifyConversationSearchSmoke\([\s\S]*?phase: 'before-relaunch'/)
  assert.match(discussion, /await verifyConversationSearchSmoke\([\s\S]*?phase: 'after-relaunch'/)
  assert.match(discussion, /const conversationSearchBeforeQuit = readSqliteConversationSearch\(profile, conversationSearchFixture\)/)
  assert.match(discussion, /assert\.deepEqual\(readSqliteConversationSearch\(profile, conversationSearchFixture\), conversationSearchBeforeQuit,[\s\S]*?before relaunch/)
  assert.match(discussion, /assert\.deepEqual\(readSqliteConversationSearch\(profile, conversationSearchFixture\), conversationSearchBeforeQuit,[\s\S]*?ordinary signed-in relaunch/)
})

test('conversation-search helper proves real durable corpus, access boundaries, navigation, and no side effects', () => {
  const helper = source('./conversationSearchSmoke.mjs')
  assert.match(helper, /export async function prepareConversationSearchSmoke/)
  assert.match(helper, /export async function verifyConversationSearchSmoke/)
  assert.match(helper, /export function readSqliteConversationSearch/)
  assert.match(helper, /new DatabaseSync\(join\(profile, 'store\.db'\), \{ readOnly: true \}\)/)
  assert.match(helper, /SELECT json FROM entities WHERE slice = \? AND entity_id = \?'/)
  assert.match(helper, /\.get\('sessions', fixture\.sessionId\)/)
  assert.match(helper, /assert\.equal\(session\.messages\.length, 44/)
  assert.match(helper, /assert\.deepEqual\(saved\.messages\.map\(\(\{ role, content \}\)/)
  assert.match(helper, /tail\.messages\.length, 40/)
  assert.match(helper, /tail\.messagePage\.olderCursor/)
  assert.match(helper, /tail\.messages\.some\(message => message\.id === target\.messageId\), false/)
  assert.match(helper, /matches\.total, 2/)
  assert.match(helper, /\{ messageId, role \}\)/)
  assert.match(helper, /for \(const viewer of \[[\s\S]*kind: 'owner'[\s\S]*kind: 'shared'[\s\S]*kind: 'foreign'/)
  assert.match(helper, /if \(viewer\.kind === 'foreign'\)[\s\S]*await expect\(hit\)\.toHaveCount\(0\)/)
  assert.match(helper, /if \(viewer\.kind === 'foreign'\)[\s\S]*assert\.equal\(result\.groups\[0\]\.total, 0\)/)
  assert.match(helper, /assert\.deepEqual\(result\.groups\[0\]\.hits, \[\]\)/, 'the native API wall is verified independently of UI filtering')
  assert.match(helper, /assert\.deepEqual\(result\.groups\[0\]\.hits\[0\]\.match, fixture\.target\)/)
  assert.match(helper, /const canonicalUrl = `\$\{origin\}\/s\/\$\{encodeURIComponent\(fixture\.sessionId\)\}`/)
  assert.match(helper, /await expect\(turn\)\.toContainText\(fixture\.messages\[0\]\.content, \{ useInnerText: true \}\)/)
  assert.match(helper, /await expect\(turn\)\.toHaveCSS\('opacity', '1'\)[\s\S]*await page\.screenshot\(/,
    'landing evidence waits for the real message fade-in before capture')
  assert.match(helper, /await expect\(page\.locator\('\[data-turn\]\[class\*="ring-co\/40"\]'\)\)\.toHaveCount\(0\)/)
  assert.match(helper, /assert\.deepEqual\(mutations, \[\]/)
  assert.match(helper, /assert\.equal\(model\.requests\.length, modelRequestCount/)
  assert.match(helper, /historyReads\.length > previousHistoryReads/)
  assert.match(helper, /await page\.reload\(\)/)
  assert.match(helper, /await page\.goBack\(\)/)
  assert.doesNotMatch(helper, /_electron|use-mock-keychain|saveState\(|store\.\w+\(/)
})

test('SQLite acceptance compares exact session, ordered message IDs and bodies from the real entities projection', () => {
  const profile = mkdtempSync(join(tmpdir(), 'conversation-search-sqlite-test-'))
  const database = new DatabaseSync(join(profile, 'store.db'))
  const fixture = {
    sessionId: 'session-exact',
    title: 'An exact title',
    preview: 'An exact preview',
    messages: Array.from({ length: 44 }, (_, index) => ({
      id: `message-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 0 ? 'café · 東京' : `Exact message ${index + 1}.`,
    })),
  }
  try {
    database.exec('CREATE TABLE entities (slice TEXT NOT NULL, entity_id TEXT NOT NULL, json TEXT NOT NULL)')
    const insert = database.prepare('INSERT INTO entities (slice, entity_id, json) VALUES (?, ?, ?)')
    const session = { id: fixture.sessionId, title: fixture.title, preview: fixture.preview, messages: fixture.messages }
    insert.run('sessions', fixture.sessionId, JSON.stringify(session))
    const snapshot = readSqliteConversationSearch(profile, fixture)
    assert.deepEqual(snapshot, session)
    assert.throws(() => readSqliteConversationSearch(profile, { ...fixture, sessionId: 'missing' }), /SQLite retains/)
    assert.throws(() => readSqliteConversationSearch(profile, {
      ...fixture, messages: [{ ...fixture.messages[0], id: 'wrong-id' }, ...fixture.messages.slice(1)],
    }), /every exact message identity and body/)
    assert.throws(() => readSqliteConversationSearch(profile, {
      ...fixture, messages: [{ ...fixture.messages[0], content: 'wrong body' }, ...fixture.messages.slice(1)],
    }), /every exact message identity and body/)
  } finally {
    database.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
