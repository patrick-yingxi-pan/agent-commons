import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { PartnerWorkService } from './taskWork.ts'
import { verifiedJws } from './protocol.ts'
import { hash } from './taskTerms.ts'
import { SITE_CUSTODIAN_ID, SITE_WORK_CREDIT } from '../../contract/taskPartnerWork.ts'

const alice = { userId: 'alice', tenantId: 'alpha' },
  bob = { userId: 'bob', tenantId: 'beta' },
  carol = { userId: 'carol', tenantId: 'gamma' }
const project = 'project-1',
  env = 'production',
  custodian = 'orchard',
  provider = 'acorn',
  verifier = 'maple'
const payer = { partnerId: custodian },
  model = { partnerId: provider },
  checker = { partnerId: verifier }
const rule = { ruleId: 'syntax', version: 1, digest: hash('valid syntax') }
const asset = { assetId: 'orchard.voucher', unit: 'voucher', quantity: '3' }
const at = Date.parse('2026-11-19T09:00:00Z')
const iso = (date) => new Date(date).toISOString()
const version = (t) => ({ taskId: t.taskId, termsDigest: t.termsDigest, termsVersion: t.termsVersion })
const updated = (t) => ({ termsDigest: t.termsDigest, termsVersion: t.termsVersion })
const jws = (typ, claims, keys) => {
  const payload = [{ alg: 'Ed25519', typ, kid: 'k1' }, claims]
    .map((x) => Buffer.from(JSON.stringify(x)).toString('base64url'))
    .join('.')
  return payload + '.' + sign(null, Buffer.from(payload), keys.privateKey).toString('base64url')
}
function fixture(extra = {}) {
  const keys = generateKeyPairSync('ed25519'),
    recoveryKeys = generateKeyPairSync('ed25519')
  const clock = { now: at },
    audience = 'https://commons.example/production',
    hidden = new Set()
  const profiles = Object.fromEntries(
    [custodian, provider, verifier].map((partnerId) => [
      partnerId,
      {
        partnerId,
        status: 'active',
        displayName: 'Orchard Works',
        capabilities: partnerId === provider ? ['model-provider'] : ['custodian', 'verifier'],
        identity: {
          domainAscii: partnerId + '.example',
          identityRevision: 1,
          asOf: iso(at),
          verifiedAt: iso(at),
          validUntil: iso(at + 86_400_000),
          profilePath: '/partners/' + partnerId,
          collisionSignals: [],
          relatedPartners: [],
        },
      },
    ]),
  )
  const decode = (token, typ, k) =>
    verifiedJws(token, typ, () => ({ ...k.publicKey.export({ format: 'jwk' }), kid: 'k1' }))
  const directory = {
    publicProfile: (partnerId) => profiles[partnerId],
    machineEnrollment: (env, partnerId) => {
      const p = profiles[partnerId]
      if (!p || p.status !== 'active') throw Object.assign(new Error('inactive'), { status: 409 })
      return {
        domainAscii: p.identity.domainAscii,
        identityRevision: p.identity.identityRevision,
        capabilities: p.capabilities,
        handoffUrl: 'https://' + partnerId + '.example/authorize',
        catalog: {
          models: [{ model: 'oak', efforts: ['high'] }],
          assets: [{ assetId: asset.assetId, unit: 'voucher' }],
          rules: [rule],
        },
      }
    },
    verifyPartnerJws: (env, partnerId, token, typ) => decode(token, typ, keys),
  }
  const opts = {
    directory,
    now: () => clock.now,
    audience,
    canAccessProject: (actor, p) => p === project && !hidden.has(actor.userId),
    verifyRecovery: (_env, _partner, token) => decode(token, 'partner-recovery+jwt', recoveryKeys),
    ...extra,
  }
  const service = new PartnerWorkService(opts)
  function authorize(actor, t, worker, purpose, expectedIdentity?) {
    const begin = service.startHandoff(actor, env, {
      ...version(t),
      partnerId: worker.partnerId,
      purpose,
      ...(expectedIdentity && { expectedIdentity }),
    })
    const offer = service.exchange(worker, env, begin.handoffId, { startCode: begin.startCode })
    assert.throws(() => service.exchange(worker, env, begin.handoffId, { startCode: begin.startCode }))
    const { grant, actorRef, nonce } = offer
    const signedGrant = jws(
      'partner-handoff+jwt',
      {
        iss: worker.partnerId,
        aud: audience,
        iat: Math.floor(clock.now / 1000),
        jti: randomUUID(),
        exp: Date.parse(offer.expiresAt) / 1000,
        ...version(t),
        environment: env,
        handoffId: offer.handoffId,
        actorRef,
        nonce,
        grant,
        grantRef: randomUUID(),
        accountLabel: 'Account ••19',
      },
      keys,
    )
    assert.equal(service.attest(worker, env, begin.handoffId, { signedGrant }).state, 'attested')
    service.decideHandoff(actor, env, begin.handoffId, { decision: 'confirm', termsDigest: t.termsDigest })
    return begin
  }
  const signedReceipt = (cmd, outcome, overrides = {}) =>
    jws(
      'partner-receipt+jwt',
      {
        ...version(cmd),
        iss: cmd.partnerId,
        aud: audience,
        iat: Math.floor(clock.now / 1000),
        jti: randomUUID(),
        commandId: cmd.commandId,
        environment: env,
        outcome,
        ...overrides,
      },
      keys,
    )
  return { service, opts, authorize, signedReceipt, clock, profiles, hidden, keys, recoveryKeys, audience }
}
const funded = {
  description: 'Find a nonce',
  acceptance: { kind: 'sha256-prefix', prefix: 'ac:', difficultyBits: 4 },
  deadline: iso(at + 3_600_000),
  reward: { partnerId: custodian, asset, holdUntil: iso(at + 7_200_000) },
}
function reserve(f, t) {
  f.authorize(alice, t, payer, 'reserve')
  const [cmd] = f.service.commands(payer, env)
  assert.equal(cmd.action.kind, 'reserve')
  const outcome = { ...cmd.action, reservationId: randomUUID() }
  const signedReceipt = f.signedReceipt(cmd, outcome)
  return { cmd, outcome, signedReceipt }
}
const nonce = () => {
  for (let i = 0; ; i++) if (hash('ac:' + i).startsWith('0')) return String(i)
}

