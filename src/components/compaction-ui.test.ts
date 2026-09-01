import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from '../../tests/helpers/source.ts'

test('compaction remains retryable, disables composition, and discloses bounded recoverable history', () => {
  const affordance = read(join(ROOT, 'src', 'components', 'CompactionAffordance.tsx'))
  const pane = read(join(ROOT, 'src', 'components', 'ConversationPane.tsx'))
  const view = read(join(ROOT, 'src', 'components', 'ConversationView.tsx'))
  const message = read(join(ROOT, 'src', 'components', 'Message.tsx'))
  const summary = read(join(ROOT, 'src', 'components', 'ConversationSummary.tsx'))
  const archiveApi = read(join(ROOT, 'src', 'api', 'compactedMessages.ts'))
  const rich = read(join(ROOT, 'src', 'lib', 'rich.tsx'))
  const route = read(join(ROOT, 'server', 'routes', 'index.ts'))

  assert.match(affordance, /<InlineOperationStatus/, 'pending and failure use the accessible operation primitive')
  assert.match(affordance, /label: 'Retry compaction'/, 'failure retains an explicit retry')
  assert.match(affordance, /catch \(cause\)/, 'model or transport failure is surfaced')
  assert.doesNotMatch(pane, /leave the thread as-is; the user can retry/, 'the controller no longer swallows the failure')
  assert.match(view, /disabled=\{busy \|\| compacting \|\| execution\.blocked\}/, 'sending is held during the context rewrite')
  assert.match(view, /lazy\(\(\) => import\('\.\/CompactionAffordance'\)/, 'the long-thread-only affordance stays outside the first conversation graph')

  assert.match(message, /lazy\(\(\) => import\('\.\/ConversationSummary'\)\)/, 'rare archive recovery stays outside the initial conversation graph')
  assert.match(message, /<Suspense fallback=/, 'the async summary boundary has an announced loading face')
  assert.match(summary, /aria-expanded=\{expanded\}/, 'the summary is an accessible disclosure')
  assert.match(summary, /min-w-0 flex-1 sm:flex sm:items-baseline/, 'the disclosure label stacks as one readable unit below the small breakpoint')
  assert.match(summary, /<SummaryMarkdown text=\{message\.content\}/, 'the generated continuation brief enters the block renderer')
  assert.match(summary, /<h3 key=/, 'provider Markdown headings become semantic headings')
  assert.match(summary, /const List = orderedList \? 'ol' : 'ul'/, 'provider Markdown bullets become semantic lists')
  assert.match(rich, /<em key=\{key\+\+\} className="italic">/, 'summary and turn emphasis never leaks literal Markdown punctuation')
  assert.match(summary, /useCompactedMessages\(sessionId, cursor, expanded\)/, 'archive detail enters through the read hook')
  assert.match(summary, /Archived conversation messages/, 'the original turns have a named reading region')
  assert.match(summary, /renderRich\(archived\.content\)/, 'archived prose keeps the live transcript\'s safe inline semantics')
  assert.match(summary, /archive\.data\?\.nextCursor/, 'archive traversal remains bounded')
  assert.match(archiveApi, /Page<Message>/, 'the UI asks for a page, never the complete archive')
  assert.match(route, /paginate\(session\.compactedMessages \?\? \[\]/, 'the server enforces the bounded archive projection')
})
