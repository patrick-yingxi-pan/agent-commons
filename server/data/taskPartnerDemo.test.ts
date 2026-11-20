import assert from 'node:assert/strict'
import { createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { accounts } from '../accounts.ts'
import { day } from '../taskPartners/protocol.ts'
import { PartnerRegistry, type PartnerRegistrySnapshot } from '../taskPartners/registry.ts'
import { createDemoPartnerBootstrap, demoPartnerAudience, signDemoPartnerJwt } from './taskPartnerDemo.ts'

test('local example partners complete onboarding and remain distinct, durable and confined to demo admission', async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'commons-partner-demo-'))
  const keyDirectory = join(temporary, 'keys')
  const previous = process.env.MAINTAINERS
  t.after(() => {
    rmSync(temporary, { recursive: true, force: true })
    if (previous === undefined) delete process.env.MAINTAINERS
    else process.env.MAINTAINERS = previous
  })
  let on = false
  const options = { keyDirectory, enabled: () => on }
  const boot = createDemoPartnerBootstrap(options)
  let checkpoint: PartnerRegistrySnapshot | undefined
  const registry = new PartnerRegistry({ ...boot.registryOptions, changed: () => {
    if (checkpoint) return
    const snapshot = registry.snapshot()
    if (snapshot.rows.some(r => r.reports.some(report => !report.duplicateObserved &&
        report.commands.every(c => c.command.state === 'succeeded')))) checkpoint = snapshot
  } })
  const reviewer = { userId: 'user-ada', tenantId: 'tenant-acme', organizationAdmin: true, operator: true, freshAuth: true }
  const requester = { ...reviewer, operator: false }
  const maya = { ...requester, userId: 'user-maya', tenantId: 'tenant-growthworks' }
  const noor = { ...requester, userId: 'user-noor', tenantId: 'tenant-northlight' }
  process.env.MAINTAINERS = 'user-ada'
  assert.deepEqual(await boot.seed(registry, accounts), [])
  assert.equal(existsSync(keyDirectory), false)
  on = true
  process.env.MAINTAINERS = ''
  const [provider, custodian] = await boot.seed(registry, accounts)
  assert.deepEqual(registry.catalog().map(p => [p.displayName, p.identity.domainAscii, p.capabilities]), [
    ['Orchard Work', 'orchard-coop.example.com', ['custodian', 'verifier']],
    ['Orchard Works', 'orchard-labs.example.com', ['model-provider']],
  ])
  for (const [partner, owner] of [[provider, maya], [custodian, noor]] as const) {
    const [app] = registry.applications(owner, 'production')
    const [sandbox] = registry.applications(owner, 'sandbox')
    assert.ok(app.demo && sandbox.demo)
    assert.equal(app.partnerId, partner.partnerId)
    assert.equal(app.viewer?.canManage, true)
    assert.equal(app.viewer?.canReview, false)
    assert.deepEqual(registry.applications(requester, 'production'), [])
    assert.notEqual(app.keys[0].thumbprint, sandbox.keys[0].thumbprint)
    assert.equal(registry.report(owner, 'sandbox', sandbox.applicationId, sandbox.conformanceReportId!).state, 'passed')
    assert.equal(registry.history(owner, 'production', app.applicationId).at(-1)?.actorRef, 'demo-onboarding-reviewer')
    assert.equal(accounts.users.has('demo-onboarding-reviewer'), false)
    const profile = registry.publicProfile(app.partnerId)
    assert.equal(profile.demo, true)
    assert.equal(profile.status, 'active')
    assert.deepEqual(profile.identity.collisionSignals, ['similar_name'])
    assert.equal(profile.identity.relatedPartners.length, 1)
  }
  const [source] = registry.applications(maya, 'sandbox')
  const ordinaryApplication = {
    displayName: source.displayName, organization: source.organization, organizationUrl: source.organizationUrl,
    handoffUrl: source.handoffUrl, contact: source.contact, recoveryContact: source.recoveryContact,
    capabilities: source.requestedCapabilities, catalog: source.catalog, sandboxReportId: source.conformanceReportId,
    publicKey: { ...generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }), kid: 'ordinary' },
  }
  assert.throws(() => registry.apply(maya, 'production', ordinaryApplication), { status: 409 })
  assert.throws(() => registry.apply(maya, 'production', { ...ordinaryApplication, demo: true }), { status: 400 })
  assert.ok(checkpoint, 'an acknowledged model run was captured before its conformance replay')
  const interruptedBoot = createDemoPartnerBootstrap(options)
  const interrupted = new PartnerRegistry(interruptedBoot.registryOptions)
  interrupted.restore(checkpoint)
  assert.equal((await interruptedBoot.seed(interrupted, accounts)).length, 2)
  const snapshot = registry.snapshot()
  const key = provider.privateKey.export({ format: 'jwk' })
  assert.ok(!JSON.stringify(snapshot).includes(key.d!))
  const restart = createDemoPartnerBootstrap(options)
  const restored = new PartnerRegistry(restart.registryOptions)
  restored.restore(snapshot)
  assert.deepEqual((await restart.seed(restored, accounts)).map(w => w.partnerId), [provider.partnerId, custodian.partnerId])
  assert.deepEqual(restored.snapshot(), snapshot)
  assert.equal(restored.publicProfile(provider.partnerId).status, 'active')
  const now = Math.floor(Date.now() / 1000)
  const request = { client_id: provider.partnerId, grant_type: 'client_credentials', scope: 'commands:read',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: signDemoPartnerJwt(provider.privateKey, provider.kid, 'partner-client-auth+jwt', {
      iss: provider.partnerId, sub: provider.partnerId, aud: demoPartnerAudience('production') + '/oauth/token',
      iat: now, exp: now + 240, jti: 'demo-test-token',
    }) }
  const { access_token } = restored.issueToken('production', request)
  assert.equal(restored.authorizeWorker('production', access_token, 'commands:read').partnerId, provider.partnerId)
  const closed = new PartnerRegistry({ audience: demoPartnerAudience })
  closed.restore(restored.snapshot())
  assert.deepEqual(closed.catalog(), [])
  assert.deepEqual(closed.applications(reviewer, 'production'), [])
  assert.equal(closed.publicProfile(provider.partnerId).status, 'verification_lapsed')
  assert.deepEqual(closed.publicProfile(provider.partnerId).capabilities, [])
  assert.throws(() => closed.machineEnrollment('production', provider.partnerId))
  assert.throws(() => closed.authorizeWorker('production', access_token, 'commands:read'))
  const [providerApp] = restored.applications(maya, 'production')
  restored.rename(maya, 'production', providerApp.applicationId, {
    expectedRevision: providerApp.revision, displayName: 'Orchard Research',
  })
  const [application] = restored.applications(noor, 'production')
  restored.decide(reviewer, 'production', application.applicationId, {
    action: 'suspend', reason: 'Owner is investigating', expectedRevision: application.revision,
  })
  assert.deepEqual((await restart.seed(restored, accounts)).map(w => w.partnerId), [provider.partnerId])
  assert.equal(restored.publicProfile(provider.partnerId).displayName, 'Orchard Research')
  assert.equal(restored.publicProfile(custodian.partnerId).status, 'suspended')
})