test('a private draft publishes open-ended volunteer work, preserves exact bytes and excludes inaccessible Projects', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, { description: 'Comment on the guide' })
  assert.equal(t.funding, 'volunteer')
  assert.deepEqual(s.list(bob, project), [])
  assert.throws(() => s.view(bob, project, t.taskId), { status: 404 })
  assert.throws(() => s.publish(bob, project, t.taskId, updated(t)), { status: 404 })
  const updatedTerms = s.saveTerms(alice, project, t.taskId, {
    expectedVersion: 1,
    terms: { description: 'Review the guide' },
  })
  assert.throws(() => s.publish(alice, project, t.taskId, {}), { status: 400 })
  assert.throws(() => s.publish(alice, project, t.taskId, updated(t)), { status: 409 })
  s.publish(alice, project, t.taskId, updated(updatedTerms))
  const result = s.submit(bob, project, t.taskId, { ...updated(updatedTerms), text: 'Good\n' })
  assert.deepEqual(
    result.submissions.map((x) => [x.mine, x.text, x.verdict, x.provenance]),
    [[true, 'Good\n', 'open', 'optional']],
  )
  assert.equal(s.view(carol, project, t.taskId).submissions[0].mine, false)
  f.hidden.add('bob')
  assert.throws(() => s.view(bob, project, t.taskId), { status: 404 })
  assert.throws(() => s.submit(bob, project, t.taskId, { ...updated(updatedTerms), text: 'again' }), { status: 404 })
})

