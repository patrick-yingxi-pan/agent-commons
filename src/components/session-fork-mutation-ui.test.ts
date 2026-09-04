import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Continue from here is one held, recoverable, exact-identity Session creation', () => {
  const message = stripComments(read(join(ROOT, 'src', 'components', 'Message.tsx')))
  const conversation = stripComments(read(join(ROOT, 'src', 'components', 'ConversationView.tsx')))
  const gutter = stripComments(read(join(ROOT, 'src', 'components', 'LocusGutter.tsx')))
  const action = stripComments(read(join(ROOT, 'src', 'components', 'SessionForkAction.tsx')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'sessionForkCommands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'sessionForkMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'sessionForkMutationRuntime.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SessionForkMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.doesNotMatch(message, /\bforkSession\(/,
    'a turn cannot bypass the acknowledgement-owned controller')
  assert.match(message, /import\('\.\/SessionForkAction\.tsx'\)/,
    'the uncommon branch workflow stays outside the initial conversation bundle')
  assert.match(action, /import\('\.\.\/controller\/sessionForkMutations\.ts'\)/)
  assert.match(action, /enqueueSessionFork\(\{[\s\S]*tenantId,[\s\S]*sourceSessionId: sessionId,[\s\S]*atMessageId: messageId/)
  assert.match(action, /disabled=\{held\}/)
  assert.match(action, /Continuing…/)
  assert.match(action, /activation\.current[\s\S]*activation\.current = true[\s\S]*finally \{[\s\S]*activation\.current = false/,
    'two activations before the held-state render cannot attach duplicate navigation continuations')
  assert.match(action, /result\.outcome === 'applied' && mounted\.current/,
    'late acknowledgement cannot steal a pane after its source changed')
  assert.doesNotMatch(message, /useSessionForkStatus|isSessionForkHeld/,
    'turn rows retain their own visible hold instead of subscribing every row to global queue state')
  assert.match(conversation, /key=\{`\$\{sessionId\}:\$\{m\.id\}`\}/,
    'copied message ids remount under the branch Session rather than leaking row state')

  assert.match(gutter, /\{action\}/)
  assert.match(action, /aria-busy=\{held \|\| undefined\}/)
  assert.match(action, /error && <span role="alert"/)
  assert.match(commands, /apiPost<Session>\([\s\S]*paths\.sessionFork\(intent\.sourceSessionId\)[\s\S]*atMessageId: intent\.atMessageId[\s\S]*\{ idempotencyKey \}/,
    'the exact source and turn travel under the controller-owned stable key')
  assert.match(commands, /sessionForkCreationId\(intent\.tenantId, idempotencyKey\)/)
  assert.match(commands, /session\.forkedFrom\?\.sessionId === intent\.sourceSessionId/,
    'reconciliation proves both exact identity and branch provenance')

  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /const existing = heldPositions\.get\(key\)[\s\S]*if \(existing\) return existing/,
    'same-position repeat activation shares the held result')
  assert.match(facade, /accountGeneration/)
  assert.match(facade, /import\('\.\/sessionForkMutationRuntime\.ts'\)/,
    'low-frequency transport stays outside the cold conversation bundle')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(store, /const taken = structuredClone\(msgs\.slice\(0, cut \+ 1\)\)[\s\S]*return commitMutationBatch\(\(\) => \{[\s\S]*messages: taken/,
    'the copied transcript and social credit share one durable commit without nested source aliases')
  assert.match(notice, /kind="session-fork"/)
  assert.match(shell, /<SessionForkMutationNotice \/>/)
})