test('delayed bootstrap renews only expired sandbox evidence required for first production enrollment', async t => {
  const start = Date.now()
  t.mock.timers.enable({ apis: ['Date'], now: start })
  const keyDirectory = mkdtempSync(join(tmpdir(), 'commons-partner-delay-'))
  t.after(() => rmSync(keyDirectory, { recursive: true, force: true }))
  const options = { keyDirectory, enabled: () => true }
  const boot = createDemoPartnerBootstrap(options)
  let running: PartnerRegistrySnapshot | undefined, passed: PartnerRegistrySnapshot | undefined, inReview: PartnerRegistrySnapshot | undefined
  const capture = new PartnerRegistry({ ...boot.registryOptions, changed: () => {
    if (inReview) return
    const snap = capture.snapshot()
    const report = snap.rows[0]?.reports[0]
    if (report?.public.state === 'running' && report.commands.some(c => c.command.state === 'requested')) running ??= snap
    if (report?.public.state === 'passed' && snap.rows.length === 1) passed = snap
    if (snap.rows.some(row => row.app.state === 'in_review')) inReview = snap
  } })
  const firstWorkers = await boot.seed(capture, accounts)
  assert.ok(running && passed, 'captured both stages before the first production application')
  for (const [saved, elapsed] of [[running, 2 * day], [passed, 31 * day]] as const) {
    t.mock.timers.setTime(start + elapsed)
    const restarted = createDemoPartnerBootstrap(options)
    const registry = new PartnerRegistry(restarted.registryOptions)
    registry.restore(saved)
    const workers = await restarted.seed(registry, accounts)
    assert.equal(workers.length, 2)
    const recovered = registry.snapshot()
    const original = saved.rows[0], sandbox = recovered.rows.find(r => r.app.applicationId === original.app.applicationId)!
    assert.deepEqual(sandbox.reports.map(r => r.public.reportId).slice(0, 1), [original.app.conformanceReportId])
    assert.equal(sandbox.reports.length, 2)
    const renewed = sandbox.reports[1]
    assert.equal(renewed.public.state, 'passed')
    assert.equal(renewed.startedAt, start + elapsed)
    const production = recovered.rows.find(r => r.app.partnerId === workers[0].partnerId)!
    assert.equal(production.sandboxReportId, renewed.public.reportId)
    assert.equal(production.app.state, 'active')
    assert.deepEqual((await restarted.seed(registry, accounts)).map(w => w.partnerId), workers.map(w => w.partnerId))
    assert.deepEqual(registry.snapshot(), recovered)
  }

  const restart = createDemoPartnerBootstrap(options)
  const live = new PartnerRegistry(restart.registryOptions)
  live.restore(capture.snapshot())
  const workers = await restart.seed(live, accounts)
  assert.deepEqual(workers.map(w => w.partnerId), firstWorkers.map(w => w.partnerId))
  for (const row of live.snapshot().rows.filter(r => r.app.environment === 'sandbox')) {
    assert.equal(row.reports.length, 1, 'a previously approved production enrollment keeps its original evidence')
  }
  assert.ok(inReview)
  const reviewBoot = createDemoPartnerBootstrap(options)
  const filed = new PartnerRegistry(reviewBoot.registryOptions)
  filed.restore(inReview)
  assert.deepEqual((await reviewBoot.seed(filed, accounts)).map(w => w.slug), ['orchard-coop'])
  const pending = inReview.rows.find(row => row.app.state === 'in_review')!
  assert.equal(filed.snapshot().rows.find(row => row.app.applicationId === pending.app.applicationId)?.app.state, 'in_review',
    'a filed application remains bound to its original evidence and cannot gain approval from a different report')
})