test('reward requires executable terms and the exact reserve; authorization can be withdrawn before dispatch and duplicate delivery stays single after restart', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, funded)
  assert.throws(() => s.publish(alice, project, t.taskId, {}), { status: 400 })
  assert.throws(() => s.publish(alice, project, t.taskId, updated(t)), { status: 409 })
  const noRule = s.createDraft(alice, project, { ...funded, acceptance: undefined })
  assert.throws(() => s.publish(alice, project, noRule.taskId, updated(noRule)), { code: 'acceptance_required' })
  f.profiles[custodian].identity.collisionSignals = ['exact_name']
  assert.throws(() => s.startHandoff(alice, env, { ...version(t), partnerId: custodian, purpose: 'reserve' }), {
    code: 'identity_confirmation_required',
  })
  const withdrawn = f.authorize(alice, t, payer, 'reserve', { domainAscii: 'orchard.example', identityRevision: 1 })
  assert.equal(s.hasCurrentPin(alice, custodian, f.profiles[custodian].identity), true)
  assert.equal(s.hasCurrentPin(bob, custodian, f.profiles[custodian].identity), false)
  s.decideHandoff(alice, env, withdrawn.handoffId, { decision: 'withdraw', termsDigest: t.termsDigest })
  assert.deepEqual(s.commands(payer, env), [])
  const { cmd, signedReceipt, outcome } = reserve(f, t)
  assert.throws(
    () =>
      s.receipt(payer, env, cmd.commandId, {
        signedReceipt: f.signedReceipt(cmd, { ...outcome, asset: { ...asset, quantity: '2' } }),
      }),
    { code: 'receipt_mismatch' },
  )
  assert.throws(() => s.publish(alice, project, t.taskId, {}), { status: 400 })
  assert.throws(() => s.publish(alice, project, t.taskId, updated(t)), { status: 409 })
  const ack = s.receipt(payer, env, cmd.commandId, { signedReceipt })
  s.publish(alice, project, t.taskId, updated(t))
  assert.equal(s.list(bob, project).length, 1)
  let wrong = 'bad'
  while (hash('ac:' + wrong).startsWith('0')) wrong += 'x'
  assert.equal(s.submit(carol, project, t.taskId, { ...updated(t), text: wrong }).submissions[0].verdict, 'rejected')
  const winner = s.submit(bob, project, t.taskId, { ...updated(t), text: nonce() })
  assert.equal(winner.winnerId, winner.submissions[1].submissionId)
  assert.throws(() => s.submit(carol, project, t.taskId, { ...updated(t), text: nonce() }), { status: 409 })
  assert.throws(() => s.cancel(alice, project, t.taskId, updated(t)), { status: 409 })
  f.authorize(bob, t, payer, 'receive', { domainAscii: 'orchard.example', identityRevision: 1 })
  const [release] = s.commands(payer, env)
  assert.equal(release.action.kind, 'release')
  assert.equal(release.action.reservationId, outcome.reservationId)
  const paid = f.signedReceipt(release, { ...release.action, transferRef: 'payout' })
  const paidAck = s.receipt(payer, env, release.commandId, { signedReceipt: paid })
  const restored = new PartnerWorkService(f.opts)
  restored.restore(s.snapshot())
  assert.deepEqual(restored.receipt(payer, env, cmd.commandId, { signedReceipt }), ack)
  assert.deepEqual(restored.receipt(payer, env, release.commandId, { signedReceipt: paid }), paidAck)
  assert.deepEqual(restored.commands(payer, env), [])
  assert.equal(restored.view(alice, project, t.taskId).funding, 'delivered')
  assert.equal(restored.obligations({ ...alice, operator: true }, env)[0].state, 'closed')
})

