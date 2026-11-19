/** Conformance of the partner wire contract and its published examples.
 * These tests read the OpenAPI document. HTTP authorization, signature verification
 * and settlement under retries require the live implementation's integration tests. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, verify } from 'node:crypto'
import { join } from 'node:path'
import { domainToASCII, domainToUnicode } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { read, ROOT } from './helpers/source.ts'

const doc = JSON.parse(read(join(ROOT, 'docs/design/task-partner-api.openapi.json')))
const schemas = doc.components.schemas
const schemaId = 'https://agent-commons.invalid/contracts/task-partners'
// OpenAPI 3.1 uses JSON Schema 2020-12; format is an annotation by default.
const ajv = new Ajv2020({ strict: false, validateFormats: false })
ajv.addSchema({ components: { schemas } }, schemaId)

function validator(name: string) {
  const validate = ajv.getSchema(schemaId + '#/components/schemas/' + name)
  assert.ok(validate, 'Missing schema: ' + name)
  return validate
}

function localRef(ref: string) {
  assert.ok(ref.startsWith('#/'), 'Contract must resolve offline: ' + ref)
  let value = doc
  for (const step of ref.slice(2).split('/')) value = value?.[step.replaceAll('~1', '/').replaceAll('~0', '~')]
  assert.ok(value, 'Broken contract reference: ' + ref)
  return value
}

test('the OpenAPI contract resolves offline and its schema examples validate', () => {
  assert.match(doc.openapi, /^3\.1\./)
  function checkRefs(value: unknown) {
    if (!value || typeof value !== 'object') return
    if ('$ref' in value) localRef(String(value.$ref))
    Object.values(value).forEach(checkRefs)
  }
  checkRefs(doc)
  for (const name of Object.keys(schemas)) {
    const validate = validator(name)
    for (const example of schemas[name].examples ?? [])
      assert.ok(validate(example), name + ': ' + ajv.errorsText(validate.errors))
  }
  // The examples are a usable exchange for every role, including ambiguous outcomes.
  assert.deepEqual(new Set(schemas.Command.examples.map(c => c.action.kind)),
    new Set(['reserve', 'run', 'verify', 'release', 'return']))
  assert.deepEqual(new Set(schemas.ReceiptClaims.examples.map(r => r.outcome.kind)),
    new Set(['reserve', 'run', 'verify', 'release', 'return', 'failed', 'unknown']))
})

test('the HTTP operations expose the enrollment, consent, command and receipt schemas used by partners', () => {
  const exchanges = [
    ['post', '/applications', 'ApplicationRequest', '201', 'Application'],
    ['post', '/applications/{applicationId}/name', 'PartnerRename', '200', 'Application'],
    ['post', '/applications/{applicationId}/proofs', 'Proof', '200', 'Application'],
    ['post', '/handoffs', 'HandoffRequest', '201', 'HandoffStart'],
    ['post', '/handoffs/{handoffId}/exchange', 'HandoffExchange', '200', 'HandoffOffer'],
    ['post', '/handoffs/{handoffId}/attestations', 'HandoffAttestation', '200', 'Handoff'],
    ['post', '/handoffs/{handoffId}/decisions', 'HandoffDecision', '200', 'Handoff'],
    ['get', '/commands', null, '200', 'CommandPage'],
    ['get', '/commands/{commandId}', null, '200', 'Command'],
    ['post', '/commands/{commandId}/receipts', 'ReceiptSubmission', '200', 'ReceiptAcknowledgement'],
  ]
  for (const [method, path, request, status, response] of exchanges) {
    const operation = doc.paths[path][method]
    if (request) {
      assert.equal(operation.requestBody.required, true, operation.operationId)
      assert.equal(operation.requestBody.content['application/json'].schema.$ref, '#/components/schemas/' + request)
    }
    assert.equal(operation.responses[status].content['application/json'].schema.$ref, '#/components/schemas/' + response)
  }
})

test('partner commands and consent exchange require their assigned OAuth scopes', () => {
  const expected = [
    ['get', '/commands', 'commands:read'],
    ['get', '/commands/{commandId}', 'commands:read'],
    ['post', '/commands/{commandId}/receipts', 'receipts:write'],
    ['post', '/commands/{commandId}/artifacts', 'artifacts:write'],
    ['get', '/commands/{commandId}/artifacts/{artifactId}', 'artifacts:read'],
    ['post', '/handoffs/{handoffId}/exchange', 'handoffs:write'],
    ['post', '/handoffs/{handoffId}/attestations', 'handoffs:write'],
  ]
  for (const [method, path, scope] of expected) {
    const operation = doc.paths[path]?.[method]
    assert.ok(operation, method + ' ' + path)
    assert.deepEqual(operation.security ?? doc.security, [{ PartnerOAuth: [scope] }], operation.operationId)
    assert.ok(Object.hasOwn(doc.components.securitySchemes.PartnerOAuth.flows.clientCredentials.scopes, scope))
  }
})

test('application management and the contributor’s final consent require a human principal', () => {
  const paths = ['/applications', '/applications/{applicationId}/decisions', '/applications/{applicationId}/keys',
    '/applications/{applicationId}/proofs', '/handoffs', '/handoffs/{handoffId}/decisions',
    '/obligations/{obligationId}/recoveries']
  for (const path of paths) {
    const operation = doc.paths[path]?.post
    assert.ok(operation, 'Missing human operation at ' + path)
    assert.deepEqual(operation.security ?? doc.security, [{ Session: [] }, { HumanBearer: [] }], operation.operationId)
  }
})

test('the token exchange specifies a private-key assertion and short-lived, non-cacheable credentials', () => {
  const issue = doc.paths['/oauth/token'].post
  const tokenUrl = doc.components.securitySchemes.PartnerOAuth.flows.clientCredentials.tokenUrl
  assert.equal(new URL(tokenUrl, doc.servers[0].url).pathname, '/v1/task-partners/oauth/token')
  assert.equal(issue['x-client-authentication-method'], 'private_key_jwt')
  const form = issue.requestBody.content['application/x-www-form-urlencoded'].schema
  assert.equal(form.$ref, '#/components/schemas/TokenRequest')
  const validate = validator('TokenRequest')
  // These bytes exercise compact framing; the independently signed vector below exercises receipt verification.
  const request = { grant_type: 'client_credentials', scope: 'commands:read', client_id: 'sandbox-custodian',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: 'YQ.Yg.Yw' }
  assert.ok(validate(request), ajv.errorsText(validate.errors))
  assert.equal(validate({ ...request, grant_type: 'password' }), false)
  assert.equal(validate({ ...request, client_secret: 'unsupported' }), false)
  const {client_assertion, ...unsigned} = request
  assert.equal(validate(unsigned), false)
  const response = issue.responses['200']
  assert.equal(response.headers['Cache-Control'].schema.const, 'no-store')
  assert.equal(response.content['application/json'].schema.$ref, '#/components/schemas/TokenResponse')
  const token = { token_type: 'Bearer', access_token: 'sample', expires_in: 300, scope: 'commands:read' }
  const validateToken = validator('TokenResponse')
  assert.ok(validateToken(token), ajv.errorsText(validateToken.errors))
  assert.equal(validateToken({ ...token, expires_in: 301 }), false)
  assert.equal(validateToken({ ...token, refresh_token: 'unexpected' }), false)
})

test('every application, consent or task write requires a retry key', () => {
  // OAuth token requests use a fresh single-use assertion on each attempt.
  const posts = Object.entries(doc.paths).filter(([path, item]) => item.post && path !== '/oauth/token')
  assert.ok(posts.some(([path]) => path === '/applications'))
  assert.ok(posts.some(([path]) => path === '/commands/{commandId}/receipts'))
  for (const [path, item] of posts) {
    const parameters = [...(item.parameters ?? []), ...(item.post.parameters ?? [])]
      .map(param => param.$ref ? localRef(param.$ref) : param)
    const key = parameters.find(param => param.in === 'header' && param.name.toLowerCase() === 'idempotency-key')
    assert.equal(key?.required, true, 'Missing required Idempotency-Key on POST ' + path)
  }
})

test('decoded receipt fixtures identify the command, issuer and exact agreed terms', () => {
  const commands = schemas.Command.examples
  for (const claims of schemas.ReceiptClaims.examples) {
    const command = commands.find(c => c.commandId === claims.commandId)
    assert.ok(command, 'No example command for receipt ' + claims.jti)
    assert.equal(claims.iss, command.partnerId)
    for (const field of ['taskId', 'termsVersion', 'termsDigest', 'environment'])
      assert.equal(claims[field], command[field], claims.jti + ': ' + field)
    const { action } = command
    const { outcome } = claims
    switch (outcome.kind) {
      case 'failed':
      case 'unknown':
        assert.equal(outcome.actionKind, action.kind, claims.jti)
        break
      case 'reserve':
      case 'release':
      case 'return':
        assert.equal(outcome.kind, action.kind, claims.jti)
        assert.deepEqual(outcome.asset, action.asset, 'Reserved and delivered units must match the command')
        if (action.kind !== 'reserve') assert.equal(outcome.reservationId, action.reservationId)
        if (action.kind !== 'release') assert.equal(outcome.payerRef, action.payerRef)
        if (action.kind !== 'return') assert.equal(outcome.grantRef, action.grantRef)
        if (action.kind === 'release') assert.equal(outcome.beneficiaryRef, action.beneficiaryRef)
        break
      case 'run':
        assert.equal(action.kind, 'run')
        assert.equal(outcome.inputDigest, action.input.digest)
        assert.equal(outcome.grantRef, action.grantRef)
        assert.equal(outcome.submissionId, action.submissionId)
        break
      case 'verify':
        assert.equal(action.kind, 'verify')
        assert.equal(outcome.submissionId, action.submissionId)
        assert.equal(outcome.submissionDigest, action.submission.digest)
        assert.deepEqual(outcome.rule, action.rule)
        break
      default:
        assert.fail('Missing example binding checks for outcome ' + outcome.kind)
    }
  }
})

test('the worked exchange delivers the reserved asset against the attested and checked submission', () => {
  const receipts = schemas.ReceiptClaims.examples
  const receipt = kind => {
    const example = receipts.find(r => r.outcome.kind === kind)
    assert.ok(example, 'Missing receipt for ' + kind)
    return example
  }
  const hold = receipt('reserve'), run = receipt('run'), check = receipt('verify'), delivery = receipt('release')
  for (const r of [run, check, delivery]) {
    assert.equal(r.taskId, hold.taskId)
    assert.equal(r.termsDigest, hold.termsDigest)
    assert.equal(r.termsVersion, hold.termsVersion)
    assert.equal(r.environment, hold.environment)
  }
  const runAction = schemas.Command.examples.find(c => c.commandId === run.commandId).action
  assert.equal(run.outcome.actualModel, runAction.model)
  assert.equal(typeof runAction.effort, 'string', 'The worked example requests attested effort')
  assert.equal(run.outcome.actualEffort, runAction.effort)
  const verifyAction = schemas.Command.examples.find(c => c.commandId === check.commandId).action
  assert.deepEqual(verifyAction.submission, run.outcome.output)
  assert.equal(check.outcome.submissionId, run.outcome.submissionId)
  assert.equal(check.outcome.verdict, 'passed')
  assert.equal(delivery.outcome.submissionId, check.outcome.submissionId)
  assert.equal(delivery.iss, hold.iss)
  assert.equal(delivery.outcome.reservationId, hold.outcome.reservationId)
  assert.deepEqual(delivery.outcome.asset, hold.outcome.asset)
})

test('a model-only provider can advertise, authorize and report a run without an effort claim', () => {
  const run = schemas.Command.examples.find(c => c.action.kind === 'run')
  const receipt = schemas.ReceiptClaims.examples.find(r => r.outcome.kind === 'run')
  const { effort, ...action } = run.action
  const { actualEffort, ...outcome } = receipt.outcome
  const validateOffer = validator('ModelOffer')
  assert.ok(validateOffer({ model: action.model, efforts: [] }), ajv.errorsText(validateOffer.errors))
  const validateGrant = validator('GrantTerms')
  const grant = { kind: 'run', model: action.model, inputDigest: action.input.digest,
    maxInputTokens: action.maxInputTokens, maxOutputTokens: action.maxOutputTokens }
  assert.ok(validateGrant(grant), ajv.errorsText(validateGrant.errors))
  const validateCommand = validator('Command')
  assert.ok(validateCommand({ ...run, action }), ajv.errorsText(validateCommand.errors))
  const validateReceipt = validator('ReceiptClaims')
  assert.ok(validateReceipt({ ...receipt, outcome }), ajv.errorsText(validateReceipt.errors))
  const { actualModel, ...unattributed } = outcome
  assert.equal(validateReceipt({ ...receipt, outcome: unattributed }), false)
})

test('the consent exchange binds a task-specific grant to the initiating actor and challenge', () => {
  const validateRequest = validator('HandoffRequest')
  const validateOffer = validator('HandoffOffer')
  const validateGrant = validator('GrantTerms')
  const { taskId, termsVersion, termsDigest, partnerId, environment, action } =
    schemas.Command.examples.find(c => c.action.kind === 'run')
  const request = { taskId, termsVersion, termsDigest, partnerId, purpose: 'run' }
  assert.ok(validateRequest(request), ajv.errorsText(validateRequest.errors))
  assert.equal(validateRequest({ ...request, actorRef: 'caller-selected' }), false)
  const grant = { kind: 'run', model: action.model, effort: action.effort, inputDigest: action.input.digest,
    maxInputTokens: action.maxInputTokens, maxOutputTokens: action.maxOutputTokens }
  const offer = { taskId, termsVersion, termsDigest, partnerId, environment, grant, handoffId: 'handoff-1',
    actorRef: 'pairwise-1', nonce: 'challenge-1', expiresAt: '2027-01-01T12:00:00Z',
    workSummary: 'Produce a schedule for the supplied constraints.' }
  assert.ok(validateOffer(offer), ajv.errorsText(validateOffer.errors))
  const claims = { iss: partnerId, aud: 'sandbox-api', jti: 'consent-1', iat: 1798804500, exp: 1798804800,
    environment, taskId, termsDigest, termsVersion, handoffId: offer.handoffId, actorRef: offer.actorRef,
    nonce: offer.nonce, grant, grantRef: 'grant-1', accountLabel: 'Account ending 42' }
  const validateClaims = validator('HandoffClaims')
  assert.ok(validateClaims(claims), ajv.errorsText(validateClaims.errors))
  for (const field of ['actorRef', 'nonce', 'grant', 'termsDigest', 'expiresAt']) {
    const missing = { ...offer }
    delete missing[field]
    assert.equal(validateOffer(missing), false, 'Missing ' + field)
  }
  for (const field of ['grantRef', 'actorRef', 'nonce', 'exp', 'termsDigest']) {
    const missing = { ...claims }
    delete missing[field]
    assert.equal(validateClaims(missing), false, 'Grant attestation missing ' + field)
  }
  const asset = schemas.Command.examples.find(c => c.action.kind === 'reserve').action.asset
  assert.ok(validateGrant({ kind: 'reserve', asset, holdUntil: offer.expiresAt }))
  assert.ok(validateGrant({ kind: 'receive', asset }))
  assert.equal(validateGrant({ ...grant, maxOutputTokens: 0 }), false)
  assert.equal(validateGrant({ ...grant, asset }), false)
})

test('receipt claims reject missing bindings and an outcome without its role-specific evidence', () => {
  const validate = validator('ReceiptClaims')
  for (const receipt of schemas.ReceiptClaims.examples) {
    assert.ok(validate(receipt), ajv.errorsText(validate.errors))
    for (const field of ['iss', 'aud', 'jti', 'iat', 'environment', 'taskId', 'commandId', 'termsVersion', 'termsDigest']) {
      const incomplete = { ...receipt }
      delete incomplete[field]
      assert.equal(validate(incomplete), false, receipt.outcome.kind + ' receipt accepted without ' + field)
    }
    assert.equal(validate({ ...receipt, outcome: { kind: receipt.outcome.kind } }), false,
      receipt.outcome.kind + ' accepted without its outcome details')
  }
})

test('reward quantities are exact positive base-unit counts for cash and noncash assets', () => {
  const validate = validator('Asset')
  const asset = { assetId: 'service-voucher', unit: 'voucher', quantity: '3' }
  assert.ok(validate(asset), ajv.errorsText(validate.errors))
  assert.ok(validate({ ...asset, quantity: '9007199254740993' }), 'Integers beyond JS safe range remain exact')
  for (const quantity of [3, '0', '-1', '1.5', '1e3', '03'])
    assert.equal(validate({ ...asset, quantity }), false, 'Unexpectedly valid quantity ' + JSON.stringify(quantity))
  assert.equal(validate({ quantity: '3', unit: asset.unit }), false, 'A count must identify the promised asset')
  assert.equal(validate({ assetId: asset.assetId, quantity: '3' }), false, 'A count must identify its unit')
})

test('the published signed receipt verifies with the registered public key and detects changed claims', () => {
  const validate = validator('ReceiptSubmission')
  const { publicKey, signedReceipt } = doc['x-receipt-test-vector']
  assert.ok(validate({ signedReceipt }), ajv.errorsText(validate.errors))
  const publicKeyValid = validator('PublicKey')
  assert.ok(publicKeyValid(publicKey), ajv.errorsText(publicKeyValid.errors))
  assert.equal(publicKeyValid({ ...publicKey, d: 'private-material' }), false)
  const [protected64, payload64, signature64] = signedReceipt.split('.')
  const unpack = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  const claims = unpack(payload64)
  assert.deepEqual(unpack(protected64), { alg: 'Ed25519', kid: publicKey.kid, typ: 'partner-receipt+jwt' })
  assert.deepEqual(claims, schemas.ReceiptClaims.examples.find(example => example.jti === claims.jti))
  const key = createPublicKey({ key: publicKey, format: 'jwk' })
  const signature = Buffer.from(signature64, 'base64url')
  assert.equal(verify(null, Buffer.from(protected64 + '.' + payload64), key, signature), true)
  const altered = Buffer.from(JSON.stringify({ ...claims, taskId: claims.taskId + '-other' })).toString('base64url')
  assert.equal(verify(null, Buffer.from(protected64 + '.' + altered), key, signature), false)
  assert.equal(validate(claims), false)
  assert.equal(validate({ signedReceipt: claims }), false)
  assert.equal(validate({ signedReceipt: 'unsigned' }), false)
})

test('the published name and host examples distinguish equal, visually confusable, near and unrelated organizations', () => {
  const vectors = doc['x-partner-name-vectors']
  assert.ok(Array.isArray(vectors) && vectors.length > 0)
  // These LTR fixtures use a deliberately small set of characters whose case
  // folds and skeleton mappings can be checked offline. Production uses the full
  // pinned Unicode data. https://www.unicode.org/Public/17.0.0/security/confusables.txt
  const key = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\p{Punctuation}]/gu, '')
  const fixtureSkeleton = (s: string) => {
    assert.match(s, /^[a-z.\-\u043e]+$/u, 'Add an independent Unicode witness for new fixture characters')
    return s.replaceAll('\u043e', 'o').replaceAll('m', 'rn')
  }
  // Optimal string alignment distance over Unicode scalars, including one
  // adjacent transposition. The bounded test inputs need no search index.
  const distance = (left: string, right: string) => {
    const a = [...left], b = [...right]
    const d = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
          d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]))
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
    return d[a.length][b.length]
  }
  const observed = new Set<string>()
  for (const { leftName, rightName, leftDomain, rightDomain, expectedSignals } of vectors) {
    const a = key(leftName), b = key(rightName)
    for (const domain of [leftDomain, rightDomain]) assert.equal(domainToASCII(domain), domain)
    const expected: string[] = []
    if (leftName === rightName) expected.push('exact_name')
    else if (a === b) expected.push('normalized_name')
    else if (fixtureSkeleton(a) === fixtureSkeleton(b)) expected.push('confusable_name')
    else {
      const shorter = Math.min([...a].length, [...b].length)
      const budget = shorter >= 12 ? 2 : shorter >= 5 ? 1 : 0
      if (distance(a, b) <= budget) expected.push('similar_name')
    }
    if (leftDomain !== rightDomain && fixtureSkeleton(domainToUnicode(leftDomain)) === fixtureSkeleton(domainToUnicode(rightDomain)))
      expected.push('confusable_domain')
    assert.deepEqual(expectedSignals.toSorted(), expected.toSorted(), leftName + ' / ' + rightName)
    for (const signal of expected) observed.add(signal)
    if (expected.length === 0) observed.add('unrelated')
  }
  assert.deepEqual(observed, new Set(['exact_name', 'normalized_name', 'confusable_name',
    'similar_name', 'confusable_domain', 'unrelated']))
})

test('published partner pages identify same-name organizations independently and exclude private enrollment data', () => {
  const profiles = schemas.PublicPartnerProfile.examples
  const valid = validator('PublicPartnerProfile')
  const catalog = validator('PartnerIdentity')
  assert.ok(profiles.length >= 3)
  for (const profile of profiles) {
    assert.ok(valid(profile), ajv.errorsText(valid.errors))
    const { identity } = profile
    assert.equal(identity.domainAscii, domainToASCII(identity.domainAscii))
    assert.equal(identity.profilePath, '/partners/' + encodeURIComponent(profile.partnerId))
    assert.ok(catalog(identity))
    for (const field of ['keys', 'contact', 'handoffUrl', 'challenge', 'applicationId'])
      assert.equal(valid({ ...profile, [field]: 'private' }), false, field)
  }
  const live = profiles.filter(p => p.status === 'active')
  const first = live.find(p => p.identity.collisionSignals.includes('exact_name'))
  assert.ok(first, 'Include two active published organizations with the same name')
  const second = live.find(q => q.partnerId !== first.partnerId && q.displayName === first.displayName)
  assert.ok(second)
  assert.notEqual(first.partnerId, second.partnerId)
  assert.notEqual(first.identity.domainAscii, second.identity.domainAscii)
  assert.notEqual(first.identity.profilePath, second.identity.profilePath)
  assert.ok(second.identity.collisionSignals.includes('exact_name'))
  assert.ok(first.identity.relatedPartners.includes(second.partnerId))
  assert.ok(second.identity.relatedPartners.includes(first.partnerId))
  const inactive = profiles.find(p => p.status !== 'active')
  assert.ok(inactive, 'A formerly approved profile is still addressable')
  assert.deepEqual(inactive.capabilities, [])
  assert.equal(valid({ ...inactive, capabilities: ['custodian'] }), false)
})

test('the website badge examples bind status and approved host to a first-party canonical destination', () => {
  const badge = doc.paths['/public/partners/{partnerId}/badge'].get
  const profileRead = doc.paths['/public/partners/{partnerId}'].get
  for (const op of [badge, profileRead]) assert.deepEqual(op.security, [])
  assert.ok(badge.responses['200'].content['text/html'])
  assert.equal(profileRead.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/PublicPartnerProfile')
  const examples = doc['x-partner-badge-examples']
  assert.deepEqual(new Set(examples.map(e => e.active)), new Set([true, false]))
  for (const sample of examples) {
    const profile = schemas.PublicPartnerProfile.examples.find(p => p.partnerId === sample.partnerId && p.asOf === sample.profileAsOf)
    assert.ok(profile)
    const frame = new URL(sample.frameUrl), destination = new URL(sample.profileUrl)
    assert.equal(frame.protocol, 'https:')
    assert.equal(destination.protocol, 'https:')
    assert.notEqual(frame.origin, destination.origin)
    assert.equal(destination.pathname, profile.identity.profilePath)
    assert.equal(destination.search + destination.hash, '')
    assert.equal(frame.pathname, '/v1/task-partners/public/partners/' + encodeURIComponent(profile.partnerId) + '/badge')
    assert.deepEqual([...frame.searchParams], [['domain', sample.domainAscii]])
    const headers = new Headers(sample.headers)
    assert.equal(headers.get('cache-control'), 'no-store')
    assert.equal(headers.get('referrer-policy'), 'no-referrer')
    const sources = headers.get('content-security-policy')?.split(';').map(s => s.trim())
    assert.ok(sources?.includes("default-src 'none'"))
    const asOf = Date.parse(profile.asOf)
    const eligible = profile.status === 'active' && profile.capabilities.length > 0
      && sample.domainAscii === profile.identity.domainAscii
      && Date.parse(profile.identity.verifiedAt) <= asOf && asOf < Date.parse(profile.identity.validUntil)
    assert.equal(sample.active, eligible)
    const ancestor = eligible ? 'https://' + profile.identity.domainAscii : "'none'"
    assert.deepEqual(sources?.filter(s => s.startsWith('frame-ancestors ')), ['frame-ancestors ' + ancestor])
  }
})

test('DNS proof is private, and selecting a partner can bind the expected exact host and revision', () => {
  const base = '/applications/{applicationId}/domain-challenges'
  const issue = doc.paths[base].post
  const poll = doc.paths[base + '/{challengeId}'].get
  for (const operation of [issue, poll]) {
    assert.deepEqual(operation.security, [{ Session: [] }, { HumanBearer: [] }, { PartnerOAuth: ['domains:renew'] }])
    assert.ok(operation.responses['403'])
  }
  assert.equal(issue.requestBody.content['application/json'].schema.$ref, '#/components/schemas/DomainChallengeRequest')
  for (const response of [issue.responses['201'], poll.responses['200']]) {
    assert.equal(response.headers['Cache-Control'].schema.const, 'no-store')
    assert.equal(response.content['application/json'].schema.$ref, '#/components/schemas/DomainChallenge')
  }
  const challenge = validator('DomainChallengeRequest')
  const request = { purpose: 'website', expectedRevision: 3 }
  assert.ok(challenge(request))
  for (const serverField of ['state', 'recordValue', 'validUntil', 'applicationId'])
    assert.equal(challenge({ ...request, [serverField]: 'verified' }), false, serverField)

  const domain = validator('DomainAscii')
  for (const host of ['orchard.example', 'www.orchard.example', 'xn--rchard-vqf.example']) assert.ok(domain(host))
  for (const host of ['ORCHARD.example', 'orchard.example.', '*.orchard.example', 'orchard.example:444',
    'user@orchard.example', 'orchard.example/path', 'orchard.example/?other', 'localhost'])
    assert.equal(domain(host), false, host)

  for (const view of ['PartnerProfile', 'Handoff'])
    assert.equal(schemas[view].properties.identity.$ref, '#/components/schemas/PartnerIdentity', view)
  const makeHandoff = validator('HandoffRequest')
  const trusted = { taskId: 'task-41', termsVersion: 2, termsDigest: 'a'.repeat(64), purpose: 'reserve',
    partnerId: 'org-7sh8fk2n', expectedIdentity: { domainAscii: 'orchard.example', identityRevision: 1 } }
  assert.ok(makeHandoff(trusted), ajv.errorsText(makeHandoff.errors))
  for (const expectedIdentity of [{ displayName: 'Orchard Works', identityRevision: 1 },
    { domainAscii: 'orchard.example' }, { domainAscii: 'orchard.example', identityRevision: 0 }])
    assert.equal(makeHandoff({ ...trusted, expectedIdentity }), false, JSON.stringify(expectedIdentity))
})

test('sensitive selection examples resolve against the published identity, capability and prior binding', () => {
  const results = new Set<string>()
  for (const example of doc['x-partner-selection-vectors']) {
    const profile = schemas.PublicPartnerProfile.examples.find(p => p.partnerId === example.partnerId)
    assert.ok(profile, example.partnerId)
    let result = 'allowed'
    const pin = example.priorPin
    const expected = example.expectedIdentity ?? pin
    const role = example.purpose === 'run' ? 'model-provider' : 'custodian'
    if (profile.status !== 'active' || Date.parse(profile.asOf) >= Date.parse(profile.identity.validUntil))
      result = 'identity_inactive'
    else if (!profile.capabilities.includes(role))
      result = 'capability_unavailable'
    else if (!expected && profile.identity.collisionSignals.length > 0)
      result = 'identity_confirmation_required'
    else if (expected && (expected.domainAscii !== profile.identity.domainAscii || (pin && pin.partnerId !== profile.partnerId)))
      result = 'identity_mismatch'
    else if (expected && expected.identityRevision !== profile.identity.identityRevision)
      result = 'stale_identity'
    assert.equal(example.expectedResult, result, JSON.stringify(example))
    results.add(result)
    if (result === 'allowed') results.add(pin ? 'prior_pin' : 'known_domain')
  }
  assert.deepEqual(results, new Set(['allowed', 'prior_pin', 'known_domain', 'identity_inactive', 'identity_mismatch',
    'identity_confirmation_required', 'stale_identity', 'capability_unavailable']))
})
