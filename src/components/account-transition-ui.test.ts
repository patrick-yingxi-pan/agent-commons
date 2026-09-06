import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from '../../tests/helpers/source.ts'

const source = (path: string): string => read(join(ROOT, path))

test('browser account transitions own one visible fail-closed recovery hold', () => {
  const commands = source('src/api/accountTransitionCommands.ts')
  const facade = source('src/controller/accountTransitionMutations.ts')
  const runtime = source('src/controller/accountTransitionMutationRuntime.ts')
  const hooks = source('src/api/hooks.ts')

  assert.match(commands, /fetch\(`\$\{API_BASE\}\$\{paths\.me\}`\)/)
  assert.match(commands, /fetch\(`\$\{API_BASE\}\$\{paths\.authAccounts\}`\)/)
  assert.match(commands, /X-Account-Transition-Source/)
  assert.doesNotMatch(commands, /Idempotency-Key/)
  assert.match(facade, /let held: HeldAccountTransition \| null = null/)
  assert.doesNotMatch(facade, /onAccountSwitch/)
  assert.match(facade, /held = entry[\s\S]*start\(entry\)/,
    'the exact hold exists before deferred code can fail')
  assert.match(facade, /import\('\.\/accountTransitionMutationRuntime\.ts'\)[\s\S]*\.catch/,
    'runtime delivery failure remains a visible retryable hold')
  assert.match(facade, /runtimeLoadFailed && held[\s\S]*start\(held\)/)
  assert.match(facade, /entry\.settle\(outcome\)[\s\S]*statusStore\.publish\(IDLE_REVISIONED_MUTATION\)/,
    'pre-transport Dismiss clears both the exact hold and its loader failure')
  assert.match(runtime, /import\('\.\.\/api\/accountTransitionCommands\.ts'\)/,
    'caught transport delivery remains outside the boot graph')
  assert.match(runtime, /discardReconcileFailure: 'retain'/)
  assert.match(runtime, /refreshAccount/)
  assert.doesNotMatch(hooks, /function (switchToAccount|signOut|forgetAccount|guardedSwitch|performSwitch)/)
})

test('account uncertainty stays named and operable in both mutually exclusive worlds', () => {
  const menu = source('src/components/AccountMenu.tsx')
  const auth = source('src/components/auth/AuthScreen.tsx')
  const shell = source('src/components/ShellMutationNotices.tsx')
  const notice = source('src/components/AccountTransitionMutationNotice.tsx')

  for (const source of [menu, auth]) {
    assert.match(source, /enqueueAccountTransition/)
    assert.match(source, /Waiting for Retry/)
  }
  assert.match(menu, /fieldset disabled=\{held !== null\}/)
  assert.match(auth, /<AccountTransitionMutationNotice \/>/)
  assert.match(shell, /<AccountTransitionMutationNotice \/>/)
  assert.match(notice, /kind="account-transition"/)
})