test('the run and its external verifier can only read assigned bytes, and require separate provenance and acceptance evidence', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, {
    description: 'Produce a review',
    participation: 'single-claim',
    acceptance: { kind: 'partner', partnerId: verifier, rule },
    provenance: { partnerId: provider, model: 'oak', effort: 'high', maxInputTokens: 120, maxOutputTokens: 80 },
  })
  s.publish(alice, project, t.taskId, updated(t))
  s.claim(bob, project, t.taskId, updated(t))
  assert.throws(() => s.claim(carol, project, t.taskId, updated(t)), { status: 409 })
  f.authorize(bob, t, model, 'run')
  const [cmd] = s.commands(model, env)
  assert.equal(s.artifact(model, env, cmd.commandId, cmd.action.input.artifactId).bytes.toString(), 'Produce a review')
  assert.throws(() => s.artifact(payer, env, cmd.commandId, cmd.action.input.artifactId), { status: 404 })
  const bytes = Buffer.from('My review'),
    ref = s.upload(model, env, cmd.commandId, 'text/plain', bytes, hash(bytes))
  const outcome = {
    kind: 'run',
    submissionId: cmd.action.submissionId,
    grantRef: cmd.action.grantRef,
    providerRunId: 'run-1',
    inputDigest: cmd.action.input.digest,
    actualModel: 'oak',
    actualEffort: 'high',
    output: ref,
  }
  assert.throws(
    () =>
      s.receipt(model, env, cmd.commandId, {
        signedReceipt: f.signedReceipt(cmd, { ...outcome, actualEffort: 'low' }),
      }),
    { code: 'receipt_mismatch' },
  )
  assert.throws(
    () =>
      s.receipt(model, env, cmd.commandId, {
        signedReceipt: f.signedReceipt(cmd, { ...outcome, output: { ...ref, artifactId: 'other' } }),
      }),
    { code: 'artifact_mismatch' },
  )
  s.receipt(model, env, cmd.commandId, { signedReceipt: f.signedReceipt(cmd, outcome) })
  const [submission] = s.view(alice, project, t.taskId).submissions
  assert.deepEqual([submission.text, submission.provenance, submission.verdict], ['My review', 'attested', 'pending'])
  const [verify] = s.commands(checker, env)
  assert.deepEqual(s.artifact(checker, env, verify.commandId, ref.artifactId).bytes, bytes)
  const verdict = {
    kind: 'verify',
    submissionId: submission.submissionId,
    submissionDigest: ref.digest,
    rule,
    verdict: 'rejected',
    detailCode: 'incomplete',
  }
  s.receipt(checker, env, verify.commandId, { signedReceipt: f.signedReceipt(verify, verdict) })
  assert.equal(s.view(bob, project, t.taskId).submissions[0].verdict, 'rejected')
})

test('ambiguous external settlement freezes the hold; recovery requires separate operators, a recovery signature and the original command', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, funded),
    { cmd, signedReceipt } = reserve(f, t)
  s.receipt(payer, env, cmd.commandId, { signedReceipt })
  s.publish(alice, project, t.taskId, updated(t))
  s.cancel(alice, project, t.taskId, updated(t))
  const [refund] = s.commands(payer, env)
  s.receipt(payer, env, refund.commandId, {
    signedReceipt: f.signedReceipt(refund, { kind: 'unknown', actionKind: 'return', reasonCode: 'ack_lost' }),
  })
  const incident = { ...alice, operator: true, freshAuth: true, recoveryRole: 'incident' },
    settlement = { ...bob, operator: true, freshAuth: true, recoveryRole: 'settlement' }
  const [o] = s.obligations(incident, env)
  const r = s.recover(incident, env, o.obligationId, {
    action: 'open',
    mode: 'lookup',
    reason: 'Look up transfer',
    commandId: refund.commandId,
    expectedRevision: o.revision,
  })
  assert.throws(
    () =>
      s.recover({ ...incident, recoveryRole: 'settlement' }, env, o.obligationId, {
        action: 'authorize',
        recoveryId: r.recoveryId,
        expectedRevision: 1,
      }),
    { status: 403 },
  )
  s.recover(settlement, env, o.obligationId, { action: 'authorize', recoveryId: r.recoveryId, expectedRevision: 1 })
  const claims = {
    ...version(t),
    jti: 'receipt-offline',
    iss: custodian,
    aud: f.audience,
    iat: at / 1000,
    environment: env,
    commandId: refund.commandId,
    recoveryId: r.recoveryId,
    outcome: { ...refund.action, transferRef: 'return-1' },
  }
  const signed = jws('partner-recovery+jwt', claims, f.recoveryKeys),
    ed = hash(signed)
  f.profiles[custodian].status = 'suspended'
  s.recover(incident, env, o.obligationId, {
    action: 'submit_evidence',
    recoveryId: r.recoveryId,
    expectedRevision: 2,
    externalEvidence: signed,
    evidenceDigest: ed,
    sourceReference: 'ledger-71',
  })
  assert.throws(
    () =>
      s.recover({ ...incident, recoveryRole: 'settlement' }, env, o.obligationId, {
        action: 'confirm_evidence',
        recoveryId: r.recoveryId,
        expectedRevision: 3,
        evidenceDigest: ed,
      }),
    { status: 403 },
  )
  s.recover(settlement, env, o.obligationId, {
    action: 'confirm_evidence',
    recoveryId: r.recoveryId,
    expectedRevision: 3,
    evidenceDigest: ed,
  })
  assert.equal(s.view(alice, project, t.taskId).funding, 'returned')
  assert.equal(s.obligations(incident, env)[0].state, 'closed')
})