test('a full applicant registry leaves user applications intact and still onboards the other fixture', async t => {
  const keyDirectory = mkdtempSync(join(tmpdir(), 'commons-partner-capacity-'))
  t.after(() => rmSync(keyDirectory, { recursive: true, force: true }))
  const boot = createDemoPartnerBootstrap({ keyDirectory, enabled: () => true })
  const registry = new PartnerRegistry(boot.registryOptions)
  const maya = { userId: 'user-maya', tenantId: 'tenant-growthworks', organizationAdmin: true, operator: false }
  for (let i = 0; i < 128; i++) {
    registry.apply(maya, 'sandbox', { displayName: 'User application ' + i,
      organization: 'Existing organization', organizationUrl: 'https://existing.example.com', handoffUrl: 'https://auth.existing.example.com',
      contact: 'contact@existing.example.com', recoveryContact: 'recovery@existing.example.com',
      capabilities: ['model-provider'], catalog: { models: [{ model: 'model', efforts: [] }], assets: [], rules: [] },
      publicKey: { ...generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }), kid: 'key-' + i },
    })
  }
  const before = registry.snapshot().rows
  assert.deepEqual((await boot.seed(registry, accounts)).map(w => w.slug), ['orchard-coop'])
  assert.deepEqual(registry.snapshot().rows.filter(row => row.owner.tenantId === maya.tenantId), before)

  // Restore the state of a workspace that also has a full sandbox report
  // history before its custodian filed for production.
  const saved = registry.snapshot()
  saved.rows = saved.rows.filter(row => row.app.environment === 'sandbox')
  const limited = new PartnerRegistry(boot.registryOptions)
  limited.restore(saved)
  const noor = { ...maya, userId: 'user-noor', tenantId: 'tenant-northlight' }
  const key = createPrivateKey(readFileSync(join(keyDirectory, 'orchard-coop-sandbox.pem')))
  for (let i = 1; i < 32; i++) {
    const [app] = limited.applications(noor, 'sandbox')
    limited.conformance(noor, 'sandbox', app.applicationId, { expectedRevision: app.revision })
    const [cmd] = limited.sandboxCommands(app.partnerId)
    const signedReceipt = signDemoPartnerJwt(key, app.keys[0].kid, 'partner-receipt+jwt', {
      iss: app.partnerId, aud: demoPartnerAudience('sandbox'), jti: cmd.commandId,
      iat: Math.floor(Date.parse(cmd.issuedAt) / 1000), environment: 'sandbox', commandId: cmd.commandId,
      taskId: cmd.taskId, termsVersion: cmd.termsVersion, termsDigest: cmd.termsDigest,
      outcome: { kind: 'failed', actionKind: cmd.action.kind, reasonCode: 'operator_test' },
    })
    limited.sandboxReceipt(app.partnerId, cmd.commandId, { signedReceipt })
  }
  const full = limited.snapshot()
  assert.deepEqual(await boot.seed(limited, accounts), [])
  assert.deepEqual(limited.snapshot(), full, 'capacity cannot delete, replace or grant any existing work')
})
