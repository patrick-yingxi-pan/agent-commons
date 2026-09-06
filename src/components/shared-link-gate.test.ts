import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('share-link redemption gates workspace boot and exposes explicit recovery without projecting the token', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const gate = stripComments(read(join(ROOT, 'src', 'components', 'SharedLinkGate.tsx')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'useSharedLinkRedemption.ts')))
  const screen = stripComments(read(join(ROOT, 'src', 'components', 'AppBootstrapScreen.tsx')))

  assert.match(
    app,
    /<SharedLinkGate[\s\S]*<Workspace instanceAdmin=\{resolvedIdentity\.instanceAdmin === true\}\s*\/>[\s\S]*<\/SharedLinkGate>/,
  )
  assert.doesNotMatch(app, /SHARED_BOOT_TOKEN|sharedBootConsumed/, 'the workspace no longer races a module-scoped token')
  assert.match(gate, /phase === 'pending'[\s\S]*status="shared-loading"/)
  assert.match(gate, /phase === 'retryable'[\s\S]*onRetry=\{redemption\.retry\}[\s\S]*onExit=\{redemption\.dismiss\}/)
  assert.match(controller, /replaceState\(null, '', sharedSubjectPath\(subject\)\)[\s\S]*setPhase\('complete'\)/,
    'the secret-bearing history entry is replaced before the workspace mounts')
  assert.match(controller, /if \(failure === 'unavailable'\) window\.history\.replaceState\(null, '', '\/'\)/)
  assert.doesNotMatch(controller, /interface SharedLinkRedemption[\s\S]{[^}]*token:/,
    'the render projection cannot expose the capability token')
  assert.match(screen, /Opening shared item/)
  assert.match(screen, /Couldn’t open shared item/)
  assert.match(screen, /This share link is no longer available/)
  assert.match(screen, /Go to Agent Commons/)
})

test('share-link redemption binds a verified-session request to its initiating account', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const client = stripComments(read(join(ROOT, 'src', 'api', 'client.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const routes = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const redeemStart = routes.indexOf("r.post('/grants/redeem'")
  const redeemEnd = routes.indexOf("r.delete('/grants/:gid'", redeemStart)
  const redeemRoute = routes.slice(redeemStart, redeemEnd)

  assert.match(app, /expectedSessionUserId=\{resolvedIdentity\.via === 'session'/)
  assert.match(client, /'X-Account-Transition-Source': `session:\$\{options\.expectedSessionUserId\}`/)
  assert.match(commands, /redeemShareLink\(token: string, expectedSessionUserId\?: string\)/)
  assert.match(redeemRoute, /accountTransitionSourceMatches\(req, res\)/)
})