test('a failed durable write leaves no task, command or artifact behind', () => {
  const f = fixture({
      changed: () => {
        throw new Error('storage full')
      },
    }),
    before = f.service.snapshot()
  assert.throws(() => f.service.createDraft(alice, project, { description: 'Save this' }), /storage full/)
  assert.deepEqual(f.service.snapshot(), before)
})

test('site-issued credits conserve spendable balances through reserve, competing drafts, payout, reuse and return', () => {
  const f = fixture(),
    s = f.service,
    issuer = { ...carol, operator: true }
  const siteTerms = {
    ...funded,
    reward: { ...funded.reward, partnerId: SITE_CUSTODIAN_ID, asset: { ...SITE_WORK_CREDIT, quantity: '3' } },
  }
  const a = s.createDraft(alice, project, siteTerms),
    b = s.createDraft(alice, project, siteTerms)
  const issuance = { reference: 'pilot-001', quantity: '3', reason: 'Three study credits' }
  assert.throws(() => s.issueCredits(alice, alice, issuance), { status: 403 })
  assert.throws(() => s.fundFromBalance(alice, project, a.taskId, updated(a)), { status: 409 })
  s.issueCredits(issuer, alice, issuance)
  s.issueCredits(issuer, alice, issuance)
  assert.throws(() => s.issueCredits(issuer, bob, issuance), { status: 409 })
  s.fundFromBalance(alice, project, a.taskId, updated(a))
  assert.deepEqual(s.balance(alice), { ...SITE_WORK_CREDIT, available: '0', held: '3' })
  assert.throws(() => s.fundFromBalance(alice, project, b.taskId, updated(b)), { status: 409 })
  assert.throws(() => s.publish(alice, project, b.taskId, updated(b)), { status: 409 })
  s.publish(alice, project, a.taskId, updated(a))
  const award = s.submit(bob, project, a.taskId, { ...updated(a), text: nonce() })
  assert.equal(award.funding, 'delivered')
  assert.equal(s.balance(alice).held, '0')
  assert.equal(s.balance(bob).available, '3')
  const restored = new PartnerWorkService(f.opts)
  restored.restore(s.snapshot())
  assert.deepEqual(restored.balance(bob), s.balance(bob))
  const next = restored.createDraft(bob, project, siteTerms)
  restored.fundFromBalance(bob, project, next.taskId, updated(next))
  const cancelled = restored.cancel(bob, project, next.taskId, updated(next))
  assert.equal(cancelled.funding, 'returned')
  assert.deepEqual(restored.balance(bob), { ...SITE_WORK_CREDIT, available: '3', held: '0' })
  restored.restore(restored.snapshot())
  const corrupt = restored.snapshot()
  corrupt.creditEntries[0][1].amount = '1'
  assert.throws(() => restored.restore(corrupt), /Inconsistent partner work journal/)
  assert.equal(restored.balance(bob).available, '3')
})

test('maintenance returns unawarded expired site holds and preserves uncertain external effects for reconciliation', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, funded),
    { cmd } = reserve(f, t)
  const site = s.createDraft(bob, project, {
    ...funded,
    reward: { ...funded.reward, partnerId: SITE_CUSTODIAN_ID, asset: { ...SITE_WORK_CREDIT, quantity: '1' } },
  })
  s.issueCredits({ ...carol, operator: true }, bob, {
    reference: 'pilot-2',
    quantity: '1',
    reason: 'Study participation',
  })
  s.fundFromBalance(bob, project, site.taskId, updated(site))
  s.publish(bob, project, site.taskId, updated(site))
  f.clock.now += 8_000_000
  assert.equal(s.maintain(), 2)
  assert.equal(s.maintain(), 0)
  assert.equal(s.view(alice, project, t.taskId).funding, 'uncertain')
  assert.equal(s.command(payer, env, cmd.commandId).state, 'uncertain')
  assert.equal(
    s.obligations({ ...carol, operator: true }, env).find((o) => o.taskId === t.taskId).state,
    'effect_uncertain',
  )
  assert.equal(s.view(bob, project, site.taskId).funding, 'returned')
  assert.equal(s.balance(bob).available, '1')
})

test('actor-scoped acks never expose unsettled bytes, stale terms or changed domains', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, {
    description: 'Produce evidence',
    provenance: { partnerId: provider, model: 'oak', maxInputTokens: 10, maxOutputTokens: 8 },
  })
  s.publish(alice, project, t.taskId, updated(t))
  const h = f.authorize(bob, t, model, 'run')
  assert.throws(() => s.handoff(carol, env, h.handoffId), { status: 404 })
  f.profiles[provider].identity.identityRevision++
  assert.deepEqual(s.commands(model, env), [])
  assert.equal(s.handoff(bob, env, h.handoffId).state, 'confirmed')
  const status = s.view(alice, project, t.taskId).partners[0]
  assert.deepEqual(
    [status.domainAscii, status.identityRevision, status.status],
    ['acorn.example', 1, 'verification_lapsed'],
  )
  const volunteer = s.createDraft(alice, project, { description: 'Chunk the submitted bytes' })
  s.publish(alice, project, volunteer.taskId, updated(volunteer))
  const sub = s.submit(bob, project, volunteer.taskId, { ...updated(volunteer), text: 'abcde' }).submissions[0]
  assert.deepEqual(s.submissionOutput(bob, project, volunteer.taskId, sub.submissionId, { length: 3 }).nextOffset, 3)
  assert.equal(
    Buffer.from(
      s.submissionOutput(alice, project, volunteer.taskId, sub.submissionId, { offset: 3 }).dataBase64,
      'base64',
    ).toString(),
    'de',
  )
  f.hidden.add('carol')
  assert.throws(() => s.submissionOutput(carol, project, volunteer.taskId, sub.submissionId), { status: 404 })
})

test('revised terms create a private successor and retain the original public agreement and discussion', () => {
  const f = fixture(),
    s = f.service,
    t = s.createDraft(alice, project, { description: 'Feedback for volunteers' })
  s.publish(alice, project, t.taskId, updated(t))
  s.appendThreadComment(project, t.taskId, { id: 'comment-1', author: 'Bob', body: 'Understood', at: at })
  const proposal = { ...updated(t), terms: funded }
  const revised = s.revise(alice, project, t.taskId, proposal)
  assert.deepEqual(revised.previousOffer, version(t))
  assert.notEqual(revised.taskId, t.taskId)
  assert.equal(revised.termsVersion, t.termsVersion + 1)
  assert.equal(s.revise(alice, project, t.taskId, proposal).taskId, revised.taskId)
  assert.equal(s.list(bob, project).length, 1)
  assert.deepEqual(
    s.publishedThreads(project).map((w) => [w.id, w.comments?.length]),
    [[t.taskId, 1]],
  )
  assert.throws(() => s.publish(alice, project, revised.taskId, updated(revised)), { status: 409 })
  const restored = new PartnerWorkService(f.opts)
  restored.restore(s.snapshot())
  assert.equal(restored.view(alice, project, t.taskId).funding, 'volunteer')
  assert.equal(restored.publishedThread(project, t.taskId).comments[0].body, 'Understood')
  assert.equal(restored.publishedThread(project, revised.taskId), undefined)
})

test('a definitive verification failure records unavailable work and permits cancellation', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, {
    description: 'Check syntax',
    acceptance: { kind: 'partner', partnerId: verifier, rule },
  })
  s.publish(alice, project, t.taskId, updated(t))
  s.submit(bob, project, t.taskId, { ...updated(t), text: 'Sample' })
  const [cmd] = s.commands(checker, env)
  s.receipt(checker, env, cmd.commandId, {
    signedReceipt: f.signedReceipt(cmd, { kind: 'failed', actionKind: 'verify', reasonCode: 'rule_unavailable' }),
  })
  assert.equal(s.view(alice, project, t.taskId).submissions[0].verdict, 'unavailable')
  assert.equal(s.cancel(alice, project, t.taskId, updated(t)).status, 'cancelled')
  s.restore(s.snapshot())
})

test('confirming an existing hold by independent lookup never allocates another reservation', () => {
  const f = fixture(),
    s = f.service
  const t = s.createDraft(alice, project, funded),
    { cmd, outcome, signedReceipt } = reserve(f, t)
  s.receipt(payer, env, cmd.commandId, { signedReceipt })
  const incident = { ...alice, operator: true, freshAuth: true, recoveryRole: 'incident' }
  const settlement = { ...bob, operator: true, freshAuth: true, recoveryRole: 'settlement' }
  const [o] = s.obligations(incident, env)
  const r = s.recover(incident, env, o.obligationId, {
    action: 'open',
    mode: 'lookup',
    reason: 'Confirm held voucher',
    commandId: cmd.commandId,
    expectedRevision: o.revision,
  })
  const { recoveryId } = r
  assert.deepEqual(r.availableActions, [])
  assert.deepEqual(s.recovery(settlement, env, o.obligationId, recoveryId).availableActions, ['authorize'])
  assert.throws(() => s.publish(alice, project, t.taskId, updated(t)), { status: 409 })
  assert.throws(() => s.cancel(alice, project, t.taskId, updated(t)), { status: 409 })
  s.recover(settlement, env, o.obligationId, { action: 'authorize', recoveryId, expectedRevision: 1 })
  const claims = {
    ...version(t),
    jti: 'reconfirmed',
    iss: custodian,
    aud: f.audience,
    iat: at / 1000,
    environment: env,
    commandId: cmd.commandId,
    recoveryId,
    outcome,
  }
  const signed = jws('partner-recovery+jwt', claims, f.recoveryKeys),
    evidenceDigest = hash(signed)
  s.recover(incident, env, o.obligationId, {
    action: 'submit_evidence',
    recoveryId,
    expectedRevision: 2,
    externalEvidence: signed,
    evidenceDigest,
    sourceReference: 'ledger-18',
  })
  s.recover(settlement, env, o.obligationId, {
    action: 'confirm_evidence',
    recoveryId,
    expectedRevision: 3,
    evidenceDigest,
  })
  assert.deepEqual(
    s.obligations(incident, env).map((o) => [o.reservationId, o.state]),
    [[outcome.reservationId, 'held']],
  )
  assert.equal(s.snapshot().commands.length, 1)
  s.restore(s.snapshot())
  assert.equal(s.publish(alice, project, t.taskId, updated(t)).status, 'published')
})

test('start-code retries keep secrets out of storage and bind reconstruction to a current unconsumed authorization', () => {
  const f = fixture(),
    s = f.service,
    t = s.createDraft(alice, project, funded)
  const body = { ...version(t), partnerId: custodian, purpose: 'reserve' }
  const handle = s.prepareHandoff(alice, env, body)
  assert.deepEqual(Object.keys(handle), ['handoffId'])
  const first = s.startResponse(alice, env, handle)
  const snapshot = s.snapshot()
  assert.equal(JSON.stringify(snapshot).includes(first.startCode), false)
  const restored = new PartnerWorkService(f.opts)
  restored.restore(snapshot)
  assert.deepEqual(restored.startResponse(alice, env, handle), first)
  assert.throws(() => restored.startResponse(bob, env, handle), { status: 404 })
  restored.exchange(payer, env, handle.handoffId, { startCode: first.startCode })
  assert.throws(() => restored.startResponse(alice, env, handle), { status: 409 })
  const waiting = s.prepareHandoff(alice, env, body)
  f.clock.now += 301_000
  assert.throws(() => s.startResponse(alice, env, waiting), { status: 409 })
  const withdrawn = s.prepareHandoff(alice, env, body)
  s.decideHandoff(alice, env, withdrawn.handoffId, { decision: 'decline', termsDigest: t.termsDigest })
  assert.throws(() => s.startResponse(alice, env, withdrawn), { status: 409 })
})
